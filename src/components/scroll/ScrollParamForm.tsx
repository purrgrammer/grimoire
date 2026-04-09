import { Settings } from "lucide-react";
import { PARAM_CONFIG } from "@/components/nostr/kinds/ScrollRenderer";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { ScrollParam } from "@/lib/nip5c-helpers";

interface ScrollParamFormProps {
  params: ScrollParam[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  connectedRelays: string[];
  disabled?: boolean;
}

export function ScrollParamForm({
  params,
  values,
  onChange,
  connectedRelays,
  disabled,
}: ScrollParamFormProps) {
  if (params.length === 0) return null;

  const setValue = (name: string, value: string) => {
    onChange({ ...values, [name]: value });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Settings className="size-4" />
        <span>Parameters</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {params.map((param) => {
          const {
            icon: Icon,
            placeholder,
            inputType,
          } = PARAM_CONFIG[param.type];

          return (
            <div
              key={param.name}
              className="flex flex-col gap-1 px-3 py-2 border border-border/50 rounded"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-sm font-medium font-mono">
                  {param.name}
                </span>
                <Label size="sm">{param.type}</Label>
                {param.required && <Label size="sm">required</Label>}
                {param.supportedKinds && (
                  <span className="text-xs text-muted-foreground">
                    kinds: {param.supportedKinds}
                  </span>
                )}
              </div>
              {param.description && (
                <p className="text-xs text-muted-foreground">
                  {param.description}
                </p>
              )}
              {param.type === "relay" ? (
                <div className="flex gap-1.5">
                  <select
                    value={values[param.name] || ""}
                    onChange={(e) => setValue(param.name, e.target.value)}
                    disabled={disabled}
                    className="flex-1 h-8 rounded-md border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="">Select relay...</option>
                    {connectedRelays.map((url) => (
                      <option key={url} value={url}>
                        {url}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="text"
                    placeholder="or type wss://..."
                    value={
                      connectedRelays.includes(values[param.name] || "")
                        ? ""
                        : values[param.name] || ""
                    }
                    onChange={(e) => setValue(param.name, e.target.value)}
                    disabled={disabled}
                    className="flex-1 h-8 text-xs"
                  />
                </div>
              ) : (
                <Input
                  type={inputType}
                  placeholder={placeholder}
                  value={values[param.name] || ""}
                  onChange={(e) => setValue(param.name, e.target.value)}
                  disabled={disabled}
                  className="h-8 text-xs"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
