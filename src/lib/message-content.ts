import type { ContentPart } from "ipa-tools";

/**
 * The text of an IPA message's `content`.
 *
 * Since ipa-tools 0.4, user and assistant `content` is `string | ContentPart[]`
 * (and `null` on an assistant turn that only called tools), where it used to be
 * a string. Grimoire's inference surfaces are text only, so image parts carry
 * nothing it can show or forward and are dropped; text parts are joined as
 * they were sent.
 */
export function contentText(
  content: string | ContentPart[] | null | undefined,
): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
}
