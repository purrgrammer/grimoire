import { toast } from "sonner";
import { GrimoireNative, pluginErrorCode } from "./grimoire-native";
import { classifyNavigation, isNativeApp } from "./platform";

/**
 * Open a URL outside the app: the browser for web links, the wallet for
 * `lightning:`, the signer for `nostrconnect:`.
 *
 * On the web this is `window.open`, exactly as before. In the app it goes
 * through the scheme allowlist and tells the user when nothing on the phone
 * can open it, instead of a tap that silently does nothing.
 */
export async function openExternal(url: string): Promise<boolean> {
  if (!isNativeApp()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  }

  const target = classifyNavigation(url, window.location.origin);
  if (target.kind !== "external") {
    toast.error("Link not opened", {
      description:
        target.kind === "blocked" ? target.reason : "It is a Grimoire link",
    });
    return false;
  }

  try {
    await GrimoireNative.openExternal({ url: target.url });
    return true;
  } catch (error) {
    const code = pluginErrorCode(error);
    toast.error(
      code === "NO_HANDLER"
        ? "No app on this device can open this link"
        : "Link not opened",
      { description: target.url.slice(0, 120) },
    );
    return false;
  }
}
