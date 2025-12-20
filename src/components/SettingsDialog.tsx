import { useGrimoire } from "@/core/state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X } from "lucide-react";
import { KindSelector } from "./KindSelector";
import { getKindName } from "@/constants/kinds";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps) {
  const { state, setCompactModeKinds } = useGrimoire();
  const compactKinds = state.compactModeKinds || [];

  const removeKind = (kindToRemove: number) => {
    setCompactModeKinds(compactKinds.filter((k) => k !== kindToRemove));
  };

  const addKind = (kind: number) => {
    if (!compactKinds.includes(kind)) {
      setCompactModeKinds([...compactKinds, kind].sort((a, b) => a - b));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your workspace preferences.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden">
          <Tabs defaultValue="appearance" className="flex flex-col h-full">
            <div className="px-6 py-2 border-b">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="appearance" className="flex-1">
                  Appearance
                </TabsTrigger>
                {/* Future tabs can be added here */}
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              <TabsContent value="appearance" className="space-y-6 m-0">
                {/* Section: Compact Events */}
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-medium">Compact Events</h3>
                    <p className="text-sm text-muted-foreground">
                      Select event kinds to display in a compact format within
                      timelines and feeds.
                    </p>
                  </div>

                  <div className="max-w-sm">
                    <KindSelector onSelect={addKind} exclude={compactKinds} />
                  </div>

                  <div className="border rounded-lg p-4 bg-muted/30">
                    <div className="flex flex-wrap gap-2">
                      {compactKinds.length === 0 && (
                        <span className="text-sm text-muted-foreground italic">
                          No compact kinds configured.
                        </span>
                      )}
                      {compactKinds.map((kind) => (
                        <Badge
                          key={kind}
                          variant="secondary"
                          className="pl-2 pr-1 py-1 flex items-center gap-1 hover:bg-background border transition-colors"
                        >
                          <span className="text-muted-foreground font-mono text-xs">
                            {kind}
                          </span>
                          <span>{getKindName(kind)}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-4 w-4 ml-1 -mr-0.5 hover:bg-destructive/10 hover:text-destructive rounded-full"
                            onClick={() => removeKind(kind)}
                          >
                            <X className="h-3 w-3" />
                            <span className="sr-only">Remove Kind {kind}</span>
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
