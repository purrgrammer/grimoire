// Tiny CDP client for the app's WebView (debug build).
//   node cdp.mjs eval '<js expression>'
//   node cdp.mjs netlog <file> <seconds>   record every request/websocket URL
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`;
const pid = execFileSync(ADB, ["shell", "pidof", "rocks.grimoire.app"], { encoding: "utf8" }).trim();
if (!pid) { console.error("app not running"); process.exit(1); }
execFileSync(ADB, ["forward", "tcp:9333", `localabstract:webview_devtools_remote_${pid}`]);
const targets = await (await fetch("http://localhost:9333/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let n = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const id = ++n; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (mode === "netlog") {
    const p = d.params ?? {};
    const url = p.request?.url ?? p.url;
    if (url && (d.method === "Network.requestWillBeSent" || d.method === "Network.webSocketCreated")) {
      appendFileSync(out, JSON.stringify({ t: Date.now(), ev: d.method, url, method: p.request?.method }) + "\n");
    }
    if (d.method === "Network.loadingFailed") appendFileSync(out, JSON.stringify({ t: Date.now(), ev: "failed", id: p.requestId, error: p.errorText }) + "\n");
  }
};
const [mode, a, b] = process.argv.slice(2);
const out = a;
if (mode === "eval") {
  const r = await send("Runtime.evaluate", { expression: a, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails ?? r.result, null, 1));
  process.exit(0);
} else if (mode === "netlog") {
  await send("Network.enable");
  setTimeout(() => process.exit(0), Number(b) * 1000);
}
