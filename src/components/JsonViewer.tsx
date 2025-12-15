import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCopy } from "../hooks/useCopy";
import { CodeCopyButton } from "@/components/CodeCopyButton";
import { SyntaxHighlight } from "@/components/SyntaxHighlight";

interface JsonViewerProps {
  data: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
}

export function JsonViewer({
  data,
  open,
  onOpenChange,
  title = "Raw JSON",
}: JsonViewerProps) {
  const { copy, copied } = useCopy();

  const jsonString = JSON.stringify(data, null, 2);

  const handleCopy = () => {
    copy(jsonString);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col rounded-none">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto relative">
          <SyntaxHighlight
            code={jsonString}
            language="json"
            className="bg-muted p-4 pr-10 overflow-scroll"
          />
          <CodeCopyButton
            onCopy={handleCopy}
            copied={copied}
            label="Copy JSON"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
