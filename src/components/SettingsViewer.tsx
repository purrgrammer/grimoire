import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Checkbox } from "./ui/checkbox";
import { useSettings } from "@/hooks/useSettings";

export function SettingsViewer() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="h-full flex flex-col">
      <Tabs defaultValue="post" className="flex-1 flex flex-col">
        <div className="border-b px-6 py-3">
          <TabsList>
            <TabsTrigger value="post">Post</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto">
          <TabsContent value="post" className="m-0 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Post Settings</h3>
              <p className="text-sm text-muted-foreground">
                Configure event publishing
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="include-client-tag"
                  checked={settings?.post?.includeClientTag ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("post", "includeClientTag", checked)
                  }
                />
                <div className="space-y-1">
                  <label
                    htmlFor="include-client-tag"
                    className="text-sm cursor-pointer"
                  >
                    Include client tag
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Add Grimoire tag to posts, spells, and deletions
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="appearance" className="m-0 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Appearance</h3>
              <p className="text-sm text-muted-foreground">
                Customize display preferences
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <Checkbox
                  id="show-client-tags"
                  checked={settings?.appearance?.showClientTags ?? true}
                  onCheckedChange={(checked: boolean) =>
                    updateSetting("appearance", "showClientTags", checked)
                  }
                />
                <div className="space-y-1">
                  <label
                    htmlFor="show-client-tags"
                    className="text-sm cursor-pointer"
                  >
                    Show client tags
                  </label>
                  <p className="text-sm text-muted-foreground">
                    Display "via Grimoire" and other client identifiers
                  </p>
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
