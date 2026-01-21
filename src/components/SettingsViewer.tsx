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
import {
  Palette,
  FileEdit,
  Heart,
  HeartCrack,
  Trophy,
  Coffee,
  Pizza,
  Gift,
  Star,
  Crown,
} from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";
import { useLiveQuery } from "dexie-react-hooks";
import db from "@/services/db";
import { useGrimoire } from "@/core/state";
import { GRIMOIRE_DONATE_PUBKEY } from "@/lib/grimoire-members";
import { MONTHLY_GOAL_SATS } from "@/services/supporters";
import supportersService from "@/services/supporters";
import { UserName } from "./nostr/UserName";

export function SettingsViewer() {
  const { settings, updateSetting } = useSettings();
  const { themeId, setTheme, availableThemes } = useTheme();
  const { addWindow } = useGrimoire();

  // Calculate monthly donations using supporters service
  const monthlyDonations =
    useLiveQuery(() => supportersService.getMonthlyDonations(), []) ?? 0;

  // Get top 3 donors of the month
  const topDonors = useLiveQuery(async () => {
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const donorMap = new Map<string, number>();

    await db.grimoireZaps
      .where("timestamp")
      .aboveOrEqual(thirtyDaysAgo)
      .each((zap) => {
        const current = donorMap.get(zap.senderPubkey) || 0;
        donorMap.set(zap.senderPubkey, current + zap.amountSats);
      });

    return Array.from(donorMap.entries())
      .map(([pubkey, sats]) => ({ pubkey, sats }))
      .sort((a, b) => b.sats - a.sats)
      .slice(0, 3);
  }, []);

  // Calculate monthly donation progress
  const goalProgress = (monthlyDonations / MONTHLY_GOAL_SATS) * 100;

  // Format amount for display
  function formatAmount(amount: number): string {
    if (amount >= 1_000_000) {
      return `${(amount / 1_000_000).toFixed(1)}M`;
    } else if (amount >= 1_000) {
      return `${Math.floor(amount / 1_000)}k`;
    }
    return amount.toLocaleString();
  }

  // Contribution tiers with icons
  const contributionTiers = [
    { amount: 210, icon: Coffee },
    { amount: 2100, icon: Pizza },
    { amount: 21000, icon: Gift },
    { amount: 42000, icon: Heart },
    { amount: 210000, icon: Star },
    { amount: 1000000, icon: Crown },
  ];

  function openSupportWindow(amount: number) {
    addWindow(
      "zap",
      {
        recipientPubkey: GRIMOIRE_DONATE_PUBKEY,
        defaultAmount: amount,
      },
      "Support Grimoire",
    );
  }

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
            <TabsTrigger value="support" className="gap-2">
              {settings?.appearance?.showMonthlyGoal ? (
                <Heart className="h-4 w-4" />
              ) : (
                <HeartCrack className="h-4 w-4" />
              )}
              Support
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

          <TabsContent value="support" className="m-0 p-6 space-y-6">
            <div>
              <h3 className="text-lg font-semibold mb-1">Support Grimoire</h3>
              <p className="text-sm text-muted-foreground">
                Fund grimoire development
              </p>
            </div>

            {/* Show Monthly Goal Toggle */}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <label
                  htmlFor="show-monthly-goal"
                  className="text-base font-medium cursor-pointer"
                >
                  Show monthly goal
                </label>
                <p className="text-xs text-muted-foreground">
                  Display donation progress in UI
                </p>
              </div>
              <Switch
                id="show-monthly-goal"
                checked={settings?.appearance?.showMonthlyGoal ?? true}
                onCheckedChange={(checked: boolean) =>
                  updateSetting("appearance", "showMonthlyGoal", checked)
                }
              />
            </div>

            {/* Monthly Goal Progress */}
            <div
              className={`space-y-3 ${!settings?.appearance?.showMonthlyGoal ? "blur-sm pointer-events-none" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Monthly Goal</span>
                <span className="text-sm text-muted-foreground">
                  {goalProgress.toFixed(0)}%
                </span>
              </div>
              <Progress value={goalProgress} className="h-2" />
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  <span className="text-foreground font-semibold">
                    {formatAmount(monthlyDonations)}
                  </span>
                  {" raised"}
                </span>
                <span className="text-muted-foreground">
                  {formatAmount(MONTHLY_GOAL_SATS)}
                </span>
              </div>
            </div>

            {/* Contribution Tiers */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium">Contribute</h4>
              <div className="grid grid-cols-3 gap-2">
                {contributionTiers.map(({ amount, icon: Icon }) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="default"
                    onClick={() => openSupportWindow(amount)}
                    className="flex-col h-auto py-3 gap-1"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-sm font-semibold">
                      {formatAmount(amount)}
                    </span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Top Contributors This Month */}
            {topDonors && topDonors.length > 0 && (
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Top Contributors</h4>
                <div className="space-y-2">
                  {topDonors.map((donor, index) => (
                    <div
                      key={donor.pubkey}
                      className="flex items-center justify-between py-2"
                    >
                      <div className="flex items-center gap-3">
                        {index === 0 ? (
                          <Trophy className="h-5 w-5 text-yellow-500 fill-yellow-500" />
                        ) : (
                          <span className="text-base font-bold text-muted-foreground w-5 text-center">
                            {index + 1}
                          </span>
                        )}
                        <UserName pubkey={donor.pubkey} />
                      </div>
                      <span className="text-lg font-bold text-primary">
                        {formatAmount(donor.sats)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
