import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { resolveParamValue } from "@/lib/nip5c-helpers";
import type { ScrollParam, ParamValue } from "@/lib/nip5c-helpers";
import {
  runScroll,
  fetchEventParam,
  type ScrollRuntimeController,
  type ScrollRuntimeState,
  type TraceEntry,
  type SubscriptionInfo,
} from "@/lib/scroll-runtime";
import { useAccount } from "@/hooks/useAccount";
import { useRelayState } from "@/hooks/useRelayState";
import { ScrollParamForm } from "./ScrollParamForm";
import { ScrollControls } from "./ScrollControls";
import { ScrollOutput } from "./ScrollOutput";
import type { NostrEvent } from "@/types/nostr";

interface ScrollExecutorProps {
  /** Parsed parameter definitions */
  params: ScrollParam[];
  /** Base64-encoded WASM binary */
  wasmBase64: string;
  /** Event ID used as localStorage key for persisting settings */
  eventId?: string;
}

const SCROLL_STORAGE_PREFIX = "scroll_settings_";

function loadScrollSettings(eventId: string): {
  paramValues?: Record<string, string>;
  endianness?: "LE" | "BE";
  presenceBytes?: boolean;
} {
  try {
    const stored = localStorage.getItem(SCROLL_STORAGE_PREFIX + eventId);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveScrollSettings(
  eventId: string,
  settings: {
    paramValues: Record<string, string>;
    endianness: "LE" | "BE";
    presenceBytes: boolean;
  },
) {
  try {
    localStorage.setItem(
      SCROLL_STORAGE_PREFIX + eventId,
      JSON.stringify(settings),
    );
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function ScrollExecutor({
  params,
  wasmBase64,
  eventId,
}: ScrollExecutorProps) {
  const { pubkey } = useAccount();
  const { relays: relayStates } = useRelayState();

  const connectedRelays = Object.entries(relayStates)
    .filter(([, state]) => state.connectionState === "connected")
    .map(([url]) => url);

  // Load persisted settings
  const stored = eventId ? loadScrollSettings(eventId) : {};

  // Pre-fill "me" params with logged-in pubkey, then overlay persisted values
  const defaultValues: Record<string, string> = {};
  for (const p of params) {
    if (p.name === "me" && p.type === "public_key" && pubkey) {
      defaultValues[p.name] = pubkey;
    }
  }
  // Filter stored values to only include current params (remove stale keys)
  const validParamNames = new Set(params.map((p) => p.name));
  const filteredStored = Object.fromEntries(
    Object.entries(stored.paramValues || {}).filter(([k]) =>
      validParamNames.has(k),
    ),
  );
  const initialValues = { ...defaultValues, ...filteredStored };

  const [runtimeState, setRuntimeState] = useState<ScrollRuntimeState>("idle");
  const [paramValues, setParamValues] =
    useState<Record<string, string>>(initialValues);
  const [displayedEventsMap, setDisplayedEventsMap] = useState<
    Map<string, NostrEvent>
  >(new Map());
  const [logEntries, setLogEntries] = useState<string[]>([]);
  const [traceEntries, setTraceEntries] = useState<TraceEntry[]>([]);
  const [activeSubs, setActiveSubs] = useState<SubscriptionInfo[]>([]);
  const [eventCount, setEventCount] = useState(0);
  const controllerRef = useRef<ScrollRuntimeController | null>(null);
  const isInitialMount = useRef(true);

  // Encoding options
  const [endianness, setEndianness] = useState<"LE" | "BE">(
    stored.endianness || "BE",
  );
  const [presenceBytes, setPresenceBytes] = useState(
    stored.presenceBytes ?? false,
  );

  const isActive = runtimeState === "loading" || runtimeState === "running";

  // Sorted, deduplicated display events (newest first)
  const displayedEvents = useMemo(
    () =>
      Array.from(displayedEventsMap.values()).sort(
        (a, b) => b.created_at - a.created_at,
      ),
    [displayedEventsMap],
  );

  const requiredParamsMissing = params.some(
    (p) => p.required && !paramValues[p.name]?.trim(),
  );

  // Persist settings to localStorage when they change (skip initial mount)
  useEffect(() => {
    if (!eventId) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    saveScrollSettings(eventId, { paramValues, endianness, presenceBytes });
  }, [eventId, paramValues, endianness, presenceBytes]);

  useEffect(() => {
    return () => {
      controllerRef.current?.stop();
    };
  }, []);

  const handleRun = useCallback(async () => {
    controllerRef.current?.stop();

    setDisplayedEventsMap(new Map());
    setLogEntries([]);
    setTraceEntries([]);
    setActiveSubs([]);
    setEventCount(0);
    setRuntimeState("loading");

    // Resolve param values — fetch all event params before running
    const resolved = new Map<string, ParamValue>();
    for (const param of params) {
      const raw = paramValues[param.name];
      if (!raw?.trim()) {
        if (param.required) {
          setLogEntries([`Error: required param "${param.name}" is missing`]);
          setRuntimeState("error");
          return;
        }
        continue;
      }
      const value = resolveParamValue(param.type, raw);
      if (value === null) {
        setLogEntries([
          `Error: invalid value for param "${param.name}" (type: ${param.type})`,
        ]);
        setRuntimeState("error");
        return;
      }

      if (param.type === "event" && typeof value === "string") {
        const eventObj = await fetchEventParam(value);
        if (!eventObj) {
          setLogEntries([
            `Error: could not fetch event "${value}" for param "${param.name}"`,
          ]);
          setRuntimeState("error");
          return;
        }
        resolved.set(param.name, eventObj);
      } else {
        resolved.set(param.name, value);
      }
    }

    try {
      const controller = await runScroll(wasmBase64, params, {
        paramValues: resolved,
        endianness,
        presenceBytes,
        onDisplay: (ev) =>
          setDisplayedEventsMap((prev) => {
            if (prev.has(ev.id)) return prev;
            const next = new Map(prev);
            next.set(ev.id, ev);
            return next;
          }),
        onLog: (msg) => setLogEntries((prev) => [...prev, msg]),
        onStateChange: setRuntimeState,
        onEventCount: setEventCount,
        onSubscriptionsChange: setActiveSubs,
        onTrace: (entry) => setTraceEntries((prev) => [...prev, entry]),
        onError: (err) =>
          setLogEntries((prev) => [...prev, `Error: ${err.message}`]),
      });
      controllerRef.current = controller;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLogEntries((prev) => [...prev, `Fatal: ${msg}`]);
      setRuntimeState("error");
    }
  }, [wasmBase64, params, paramValues, endianness, presenceBytes]);

  const handleStop = useCallback(() => {
    controllerRef.current?.stop();
  }, []);

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      <ScrollParamForm
        params={params}
        values={paramValues}
        onChange={setParamValues}
        connectedRelays={connectedRelays}
        disabled={isActive}
      />

      <ScrollControls
        runtimeState={runtimeState}
        onRun={handleRun}
        onStop={handleStop}
        runDisabled={requiredParamsMissing}
        endianness={endianness}
        presenceBytes={presenceBytes}
        onEndiannessChange={setEndianness}
        onPresenceBytesChange={setPresenceBytes}
      />

      <ScrollOutput
        displayedEvents={displayedEvents}
        logEntries={logEntries}
        traceEntries={traceEntries}
        activeSubs={activeSubs}
        eventCount={eventCount}
        isActive={isActive}
      />
    </div>
  );
}
