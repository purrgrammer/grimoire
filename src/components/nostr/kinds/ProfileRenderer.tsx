import { BaseEventContainer, type BaseEventProps } from "./BaseEventRenderer";
import { useProfile } from "@/hooks/useProfile";
import { UserName } from "../UserName";
import Nip05 from "../nip05";
import { RichText } from "../RichText";

/**
 * Renderer for Kind 0 - Profile Metadata
 * Displays as a compact profile card in feed view
 */
export function Kind0Renderer({ event }: BaseEventProps) {
  const pubkey = event.pubkey;
  const profile = useProfile(pubkey);

  const about = profile?.about;
  const website = profile?.website;

  return (
    <BaseEventContainer event={event}>
      <div className="flex flex-col gap-3">
        {/* Profile Info */}
        <div className="flex flex-col gap-2 p-3 border border-muted bg-muted/20">
          <div className="flex flex-col gap-0">
            {/* Name */}
            <div className="flex items-center gap-2">
              <UserName
                pubkey={event.pubkey}
                className="text-lg font-semibold text-foreground"
              />
            </div>

            {/* NIP-05 */}
            {profile?.nip05 && (
              <span className="text-xs text-muted-foreground">
                <Nip05 profile={profile} pubkey={pubkey} />
              </span>
            )}
          </div>

          {/* About */}
          {about && (
            <p className="text-sm text-muted-foreground line-clamp-5">
              <RichText event={{ ...event, content: about }} />
            </p>
          )}

          {/* Website */}
          {website && (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline break-all"
            >
              {website}
            </a>
          )}
        </div>
      </div>
    </BaseEventContainer>
  );
}
