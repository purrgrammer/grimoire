import { useNip05 } from "@/hooks/useNip05";
import { ProfileContent } from "applesauce-core/helpers";
import { GrimoireUsername } from "./GrimoireUsername";
import { isGrimoireMember } from "@/lib/grimoire-members";

export function QueryNip05({
  pubkey,
  nip05,
}: {
  pubkey: string;
  nip05: string;
}) {
  const nip05pubkey = useNip05(nip05);
  if (nip05pubkey === pubkey) return nip05.replace(/^_@/, "");
  return null;
}

export default function Nip05({
  pubkey,
  profile,
}: {
  pubkey: string;
  profile: ProfileContent;
}) {
  // Check if this is a Grimoire member first - they get special display
  if (isGrimoireMember(pubkey)) {
    return <GrimoireUsername pubkey={pubkey} />;
  }

  // Otherwise show regular NIP-05 if available
  if (!profile?.nip05) return null;
  return <QueryNip05 pubkey={pubkey} nip05={profile.nip05} />;
}
