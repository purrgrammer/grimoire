/**
 * NIP-5C Scroll WASM Host Runtime
 *
 * Standalone host that instantiates and runs NIP-5C scroll programs.
 * Provides the full nostr.* import API to WASM modules.
 *
 * Each execution uses a dedicated RelayPool and EventStore for isolation.
 * The global eventStore is only used for relay selection (NIP-65 relay lists).
 */

import type { NostrEvent } from "@/types/nostr";
import type { Filter } from "nostr-tools";
import type { Subscription } from "rxjs";
import { firstValueFrom, timeout as rxTimeout } from "rxjs";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";
import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import globalEventStore from "@/services/event-store";
import { selectRelaysForFilter } from "@/services/relay-selection";
import { AGGREGATOR_RELAYS, eventLoader } from "@/services/loaders";
import type { ScrollParam, ParamValue } from "@/lib/nip5c-helpers";
import { isNostrEvent } from "@/lib/type-guards";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Fetch a NostrEvent by ID, checking the global store first then relays.
 */
export async function fetchEventParam(
  eventId: string,
): Promise<NostrEvent | undefined> {
  const existing = globalEventStore.getEvent(eventId);
  if (existing) return existing;
  try {
    return await firstValueFrom(
      eventLoader({ id: eventId }).pipe(rxTimeout(10_000)),
    );
  } catch {
    return undefined;
  }
}

// --- Types ---

export type ScrollRuntimeState =
  | "idle"
  | "loading"
  | "running"
  | "stopped"
  | "completed"
  | "error";

export type TraceDirection = "program" | "host";

export interface TraceEntry {
  direction: TraceDirection;
  fn: string;
  args?: Record<string, unknown>;
  result?: Record<string, unknown>;
  timestamp: number;
}

export interface ScrollRuntimeOptions {
  paramValues: Map<string, ParamValue>;
  onDisplay: (event: NostrEvent) => void;
  onLog: (message: string) => void;
  onStateChange: (state: ScrollRuntimeState) => void;
  /** Called with total event count when any event is received from subscriptions */
  onEventCount?: (count: number) => void;
  /** Called when subscriptions change (opened, closed, events received) */
  onSubscriptionsChange?: (subs: SubscriptionInfo[]) => void;
  /** Called for every host↔WASM function call (debug trace) */
  onTrace?: (entry: TraceEntry) => void;
  onError?: (error: Error) => void;
  /** Byte order for host-written numbers. Default: "LE" (NIP-5C spec) */
  endianness?: "LE" | "BE";
  /** Whether to prefix each param with a presence byte. Default: true (NIP-5C spec) */
  presenceBytes?: boolean;
}

export interface SubscriptionInfo {
  handle: number;
  filter: Filter;
  relays: string[];
  eventCount: number;
  eosed: boolean;
  closed: boolean;
}

export interface ScrollRuntimeController {
  stop: () => void;
}

interface ReqData {
  filter: Filter;
  relays: string[];
  closeOnEose: boolean;
}

interface SubData {
  rxSubscription: Subscription | null;
  filter: Filter;
  relays: string[];
  eventCount: number;
  eosed: boolean;
}

type HandleEntry =
  | { type: "req"; data: ReqData }
  | { type: "event"; data: NostrEvent }
  | { type: "sub"; data: SubData };

function pushUnique<T>(arr: T[], value: T): void {
  if (!arr.includes(value)) arr.push(value);
}

