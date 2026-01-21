import { useState } from "react";
import { Settings, Palette } from "lucide-react";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Button } from "./ui/button";
import { useSettings } from "@/hooks/useSettings";
import { cn } from "@/lib/utils";

type SettingsTab = "post" | "appearance";

interface TabConfig {
  id: SettingsTab;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabConfig[] = [
  {
    id: "post",
    label: "Post",
    icon: <Settings className="h-4 w-4" />,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: <Palette className="h-4 w-4" />,
  },
];

export function SettingsViewer() {
  const { settings, updateSetting } = useSettings();
  const [activeTab, setActiveTab] = useState<SettingsTab>("post");

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-48 border-r border-border bg-muted/20">
        <div className="p-4">
          <h2 className="text-lg font-semibold mb-4">Settings</h2>
          <div className="space-y-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                  activeTab === tab.id
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-muted-foreground",
                )}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-2xl">
          {activeTab === "post" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">Post Settings</h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Configure how your posts are published
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Checkbox
                    id="client-tag"
                    checked={settings?.post?.includeClientTag ?? true}
                    onCheckedChange={(checked: boolean) =>
                      updateSetting("post", "includeClientTag", checked)
                    }
                  />
                  <div className="space-y-0.5">
                    <Label className="cursor-pointer">Include Client Tag</Label>
                    <p className="text-sm text-muted-foreground">
                      Add Grimoire client tag to your published events (kind 1
                      posts, spells, deletions)
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "appearance" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-4">
                  Appearance Settings
                </h3>
                <p className="text-sm text-muted-foreground mb-6">
                  Customize how Grimoire looks
                </p>
              </div>

              <div className="space-y-6">
                <div className="space-y-3">
                  <Label>Theme</Label>
                  <div className="flex gap-2">
                    {(["light", "dark", "system"] as const).map((theme) => (
                      <Button
                        key={theme}
                        variant={
                          (settings?.appearance?.theme ?? "dark") === theme
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        onClick={() =>
                          updateSetting("appearance", "theme", theme)
                        }
                        className="capitalize"
                      >
                        {theme}
                      </Button>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Choose your preferred color scheme
                  </p>
                </div>

                <div className="flex items-start gap-3">
                  <Checkbox
                    id="show-client-tags"
                    checked={settings?.appearance?.showClientTags ?? true}
                    onCheckedChange={(checked: boolean) =>
                      updateSetting("appearance", "showClientTags", checked)
                    }
                  />
                  <div className="space-y-0.5">
                    <Label className="cursor-pointer">Show Client Tags</Label>
                    <p className="text-sm text-muted-foreground">
                      Display "via Grimoire" and other client tags in event UI
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
