/**
 * Sanitizes a filename by removing invalid characters and enforcing length limits
 * Prevents path traversal and filesystem errors
 */
export function sanitizeFilename(filename: string): string {
  return (
    filename
      .trim()
      // Remove invalid filesystem characters
      .replace(/[/\\:*?"<>|]/g, "_")
      // Remove leading dots (hidden files)
      .replace(/^\.+/, "")
      // Remove trailing dots
      .replace(/\.+$/, "")
      // Limit to safe filename length (255 is filesystem max)
      .substring(0, 255)
  );
}
