import { CopyCheck, Copy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCopy } from "../hooks/useCopy";

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
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto mt-2 relative">
          <pre className="text-xs font-mono bg-muted p-4 pr-10 overflow-scroll">
            <Button
              size="icon"
              variant="link"
              onClick={handleCopy}
              aria-label="Copy JSON"
              className="absolute top-2 right-2"
            >
              {copied ? (
                <CopyCheck className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
            {jsonString}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
