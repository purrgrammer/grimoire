import { useNip05 } from "@/hooks/useNip05";
import { ProfileContent } from "applesauce-core/helpers";
import { isGrimoirePremium, isGrimoireNip05 } from "@/lib/nip05-grimoire";
import { Check } from "lucide-react";

export function QueryNip05({
  pubkey,
  nip05,
}: {
  pubkey: string;
  nip05: string;
}) {
  const nip05pubkey = useNip05(nip05);

  // Only show if verified
  if (nip05pubkey !== pubkey) return null;

  // Check if this is a grimoire.rocks premium user (by pubkey or NIP-05)
  const isPremium = isGrimoirePremium(pubkey) || isGrimoireNip05(nip05);
  const displayNip05 = nip05.replace(/^_@/, "");

  return (
    <span className="flex items-center gap-1">
      {displayNip05}
      {isPremium && <Check className="inline-block h-3 w-3 text-orange-400" />}
    </span>
  );
}

export default function Nip05({
  pubkey,
  profile,
}: {
  pubkey: string;
  profile: ProfileContent;
}) {
  if (!profile?.nip05) return null;
  return <QueryNip05 pubkey={pubkey} nip05={profile.nip05} />;
}
