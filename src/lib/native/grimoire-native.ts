import { registerPlugin } from "@capacitor/core";

/**
 * The app's own Capacitor plugin (android/app/src/main/java/rocks/grimoire/app/
 * GrimoireNativePlugin.java). Two jobs a WebView cannot do by itself:
 *
 * - hand a URL to another app, with the scheme allowlist enforced again on
 *   the native side, and report when no app can take it;
 * - save bytes where the user chooses, through the Storage Access Framework
 *   (ACTION_CREATE_DOCUMENT), which needs no storage permission at all.
 *
 * No web implementation: callers check `isNativeApp()` first.
 */
export interface GrimoireNativePlugin {
  /** Rejects with code `BLOCKED` or `NO_HANDLER`. */
  openExternal(options: { url: string }): Promise<void>;
  /**
   * Ask the user where to save, then write `base64` there. Rejects with code
   * `CANCELLED` when the user backs out of the picker.
   */
  saveDocument(options: {
    filename: string;
    mimeType: string;
    base64: string;
  }): Promise<{ uri: string }>;
}

export const GrimoireNative =
  registerPlugin<GrimoireNativePlugin>("GrimoireNative");

/** The `code` a rejected plugin call carries, if any. */
export function pluginErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
