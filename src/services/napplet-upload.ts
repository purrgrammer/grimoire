/**
 * NAP-UPLOAD backed by grimoire's Blossom client.
 *
 * Kehto's design puts consent, quotas and rail policy behind the `Uploader`
 * seam rather than in the service, so the limits live here.
 *
 * Note what the `upload:write` grant actually authorises: bytes leave the
 * browser to a server the user configured, authenticated with a Blossom auth
 * event signed as the user, and land at a public URL permanently associated
 * with their pubkey. That is the whole risk, and it is why the capability is
 * consented per napplet rather than assumed.
 */

import type { Uploader, UploadRequest, UploadResult } from "@kehto/services";
import { uploadBlobToServers, getActiveAccountServers } from "./blossom";
import type { UploadResult as BlossomUploadResult } from "./blossom";

/** Per-upload ceiling. Blossom servers impose their own; this is ours. */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function toFile(request: UploadRequest): File {
  const name = request.filename?.trim() || "napplet-upload";
  const type = request.mimeType || "application/octet-stream";
  return request.data instanceof Blob
    ? new File([request.data], name, { type })
    : new File([request.data], name, { type });
}

export function createBlossomUploader(): Uploader {
  return {
    async upload(request, ctx): Promise<UploadResult> {
      const uploadId = ctx.uploadId;
      const file = toFile(request);

      if (file.size > MAX_UPLOAD_BYTES) {
        return {
          ok: false,
          uploadId,
          status: "failed",
          rail: "blossom",
          error: `File is ${Math.round(file.size / 1024 / 1024)} MB; the limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
        };
      }

      const servers = await getActiveAccountServers();
      if (servers.length === 0) {
        return {
          ok: false,
          uploadId,
          status: "failed",
          rail: "blossom",
          error: "No Blossom servers are configured for this account.",
        };
      }

      const {
        results,
        errors,
      }: {
        results: BlossomUploadResult[];
        errors: { server: string; error: string }[];
      } = await uploadBlobToServers(file, servers);
      const first = results[0];
      if (!first) {
        return {
          ok: false,
          uploadId,
          status: "failed",
          rail: "blossom",
          error:
            errors[0]?.error ?? "Every Blossom server rejected the upload.",
        };
      }

      return {
        ok: true,
        uploadId,
        status: "complete",
        rail: "blossom",
        url: first.blob.url,
        fallbackUrls: results.slice(1).map((r) => r.blob.url),
        sha256: first.blob.sha256,
        size: first.blob.size,
        mimeType: first.blob.type ?? file.type,
      };
    },
  };
}
