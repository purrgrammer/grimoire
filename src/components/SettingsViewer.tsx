import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { useTheme } from "@/lib/themes";
import { Palette, FileEdit, Phone, Radio } from "lucide-react";
import { RelayListsSettings } from "./settings/RelayListsSettings";
import { VoiceSettingsSection } from "./settings/VoiceSettings";

// The Notifications pane is hidden along with the notification subsystem
// itself, which is not wired up: `useConcordNotifier` is commented out in
// ConcordViewer and the per-channel level menu is hidden too, so the pane
// offered to tune something nothing acts on. `settings/NotificationSettings.tsx`
// stays on disk — restoring this is a trigger and a tab, not a rebuild.
export function SettingsViewer() {
  const { settings, updateSetting } = useSettings();
  const { themeId, setTheme, availableThemes } = useTheme();

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="appearance" className="flex-1 flex flex-col">
        <div className="border-b px-6 py-3">
          <TabsList>
            <TabsTrigger value="appearance" className="gap-2">
              <Palette className="h-4 w-4" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="post" className="gap-2">
              <FileEdit className="h-4 w-4" />
              Post
            </TabsTrigger>
            <TabsTrigger value="voice" className="gap-2">
              <Phone className="h-4 w-4" />
              Voice
            </TabsTrigger>
            <TabsTrigger value="relays" className="gap-2">
              <Radio className="h-4 w-4" />
              Relays
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="appearance" className="m-0 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Appearance</h3>
              <p className="text-sm text-muted-foreground">
                Customize display preferences
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="theme"
                    className="text-base font-medium cursor-pointer"
                  >
                    Theme
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Choose your color scheme
                  </p>
                </div>
                <Select value={themeId} onValueChange={setTheme}>
                  <SelectTrigger id="theme" className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableThemes.map((theme) => (
                      <SelectItem key={theme.id} value={theme.id}>
                        {theme.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="show-client-tags"
                    className="text-base font-medium cursor-pointer"
                  >
                    Show client tags
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Display client identifiers in events
                  </p>
                </div>
                <Switch
                  id="show-client-tags"
                  checked={settings?.appearance?.showClientTags ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("appearance", "showClientTags", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="load-media"
                    className="text-base font-medium cursor-pointer"
                  >
                    Load media
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Render links to media as inline images, videos, and audio
                  </p>
                </div>
                <Switch
                  id="load-media"
                  checked={settings?.appearance?.loadMedia ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("appearance", "loadMedia", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="collapse-threads"
                    className="text-base font-medium cursor-pointer"
                  >
                    Collapse threads
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Fold chat replies under the message they answer, and open
                    them in a thread beside the conversation
                  </p>
                </div>
                <Switch
                  id="collapse-threads"
                  checked={settings?.appearance?.collapseThreads ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("appearance", "collapseThreads", checked)
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="big-emoji"
                    className="text-base font-medium cursor-pointer"
                  >
                    Big emoji
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Show posts that contain only emoji at a larger size
                  </p>
                </div>
                <Switch
                  id="big-emoji"
                  checked={settings?.appearance?.bigEmoji ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("appearance", "bigEmoji", checked)
                  }
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="post" className="m-0 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Post Settings</h3>
              <p className="text-sm text-muted-foreground">
                Configure event publishing
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <label
                    htmlFor="include-client-tag"
                    className="text-base font-medium cursor-pointer"
                  >
                    Include client tag
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Add Grimoire tag to published events
                  </p>
                </div>
                <Switch
                  id="include-client-tag"
                  checked={settings?.post?.includeClientTag ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("post", "includeClientTag", checked)
                  }
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="voice" className="m-0 p-6 space-y-6">
            <VoiceSettingsSection />
          </TabsContent>

          <TabsContent value="relays" className="m-0 p-6 space-y-6">
            <RelayListsSettings />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
