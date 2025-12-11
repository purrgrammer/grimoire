import { useGrimoire } from "@/core/state";
import { Copy, Check } from "lucide-react";
import { useCopy } from "@/hooks/useCopy";

export function DebugViewer() {
  const { state } = useGrimoire();
  const { copy, copied } = useCopy();

  const stateJson = JSON.stringify(state, null, 2);

  return (
    <div className="h-full w-full flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h2 className="text-lg font-semibold">Application State</h2>
        <button
          onClick={() => copy(stateJson)}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-muted transition-colors"
          title="Copy state to clipboard"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4 text-green-500" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-xs font-mono bg-muted rounded-md p-4 overflow-x-auto">
          {stateJson}
        </pre>
      </div>
    </div>
  );
}
