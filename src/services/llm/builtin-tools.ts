/**
 * Built-in Tools for AI Chat
 *
 * These tools are automatically registered with the tool registry.
 */

import { firstValueFrom, filter, timeout, catchError, of } from "rxjs";
import { getProfileContent } from "applesauce-core/helpers";
import accounts from "@/services/accounts";
import eventStore from "@/services/event-store";
import { toolRegistry, type Tool } from "./tools";

// ─────────────────────────────────────────────────────────────
// get_my_profile - Returns the logged-in user's profile
// ─────────────────────────────────────────────────────────────

const getMyProfileTool: Tool = {
  name: "get_my_profile",
  description:
    "Get the profile information of the currently logged-in user. Returns their display name, about, picture, and other metadata. Returns an error if no user is logged in.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  async execute(_args, _context) {
    // Get the active account
    const account = accounts.active$.getValue();

    if (!account) {
      return {
        success: false,
        content: "",
        error: "No user is currently logged in",
      };
    }

    const pubkey = account.pubkey;

    try {
      // Try to get the profile from the event store
      const profileEvent = await firstValueFrom(
        eventStore.replaceable(0, pubkey).pipe(
          filter((event) => event !== undefined),
          timeout(5000),
          catchError(() => of(undefined)),
        ),
      );

      if (!profileEvent) {
        return {
          success: true,
          content: JSON.stringify({
            pubkey,
            profile: null,
            message: "User is logged in but no profile metadata found",
          }),
        };
      }

      const profile = getProfileContent(profileEvent);

      if (!profile) {
        return {
          success: true,
          content: JSON.stringify({
            pubkey,
            profile: null,
            message:
              "User is logged in but profile metadata could not be parsed",
          }),
        };
      }

      return {
        success: true,
        content: JSON.stringify({
          pubkey,
          profile: {
            name: profile.name,
            display_name: profile.display_name,
            about: profile.about,
            picture: profile.picture,
            banner: profile.banner,
            website: profile.website,
            nip05: profile.nip05,
            lud16: profile.lud16,
          },
        }),
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Failed to fetch profile: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
};

// ─────────────────────────────────────────────────────────────
// Register all built-in tools
// ─────────────────────────────────────────────────────────────

export function registerBuiltinTools(): void {
  toolRegistry.register(getMyProfileTool);
}

// Auto-register on import
registerBuiltinTools();
