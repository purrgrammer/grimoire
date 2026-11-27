import { GrimoireNative, pluginErrorCode } from "./grimoire-native";
import { isNativeApp } from "./platform";

export type SaveResult = "saved" | "cancelled";

/** Encode bytes as base64 without blowing the call stack on large files. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Save a blob as a file the user keeps.
 *
 * Web: the classic object-URL anchor, unchanged. App: an Android WebView
 * ignores `<a download>` on a blob URL entirely — the click does nothing — so
 * the bytes go through the system "save as" picker instead. Resolves
 * `"cancelled"` when the user backs out; throws on a real failure.
 */
export async function saveBlob(
  blob: Blob,
  filename: string,
): Promise<SaveResult> {
  if (!isNativeApp()) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return "saved";
  }

  try {
    await GrimoireNative.saveDocument({
      filename,
      mimeType: blob.type || "application/octet-stream",
      base64: await blobToBase64(blob),
    });
    return "saved";
  } catch (error) {
    if (pluginErrorCode(error) === "CANCELLED") return "cancelled";
    throw error;
  }
}
