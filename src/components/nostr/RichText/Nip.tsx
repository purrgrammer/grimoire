import { FileText } from "lucide-react";
import type { NipNode } from "@/lib/nip-transformer";
import { useGrimoire } from "@/core/state";
import { getNIPInfo } from "@/lib/nip-icons";

interface NipNodeProps {
  node: NipNode;
}

/**
 * Renders a NIP reference as a clickable link that opens the NIP viewer
 */
export function Nip({ node }: NipNodeProps) {
  const { addWindow } = useGrimoire();
  const { number, raw } = node;
  const nipInfo = getNIPInfo(number);

  const openNIP = () => {
    addWindow(
      "nip",
      { number },
      nipInfo ? `NIP ${number} - ${nipInfo.name}` : `NIP ${number}`,
    );
  };

  return (
    <button
      onClick={openNIP}
      className="inline-flex items-center gap-0.5 text-muted-foreground underline decoration-dotted hover:text-foreground cursor-crosshair"
      title={nipInfo?.description ?? `View NIP-${number} specification`}
    >
      <FileText className="size-3" />
      <span>{raw}</span>
    </button>
  );
}
