import { useLiveQuery } from "dexie-react-hooks";
import { Heart, Zap, Trophy, Users, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import supportersService, { MONTHLY_GOAL_SATS } from "@/services/supporters";
import { useProfile } from "@/hooks/useProfile";

function SupporterCard({ pubkey, rank }: { pubkey: string; rank: number }) {
  const profile = useProfile(pubkey);
  const info = useLiveQuery(
    () => supportersService.getSupporterInfo(pubkey),
    [pubkey],
  );

  if (!info) return null;

  const displayName = profile?.name || profile?.display_name || "Anonymous";
  const avatar = profile?.picture;

  const medals = ["🥇", "🥈", "🥉"];
  const medal = rank < 3 ? medals[rank] : null;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border hover:border-primary/50 transition-colors">
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {medal && <span className="text-2xl">{medal}</span>}
        {avatar ? (
          <img
            src={avatar}
            alt={displayName}
            className="w-10 h-10 rounded-full flex-shrink-0"
          />
        ) : (
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-semibold">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{displayName}</div>
          <div className="text-xs text-muted-foreground">
            {info.zapCount} zap{info.zapCount !== 1 ? "s" : ""}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 text-yellow-500 font-bold">
        <Zap className="w-4 h-4" />
        <span>{info.totalSats.toLocaleString()}</span>
      </div>
    </div>
  );
}

export function SupportSection() {
  const monthlyDonations = useLiveQuery(
    () => supportersService.getMonthlyDonations(),
    [],
  );
  const totalDonations = useLiveQuery(
    () => supportersService.getTotalDonations(),
    [],
  );
  const supporterCount = useLiveQuery(
    () => supportersService.getSupporterCount(),
    [],
  );
  const topSupporters = useLiveQuery(async () => {
    const all = await supportersService.getAllSupporters();
    return all.slice(0, 5); // Top 5
  }, []);

  const progressPercent = monthlyDonations
    ? Math.min((monthlyDonations / MONTHLY_GOAL_SATS) * 100, 100)
    : 0;

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Heart className="w-6 h-6 text-red-500" />
          <h2 className="text-2xl font-bold">Support Grimoire</h2>
        </div>
        <p className="text-muted-foreground">
          Help us build the ultimate Nostr developer tool
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Monthly Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {monthlyDonations?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-muted-foreground">
              / {MONTHLY_GOAL_SATS.toLocaleString()} sats goal
            </div>
            <Progress value={progressPercent} className="mt-2" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Zap className="w-4 h-4" />
              All-Time Support
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {totalDonations?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-muted-foreground">sats raised</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Supporters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {supporterCount?.toLocaleString() || 0}
            </div>
            <div className="text-xs text-muted-foreground">contributors</div>
          </CardContent>
        </Card>
      </div>

      {topSupporters && topSupporters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-500" />
              Top Contributors
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topSupporters.map((supporter, index) => (
              <SupporterCard
                key={supporter.pubkey}
                pubkey={supporter.pubkey}
                rank={index}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
        <Button size="lg" className="gap-2">
          <Zap className="w-4 h-4" />
          Support with Lightning
        </Button>
        <div className="text-sm text-muted-foreground">
          Lightning: grimoire@coinos.io
        </div>
      </div>
    </div>
  );
}