export async function runScroll(
  wasmBase64: string,
  paramSpecs: ScrollParam[],
  options: ScrollRuntimeOptions,
): Promise<ScrollRuntimeController> {
  let stopped = false;
  let totalEventsReceived = 0;
  const littleEndian = (options.endianness ?? "LE") === "LE";
  const usePresenceBytes = options.presenceBytes ?? true;

  // Dedicated instances for this execution
  const privatePool = new RelayPool();
  const privateEventStore = new EventStore();

  let nextHandleId = 1;
  const handles = new Map<number, HandleEntry>();
  const closedSubs: SubscriptionInfo[] = [];

  function allocHandle(type: "req", data: ReqData): number;
  function allocHandle(type: "event", data: NostrEvent): number;
  function allocHandle(type: "sub", data: SubData): number;
  function allocHandle(type: string, data: unknown): number {
    const h = nextHandleId++;
    handles.set(h, { type, data } as HandleEntry);
    return h;
  }

  function getReq(h: number): ReqData {
    const entry = handles.get(h);
    if (!entry || entry.type !== "req")
      throw new Error(`bad handle ${h} for type req`);
    return entry.data;
  }

  function getEvent(h: number): NostrEvent {
    const entry = handles.get(h);
    if (!entry || entry.type !== "event")
      throw new Error(`bad handle ${h} for type event`);
    return entry.data;
  }

  function dropHandle(h: number): void {
    if (h === 0) return;
    const entry = handles.get(h);
    if (!entry) return;
    if (entry.type === "sub" && entry.data.rxSubscription) {
      entry.data.rxSubscription.unsubscribe();
    }
    handles.delete(h);
  }

  // State management
  function setState(s: ScrollRuntimeState): void {
    options.onStateChange(s);
  }

  function snapshotSub(
    h: number,
    data: SubData,
    closed: boolean,
  ): SubscriptionInfo {
    return {
      handle: h,
      filter: data.filter,
      relays: data.relays,
      eventCount: data.eventCount,
      eosed: data.eosed,
      closed,
    };
  }

  function getAllSubscriptions(): SubscriptionInfo[] {
    const active: SubscriptionInfo[] = [];
    for (const [h, entry] of handles) {
      if (entry.type === "sub") {
        active.push(snapshotSub(h, entry.data, false));
      }
    }
    return [...closedSubs, ...active];
  }

  let subsNotifyPending = false;
  function notifySubsChanged(): void {
    if (subsNotifyPending || !options.onSubscriptionsChange) return;
    subsNotifyPending = true;
    queueMicrotask(() => {
      subsNotifyPending = false;
      if (!stopped) {
        options.onSubscriptionsChange?.(getAllSubscriptions());
      }
    });
  }

  function trace(
    direction: TraceDirection,
    fn: string,
    args?: Record<string, unknown>,
    result?: Record<string, unknown>,
  ): void {
    if (!options.onTrace) return;
    options.onTrace({ direction, fn, args, result, timestamp: Date.now() });
  }

  // WASM instance references
  let instance: WebAssembly.Instance | null = null;
  let memory: WebAssembly.Memory;

  // --- Memory I/O ---

  function readBuf(ptr: number, len: number): Uint8Array {
    return new Uint8Array(memory.buffer.slice(ptr, ptr + len));
  }

  function readStr(ptr: number, len: number): string {
    return textDecoder.decode(new Uint8Array(memory.buffer, ptr, len));
  }

  function alloc(size: number): number {
    return (instance!.exports.alloc as (size: number) => number)(size);
  }

  function writeHostBuf(buf: Uint8Array, prefixLen: boolean): number {
    const prefixOffset = prefixLen ? 4 : 0;
    const ptr = alloc(buf.length + prefixOffset);
    const view = new DataView(memory.buffer);
    if (prefixLen) {
      view.setUint32(ptr, buf.length, littleEndian);
    }
    new Uint8Array(memory.buffer, ptr + prefixOffset, buf.length).set(buf);
    return ptr;
  }

  function writeHostStr(str: string, prefixLen: boolean = true): number {
    const encoded = textEncoder.encode(str);
    return writeHostBuf(encoded, prefixLen);
  }

  // --- Build WASM imports ---

  const nostrImports = {
    req_new: (): number => {
      if (stopped) return 0;
      const h = allocHandle("req", {
        filter: {},
        relays: [],
        closeOnEose: false,
      });
      trace("program", "req_new", undefined, { handle: h });
      return h;
    },

    req_add_author: (req: number, ptr: number): void => {
      if (stopped) return;
      const author = bytesToHex(readBuf(ptr, 32));
      const r = getReq(req);
      r.filter.authors = r.filter.authors || [];
      pushUnique(r.filter.authors, author);
      trace("program", "req_add_author", { req, author });
    },

    req_add_author_hex: (req: number, ptr: number): void => {
      if (stopped) return;
      const author = readStr(ptr, 64);
      const r = getReq(req);
      r.filter.authors = r.filter.authors || [];
      pushUnique(r.filter.authors, author);
      trace("program", "req_add_author_hex", { req, author });
    },

    req_add_id: (req: number, ptr: number): void => {
      if (stopped) return;
      const id = bytesToHex(readBuf(ptr, 32));
      const r = getReq(req);
      r.filter.ids = r.filter.ids || [];
      pushUnique(r.filter.ids, id);
      trace("program", "req_add_id", { req, id });
    },

    req_add_id_hex: (req: number, ptr: number): void => {
      if (stopped) return;
      const id = readStr(ptr, 64);
      const r = getReq(req);
      r.filter.ids = r.filter.ids || [];
      pushUnique(r.filter.ids, id);
      trace("program", "req_add_id_hex", { req, id });
    },

    req_add_kind: (req: number, kind: number): void => {
      if (stopped) return;
      const r = getReq(req);
      r.filter.kinds = r.filter.kinds || [];
      pushUnique(r.filter.kinds, kind);
      trace("program", "req_add_kind", { req, kind });
    },

    req_add_tag: (
      req: number,
      tag: number,
      vPtr: number,
      vLen: number,
    ): void => {
      if (stopped) return;
      const code = tag & 0xff;
      const tagChar = String.fromCharCode(code);
      if (!/^[A-Za-z]$/.test(tagChar)) return;
      const value = readStr(vPtr, vLen);
      const r = getReq(req);
      const key = `#${tagChar}` as `#${string}`;
      const tags = (r.filter as Record<string, string[]>)[key] || [];
      pushUnique(tags, value);
      (r.filter as Record<string, string[]>)[key] = tags;
      trace("program", "req_add_tag", { req, tag: `#${tagChar}`, value });
    },

    req_add_tag_bin32: (req: number, tag: number, vPtr: number): void => {
      if (stopped) return;
      const code = tag & 0xff;
      const tagChar = String.fromCharCode(code);
      if (!/^[A-Za-z]$/.test(tagChar)) return;
      const value = bytesToHex(readBuf(vPtr, 32));
      const r = getReq(req);
      const key = `#${tagChar}` as `#${string}`;
      const tags = (r.filter as Record<string, string[]>)[key] || [];
      pushUnique(tags, value);
      (r.filter as Record<string, string[]>)[key] = tags;
      trace("program", "req_add_tag_bin32", {
        req,
        tag: `#${tagChar}`,
        value,
      });
    },

    req_set_limit: (req: number, n: number): void => {
      if (stopped) return;
      getReq(req).filter.limit = n;
      trace("program", "req_set_limit", { req, limit: n });
    },

    req_set_since: (req: number, ts: number): void => {
      if (stopped) return;
      getReq(req).filter.since = ts;
      trace("program", "req_set_since", { req, since: ts });
    },

    req_set_until: (req: number, ts: number): void => {
      if (stopped) return;
      getReq(req).filter.until = ts;
      trace("program", "req_set_until", { req, until: ts });
    },

    req_set_search: (req: number, ptr: number, len: number): void => {
      if (stopped) return;
      const search = readStr(ptr, len);
      getReq(req).filter.search = search;
      trace("program", "req_set_search", { req, search });
    },

    req_add_relay: (req: number, ptr: number, len: number): void => {
      if (stopped) return;
      const relay = readStr(ptr, len);
      getReq(req).relays.push(relay);
      trace("program", "req_add_relay", { req, relay });
    },

    req_close_on_eose: (req: number): void => {
      if (stopped) return;
      getReq(req).closeOnEose = true;
      trace("program", "req_close_on_eose", { req });
    },

    subscribe: (req: number): number => {
      if (stopped) return 0;
      const reqData = getReq(req);
      handles.delete(req); // consume the req handle

      const subHandle = allocHandle("sub", {
        rxSubscription: null,
        filter: reqData.filter,
        relays: [],
        eventCount: 0,
        eosed: false,
      });
      trace(
        "program",
        "subscribe",
        {
          req,
          filter: reqData.filter,
          relayHints: reqData.relays,
          closeOnEose: reqData.closeOnEose,
        },
        { sub: subHandle },
      );

      const on_event = instance!.exports.on_event as (
        sub: number,
        ev: number,
        eosed: number,
      ) => void;
      const on_eose = instance!.exports.on_eose as (sub: number) => void;

      (async () => {
        let relays: string[] = reqData.relays;

        if (!relays.length) {
          try {
            const result = await selectRelaysForFilter(
              globalEventStore,
              reqData.filter,
            );
            relays = result.relays;
          } catch {
            relays = [...AGGREGATOR_RELAYS];
          }
        }

        trace("host", "subscribe:connected", { sub: subHandle, relays });

        if (!relays.length || stopped || !handles.has(subHandle)) return;

        // Update sub data with resolved relays
        const subEntry = handles.get(subHandle);
        if (subEntry?.type === "sub") {
          subEntry.data.relays = relays;
          notifySubsChanged();
        }

        let eosed = false;

        const observable = privatePool.subscription(relays, [reqData.filter]);
        const rxSub = observable.subscribe({
          next: (response) => {
            if (stopped || !handles.has(subHandle)) return;

            if (typeof response === "string" && response === "EOSE") {
              eosed = true;
              const se = handles.get(subHandle);
              if (se?.type === "sub") se.data.eosed = true;
              trace("host", "on_eose", { sub: subHandle });
              on_eose(subHandle);

              if (reqData.closeOnEose) {
                const entry = handles.get(subHandle);
                if (entry?.type === "sub") {
                  entry.data.rxSubscription?.unsubscribe();
                  closedSubs.push(snapshotSub(subHandle, entry.data, true));
                }
                handles.delete(subHandle);
                notifySubsChanged();
                trace("host", "sub:closed_on_eose", { sub: subHandle });
              }
            } else if (isNostrEvent(response)) {
              privateEventStore.add(response);
              totalEventsReceived++;
              const se2 = handles.get(subHandle);
              if (se2?.type === "sub") se2.data.eventCount++;
              options.onEventCount?.(totalEventsReceived);
              notifySubsChanged();
              const evHandle = allocHandle("event", response);
              trace("host", "on_event", {
                sub: subHandle,
                ev: evHandle,
                kind: response.kind,
                id: response.id,
                pubkey: response.pubkey,
                eosed: eosed ? 1 : 0,
              });
              on_event(subHandle, evHandle, eosed ? 1 : 0);
            }
          },
          error: (err) => {
            trace("host", "sub:error", {
              sub: subHandle,
              error: String(err),
            });
            const entry = handles.get(subHandle);
            if (entry?.type === "sub") {
              closedSubs.push(snapshotSub(subHandle, entry.data, true));
            }
            handles.delete(subHandle);
            notifySubsChanged();
          },
        });

        const entry = handles.get(subHandle);
        if (entry?.type === "sub") {
          entry.data.rxSubscription = rxSub;
        } else {
          rxSub.unsubscribe();
        }
      })();

      return subHandle;
    },

    // --- Event accessors ---

    event_get_id: (ev: number): number => {
      if (stopped) return 0;
      const e = getEvent(ev);
      trace("program", "event_get_id", { ev }, { id: e.id });
      return writeHostBuf(hexToBytes(e.id), false);
    },

    event_get_id_hex: (ev: number): number => {
      if (stopped) return 0;
      const e = getEvent(ev);
      trace("program", "event_get_id_hex", { ev }, { id: e.id });
      return writeHostStr(e.id, false);
    },

    event_get_pubkey: (ev: number): number => {
      if (stopped) return 0;
      const e = getEvent(ev);
      trace("program", "event_get_pubkey", { ev }, { pubkey: e.pubkey });
      return writeHostBuf(hexToBytes(e.pubkey), false);
    },

    event_get_pubkey_hex: (ev: number): number => {
      if (stopped) return 0;
      const e = getEvent(ev);
      trace("program", "event_get_pubkey_hex", { ev }, { pubkey: e.pubkey });
      return writeHostStr(e.pubkey, false);
    },

    event_get_kind: (ev: number): number => {
      if (stopped) return 0;
      const kind = getEvent(ev).kind;
      trace("program", "event_get_kind", { ev }, { kind });
      return kind;
    },

    event_get_created_at: (ev: number): number => {
      if (stopped) return 0;
      const created_at = getEvent(ev).created_at;
      trace("program", "event_get_created_at", { ev }, { created_at });
      return created_at;
    },

    event_get_content: (ev: number): number => {
      if (stopped) return 0;
      const content = getEvent(ev).content;
      trace("program", "event_get_content", { ev }, { content });
      return writeHostStr(content);
    },

    event_get_tag_count: (ev: number): number => {
      if (stopped) return 0;
      const count = (getEvent(ev).tags ?? []).length;
      trace("program", "event_get_tag_count", { ev }, { count });
      return count;
    },

    event_get_tag_item_count: (ev: number, ti: number): number => {
      if (stopped) return 0;
      const count = (getEvent(ev).tags?.[ti] ?? []).length;
      trace(
        "program",
        "event_get_tag_item_count",
        { ev, tagIndex: ti },
        { count },
      );
      return count;
    },

    event_get_tag_item: (ev: number, ti: number, ii: number): number => {
      if (stopped) return 0;
      const val = getEvent(ev).tags?.[ti]?.[ii];
      trace(
        "program",
        "event_get_tag_item",
        { ev, tagIndex: ti, itemIndex: ii },
        { value: val ?? null },
      );
      return val != null ? writeHostStr(val) : 0;
    },

    event_get_tag_item_bin32: (ev: number, ti: number, ii: number): number => {
      if (stopped) return 0;
      const val = getEvent(ev).tags?.[ti]?.[ii];
      if (typeof val !== "string" || val.length !== 64) {
        trace(
          "program",
          "event_get_tag_item_bin32",
          { ev, tagIndex: ti, itemIndex: ii },
          { value: null },
        );
        return 0;
      }
      try {
        trace(
          "program",
          "event_get_tag_item_bin32",
          { ev, tagIndex: ti, itemIndex: ii },
          { value: val },
        );
        return writeHostBuf(hexToBytes(val), false);
      } catch {
        return 0;
      }
    },

    event_get_tag_item_by_name: (
      ev: number,
      nPtr: number,
      nLen: number,
      ii: number,
    ): number => {
      if (stopped) return 0;
      const name = readStr(nPtr, nLen);
      const tag = (getEvent(ev).tags ?? []).find((t) => t[0] === name);
      const val = tag?.[ii];
      trace(
        "program",
        "event_get_tag_item_by_name",
        { ev, name, itemIndex: ii },
        { value: val ?? null },
      );
      return val != null ? writeHostStr(val) : 0;
    },

    event_get_tag_item_by_name_bin32: (
      ev: number,
      nPtr: number,
      nLen: number,
      ii: number,
    ): number => {
      if (stopped) return 0;
      const name = readStr(nPtr, nLen);
      const tag = (getEvent(ev).tags ?? []).find((t) => t[0] === name);
      const val = tag?.[ii];
      if (typeof val !== "string" || val.length !== 64) {
        trace(
          "program",
          "event_get_tag_item_by_name_bin32",
          { ev, name, itemIndex: ii },
          { value: null },
        );
        return 0;
      }
      try {
        trace(
          "program",
          "event_get_tag_item_by_name_bin32",
          { ev, name, itemIndex: ii },
          { value: val },
        );
        return writeHostBuf(hexToBytes(val), false);
      } catch {
        return 0;
      }
    },

    // --- Display and logging ---

    display: (ev: number): void => {
      if (stopped) return;
      const event = getEvent(ev);
      trace("program", "display", {
        ev,
        kind: event.kind,
        id: event.id,
        pubkey: event.pubkey,
        created_at: event.created_at,
      });
      options.onDisplay(event);
    },

    log: (ptr: number, len: number): void => {
      if (stopped) return;
      const msg = readStr(ptr, len);
      trace("program", "log", { message: msg });
      options.onLog(msg);
    },

    drop: (h: number): void => {
      if (stopped) return;
      const entry = handles.get(h);
      trace("program", "drop", { handle: h, type: entry?.type ?? "unknown" });
      dropHandle(h);
    },
  };

  // --- Param encoding ---

  function encodeParams(): number {
    if (paramSpecs.length === 0) return 0;

    // First pass: calculate buffer size
    let bufSize = usePresenceBytes ? paramSpecs.length : 0;

    // All event params must already be resolved to NostrEvent objects by the caller.
    const resolvedValues: (ParamValue | null)[] = [];

    for (const spec of paramSpecs) {
      const value = options.paramValues.get(spec.name) ?? null;

      if (value === null) {
        resolvedValues.push(null);
        trace("host", "param:encode", {
          name: spec.name,
          type: spec.type,
          present: false,
        });
        continue;
      }

      resolvedValues.push(value);
      trace("host", "param:encode", {
        name: spec.name,
        type: spec.type,
        value:
          value instanceof Uint8Array
            ? bytesToHex(value)
            : typeof value === "object" && "id" in value
              ? {
                  id: (value as NostrEvent).id,
                  kind: (value as NostrEvent).kind,
                }
              : value,
      });

      switch (spec.type) {
        case "public_key":
          bufSize += 32;
          break;
        case "event":
          bufSize += 4;
          break;
        case "string":
        case "relay": {
          const encoded = textEncoder.encode(value as string);
          bufSize += 4 + encoded.length;
          break;
        }
        case "number":
        case "timestamp":
          bufSize += 4;
          break;
      }
    }

    const ptr = alloc(bufSize);
    const view = new DataView(memory.buffer, ptr, bufSize);
    let offset = 0;

    for (const value of resolvedValues) {
      if (usePresenceBytes) {
        view.setUint8(offset, value === null ? 0 : 1);
        offset += 1;
      }
      if (value === null) continue;

      if (typeof value === "number") {
        view.setInt32(offset, value, littleEndian);
        offset += 4;
      } else if (typeof value === "string") {
        const encoded = textEncoder.encode(value);
        view.setInt32(offset, encoded.length, littleEndian);
        offset += 4;
        new Uint8Array(memory.buffer, ptr + offset, encoded.length).set(
          encoded,
        );
        offset += encoded.length;
      } else if ("id" in value && "kind" in value) {
        const evHandle = allocHandle("event", value as NostrEvent);
        view.setInt32(offset, evHandle, littleEndian);
        offset += 4;
      } else if (value instanceof Uint8Array) {
        new Uint8Array(memory.buffer, ptr + offset, value.length).set(value);
        offset += value.length;
      }
    }

    // Trace the raw encoded buffer
    trace("host", "params:encoded", {
      ptr,
      size: bufSize,
      hex: bytesToHex(new Uint8Array(memory.buffer, ptr, bufSize)),
    });

    return ptr;
  }

  function cleanup(): void {
    stopped = true;
    for (const [h] of handles) {
      dropHandle(h);
    }
    handles.clear();
    // Force-close all private relay connections
    for (const [, relay] of privatePool.relays) {
      try {
        relay.close();
      } catch {
        /* ignore */
      }
    }
    instance = null;
  }

  function stop(): void {
    if (stopped) return;
    cleanup();
    setState("stopped");
  }

  try {
    setState("loading");

    const binaryStr = atob(wasmBase64);
    const wasmBytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      wasmBytes[i] = binaryStr.charCodeAt(i);
    }

    const wasm = await WebAssembly.instantiate(wasmBytes.buffer, {
      env: {
        memory: new WebAssembly.Memory({ initial: 1 }),
        __memory_base: 0,
        __table_base: 0,
        abort() {
          options.onLog("[scroll] abort() called");
          stop();
        },
      },
      nostr: nostrImports,
    });

    instance = wasm.instance;
    memory = instance.exports.memory as WebAssembly.Memory;

    const paramsPtr = encodeParams();
    setState("running");
    (instance.exports.run as (ptr: number) => void)(paramsPtr);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    options.onLog(`Error: ${error.message}`);
    options.onError?.(error);
    cleanup();
    setState("error");
  }

  return { stop };
}
