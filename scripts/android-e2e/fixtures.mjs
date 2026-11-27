#!/usr/bin/env node
/**
 * Local, isolated Nostr world for driving the Android app end to end:
 *
 *   relay    ws://localhost:7777   pub/sub relay with real filter matching
 *   bunker   NIP-46 remote signer on that relay, throwaway key
 *   blossom  http://localhost:7778 BUD-01/02 server that verifies upload auth
 *
 * Every frame and request is appended to the audit log, so a run can prove
 * what the app sent (and that nothing went anywhere else). The key is
 * generated per run, lives only in this process and is never written down;
 * nothing here talks to the internet.
 *
 * Usage:  node scripts/android-e2e/fixtures.mjs [--audit <file>]
 * Prints the bunker:// URL and the fixture npub on start. See README.md.
 *
 * Control (curl):
 *   POST http://localhost:7778/__control  {"failNextUploads":1,"uploadDelayMs":0}
 *   GET  http://localhost:7778/__audit    audit entries so far
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
} from "nostr-tools/pure";
import * as nip44 from "nostr-tools/nip44";
import * as nip04 from "nostr-tools/nip04";
import { npubEncode } from "nostr-tools/nip19";

const RELAY_PORT = Number(process.env.E2E_RELAY_PORT ?? 7777);
const BLOSSOM_PORT = Number(process.env.E2E_BLOSSOM_PORT ?? 7778);
const RELAY_URL = `ws://localhost:${RELAY_PORT}/`;
const BLOSSOM_URL = `http://localhost:${BLOSSOM_PORT}/`;
const auditPath =
  process.argv[process.argv.indexOf("--audit") + 1] && process.argv.includes("--audit")
    ? process.argv[process.argv.indexOf("--audit") + 1]
    : "/tmp/grimoire-e2e-audit.jsonl";
writeFileSync(auditPath, "");

const audit = [];
function log(entry) {
  const line = { t: new Date().toISOString(), ...entry };
  audit.push(line);
  appendFileSync(auditPath, JSON.stringify(line) + "\n");
}

// ---------------------------------------------------------------- relay --

const stored = new Map(); // id -> event
const subs = new Set(); // { socket, id, filters }

const isReplaceable = (k) => k === 0 || k === 3 || (k >= 10000 && k < 20000);
const isAddressable = (k) => k >= 30000 && k < 40000;
const isEphemeral = (k) => k >= 20000 && k < 30000;
const dTag = (e) => e.tags.find((t) => t[0] === "d")?.[1] ?? "";

function matches(filter, e) {
  if (filter.ids && !filter.ids.includes(e.id)) return false;
  if (filter.authors && !filter.authors.includes(e.pubkey)) return false;
  if (filter.kinds && !filter.kinds.includes(e.kind)) return false;
  if (filter.since && e.created_at < filter.since) return false;
  if (filter.until && e.created_at > filter.until) return false;
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !Array.isArray(values)) continue;
    const name = key.slice(1);
    // Replaceable lookups ask for "#d": [""]; a missing d tag counts as "".
    if (name === "d" && values.includes(dTag(e))) continue;
    if (!e.tags.some((t) => t[0] === name && values.includes(t[1]))) return false;
  }
  return true;
}

function store(e) {
  if (isEphemeral(e.kind)) return;
  for (const [id, old] of stored) {
    const sameSlot =
      old.pubkey === e.pubkey &&
      old.kind === e.kind &&
      (isReplaceable(e.kind) || (isAddressable(e.kind) && dTag(old) === dTag(e)));
    if (sameSlot) {
      if (old.created_at > e.created_at) return;
      stored.delete(id);
    }
  }
  stored.set(e.id, e);
}

function publishLocal(e) {
  store(e);
  for (const sub of subs) {
    if (sub.filters.some((f) => matches(f, e))) {
      sub.socket.send(JSON.stringify(["EVENT", sub.id, e]));
    }
  }
}

const relay = new WebSocketServer({ port: RELAY_PORT });
relay.on("connection", (socket, req) => {
  const peer = req.headers["user-agent"]?.includes("Android") ? "app" : "local";
  log({ src: "relay", type: "CONNECT", peer, origin: req.headers.origin ?? null });
  socket.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const [type] = msg;
    if (type === "EVENT") {
      const e = msg[1];
      const ok = verifyEvent(e);
      log({ src: "relay", type: "EVENT", peer, kind: e?.kind, id: e?.id, pubkey: e?.pubkey, valid: ok });
      socket.send(JSON.stringify(["OK", e?.id, ok, ok ? "" : "invalid: bad signature"]));
      if (ok) publishLocal(e);
    } else if (type === "REQ") {
      const [, id, ...filters] = msg;
      log({ src: "relay", type: "REQ", peer, sub: id, filters });
      for (const s of subs) if (s.socket === socket && s.id === id) subs.delete(s);
      subs.add({ socket, id, filters });
      const out = [...stored.values()]
        .filter((e) => filters.some((f) => matches(f, e)))
        .sort((a, b) => b.created_at - a.created_at);
      const limit = Math.min(...filters.map((f) => f.limit ?? Infinity));
      for (const e of out.slice(0, limit)) socket.send(JSON.stringify(["EVENT", id, e]));
      socket.send(JSON.stringify(["EOSE", id]));
    } else if (type === "CLOSE") {
      for (const s of subs) if (s.socket === socket && s.id === msg[1]) subs.delete(s);
    } else if (type === "AUTH") {
      log({ src: "relay", type: "AUTH", peer, pubkey: msg[1]?.pubkey });
      socket.send(JSON.stringify(["OK", msg[1]?.id, true, ""]));
    }
  });
  socket.on("close", () => {
    for (const s of subs) if (s.socket === socket) subs.delete(s);
  });
});

// --------------------------------------------------------------- bunker --

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const secret = Math.random().toString(36).slice(2, 12);
const connected = new Set();

function decrypt(sender, content) {
  return content.includes("?iv=")
    ? nip04.decrypt(sk, sender, content)
    : nip44.decrypt(content, nip44.getConversationKey(sk, sender));
}

function respond(client, body, legacy) {
  const json = JSON.stringify(body);
  const content = legacy
    ? nip04.encrypt(sk, client, json)
    : nip44.encrypt(json, nip44.getConversationKey(sk, client));
  publishLocal(
    finalizeEvent(
      { kind: 24133, created_at: Math.floor(Date.now() / 1000), tags: [["p", client]], content },
      sk,
    ),
  );
}

function handleBunker(e) {
  let req;
  const legacy = e.content.includes("?iv=");
  try {
    req = JSON.parse(decrypt(e.pubkey, e.content));
  } catch (error) {
    log({ src: "bunker", type: "UNDECRYPTABLE", from: e.pubkey, error: String(error) });
    return;
  }
  const { id, method, params = [] } = req;
  log({ src: "bunker", type: "REQUEST", method, from: e.pubkey, kind: method === "sign_event" ? JSON.parse(params[0]).kind : undefined });
  const reply = (result) => respond(e.pubkey, { id, result }, legacy);
  const fail = (error) => respond(e.pubkey, { id, result: "", error }, legacy);

  if (method === "connect") {
    if (params[1] && params[1] !== secret) return fail("bad secret");
    connected.add(e.pubkey);
    return reply(params[1] || "ack");
  }
  if (!connected.has(e.pubkey)) return fail("not connected");
  switch (method) {
    case "ping":
      return reply("pong");
    case "get_public_key":
      return reply(pk);
    case "sign_event": {
      const t = JSON.parse(params[0]);
      const signed = finalizeEvent(
        { kind: t.kind, created_at: t.created_at, tags: t.tags, content: t.content },
        sk,
      );
      return reply(JSON.stringify(signed));
    }
    case "nip44_encrypt":
      return reply(nip44.encrypt(params[1], nip44.getConversationKey(sk, params[0])));
    case "nip44_decrypt":
      return reply(nip44.decrypt(params[1], nip44.getConversationKey(sk, params[0])));
    case "nip04_encrypt":
      return reply(nip04.encrypt(sk, params[0], params[1]));
    case "nip04_decrypt":
      return reply(nip04.decrypt(sk, params[0], params[1]));
    default:
      return fail(`unsupported method ${method}`);
  }
}

// The bunker listens on its own relay like any NIP-46 signer would.
subs.add({
  socket: { send: (frame) => {
    const [, , e] = JSON.parse(frame);
    if (e.pubkey !== pk) handleBunker(e);
  } },
  id: "bunker",
  filters: [{ kinds: [24133], "#p": [pk] }],
});

// Seed the throwaway account: profile, relay list, Blossom list.
const now = Math.floor(Date.now() / 1000) - 60;
for (const t of [
  { kind: 0, content: JSON.stringify({ name: "e2e-fixture", about: "Throwaway key for a local test run" }), tags: [] },
  { kind: 10002, content: "", tags: [["r", RELAY_URL]] },
  { kind: 10063, content: "", tags: [["server", BLOSSOM_URL]] },
  { kind: 1, content: "Seeded note from the local fixture relay.", tags: [] },
]) {
  store(finalizeEvent({ ...t, created_at: now }, sk));
}

// -------------------------------------------------------------- blossom --

const blobs = new Map(); // sha256 -> { bytes, type }
const control = { failNextUploads: 0, uploadDelayMs: 0 };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Content-Length, X-SHA-256, X-Content-Type, X-Content-Length",
  "Access-Control-Expose-Headers": "X-Reason",
};

function checkAuth(header, sha) {
  if (!header?.startsWith("Nostr ")) return "missing Nostr authorization";
  let e;
  try {
    e = JSON.parse(Buffer.from(header.slice(6), "base64").toString("utf8"));
  } catch {
    return "undecodable authorization";
  }
  if (!verifyEvent(e)) return "authorization signature does not verify";
  if (e.kind !== 24242) return `authorization kind ${e.kind}`;
  if (!e.tags.some((t) => t[0] === "t" && t[1] === "upload")) return "authorization is not for upload";
  const exp = Number(e.tags.find((t) => t[0] === "expiration")?.[1] ?? 0);
  if (exp && exp < Date.now() / 1000) return "authorization expired";
  if (sha && !e.tags.some((t) => t[0] === "x" && t[1] === sha)) return "authorization is for other bytes";
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, BLOSSOM_URL);
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { ...CORS, ...headers });
    res.end(body);
  };
  if (req.method === "OPTIONS") return send(204);

  if (url.pathname === "/__control" && req.method === "POST") {
    let body = "";
    for await (const c of req) body += c;
    Object.assign(control, JSON.parse(body || "{}"));
    log({ src: "blossom", type: "CONTROL", control });
    return send(200, JSON.stringify(control), { "Content-Type": "application/json" });
  }
  if (url.pathname === "/__audit") {
    return send(200, JSON.stringify(audit, null, 1), { "Content-Type": "application/json" });
  }

  if (url.pathname === "/upload" && req.method === "HEAD") {
    // BUD-06 preflight: demand auth, so the client signs before sending bytes.
    const denied = checkAuth(req.headers.authorization, req.headers["x-sha-256"]);
    log({ src: "blossom", type: "PREFLIGHT", sha256: req.headers["x-sha-256"], contentType: req.headers["x-content-type"], size: Number(req.headers["x-content-length"]), status: denied ? 401 : 200 });
    return denied ? send(401, undefined, { "X-Reason": denied }) : send(200);
  }
  if (url.pathname === "/upload" && req.method === "PUT") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bytes = Buffer.concat(chunks);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const type = req.headers["content-type"] || "application/octet-stream";
    const denied = checkAuth(req.headers.authorization, sha256);
    const entry = { src: "blossom", type: "UPLOAD", size: bytes.length, sha256, contentType: type, authorized: !denied };
    if (control.uploadDelayMs) await new Promise((r) => setTimeout(r, control.uploadDelayMs));
    if (denied) {
      log({ ...entry, status: 401, reason: denied });
      return send(401, "", { "X-Reason": denied });
    }
    if (control.failNextUploads > 0) {
      control.failNextUploads--;
      log({ ...entry, status: 500, reason: "injected failure" });
      return send(500, "", { "X-Reason": "injected failure (fixture)" });
    }
    blobs.set(sha256, { bytes, type });
    log({ ...entry, status: 200 });
    return send(
      200,
      JSON.stringify({ url: `${BLOSSOM_URL}${sha256}`, sha256, size: bytes.length, type, uploaded: Math.floor(Date.now() / 1000) }),
      { "Content-Type": "application/json" },
    );
  }
  const m = url.pathname.match(/^\/([0-9a-f]{64})(\.\w+)?$/);
  if (m && (req.method === "GET" || req.method === "HEAD")) {
    const blob = blobs.get(m[1]);
    log({ src: "blossom", type: req.method, sha256: m[1], found: !!blob });
    if (!blob) return send(404);
    return send(200, req.method === "HEAD" ? undefined : blob.bytes, {
      "Content-Type": blob.type,
      "Content-Length": blob.bytes.length,
    });
  }
  log({ src: "blossom", type: "OTHER", method: req.method, path: url.pathname });
  send(404);
}).listen(BLOSSOM_PORT);

console.log(
  JSON.stringify(
    {
      relay: RELAY_URL,
      blossom: BLOSSOM_URL,
      npub: npubEncode(pk),
      pubkey: pk,
      bunker: `bunker://${pk}?relay=${encodeURIComponent(RELAY_URL)}&secret=${secret}`,
      audit: auditPath,
    },
    null,
    2,
  ),
);
