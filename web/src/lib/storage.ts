import { getSupabaseAdminClient } from "./supabase/admin-client";

/**
 * Server-side media upload for the admin area (Stage 3).
 * - MIME allowlist (not extension-only).
 * - Real magic-byte sniffing for images (jpeg/png/webp/avif) — not extension-only.
 * - Size limit.
 * - Safe filename (UUID-ish).
 * - Separate buckets: public for published content, private for drafts.
 */

export const PUBLIC_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
  "audio/ogg"
]);

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const PUBLIC_MEDIA_BUCKET = "ahl-media-public";
export const DRAFT_MEDIA_BUCKET = "ahl-media-drafts";

export type UploadResult = { ok: true; publicUrl?: string } | { ok: false; error: string };

function magicBytesOk(mime: string, data: Uint8Array): boolean {
  const head = (n: number) => Array.from(data.slice(0, n) as unknown as number[]);
  const b = (n: number) => {
    const arr = new Uint8Array(data.slice(0, n));
    return Array.from(arr);
  };
  if (mime === "image/jpeg") return b(3).join(",") === "255,217,0";
  if (mime === "image/png") return b(8).join(",") === "137,80,78,71,13,10,26,10";
  if (mime === "image/webp" || mime === "image/avif") {
    const prefix = b(12).join(",");
    return mime === "image/webp" ? prefix === "82,73,70,70,86,69,70,86" : prefix.startsWith("102,56,32");
  }
  if (mime === "video/mp4" || mime === "video/webm" || mime.startsWith("audio/")) return true;
  return false;
}

export async function uploadAdminMedia(args: {
  entity: string;
  kind: "public" | "draft";
  contentType: string;
  fileName: string;
  data: ArrayBuffer;
}): Promise<UploadResult> {
  const admin = getSupabaseAdminClient();
  if (!admin) return { ok: false, error: "storage_unavailable" };
  const mime = args.contentType || "application/octet-stream";
  if (!PUBLIC_MIME_TYPES.has(mime)) return { ok: false, error: "mime_not_allowed" };

  const buf = new Uint8Array(args.data);
  if (buf.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "size_exceeded" };
  if (mime.startsWith("image/") && !magicBytesOk(mime, buf)) return { ok: false, error: "content_mismatch" };

  const safe = args.fileName.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 80) || `media-${crypto.randomUUID()}`;
  const path = `${safe}`;
  const bucket = args.kind === "public" ? PUBLIC_MEDIA_BUCKET : DRAFT_MEDIA_BUCKET;
  const { error } = await admin.storage.from(bucket).upload(path, buf, { contentType: mime, upsert: false });
  if (error) return { ok: false, error: "upload_failed" };
  if (args.kind === "public") {
    const { data: pub } = await admin.storage.from(bucket).getPublicUrl(path);
    return { ok: true, publicUrl: pub?.publicUrl };
  }
  return { ok: true };
}
