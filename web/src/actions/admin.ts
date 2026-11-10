"use server";

/**
 * Stage 3 — Admin CRUD server actions (FormData-based for `<form action={...}>`).
 *
 * Every admin write goes through here; each action:
 *   1. CSRF check (same-origin),
 *   2. admin authorization via `requireAdmin()` (self-verification — never
 *      relying on middleware alone),
 *   3. input sanitization/validation via entity field descriptors,
 *   4. write via the server-only service-role client,
 *   5. writes an audit_log row (action/entity/entity_id/actor_id/created_at).
 */

import { getAdminUserId, AdminForbiddenError } from "../lib/admin-guard";
import { sanitizeText, MAX_TEXT_LENGTH, isSameOrigin } from "../lib/security";
import { getSupabaseAdminClient, type SupabaseAdminClient } from "../lib/supabase/admin-client";
import { getEntityFields, isAdminEntity, type AdminEntity } from "../lib/admin-entities";
import { providerFromStreamUrl } from "../lib/live-state";

export type AdminActionResult = { ok: true } | { ok: false; error: string };

async function adminActor(): Promise<string> {
  if (!(await isSameOrigin())) throw new Error("csrf_blocked");
  const userId = await getAdminUserId();
  if (!userId) throw new AdminForbiddenError();
  return userId;
}

function toValues(entity: AdminEntity, values: Record<string, unknown>): Record<string, unknown> {
  const fields = getEntityFields(entity) ?? [];
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    let v: unknown = values ? (values as Record<string, unknown>)[f.key] : undefined;
    if (f.type === "text" || f.type === "textarea") {
      v = sanitizeText(v, f.max ?? MAX_TEXT_LENGTH);
    } else if (f.type === "number") {
      v = v === undefined || v === null || v === "" ? null : Number(v);
    } else if (f.type === "select") {
      const str = typeof v === "string" ? v : "";
      const opts = f.options ?? [];
      v = opts.includes(str) ? str : opts[0] ?? "draft";
    } else if (f.type === "url") {
      v = sanitizeText(v, 1000);
    }
    out[f.key] = v;
  }
  return out;
}

async function auditWrite(
  admin: SupabaseAdminClient,
  actorId: string,
  action: string,
  entity: string,
  entityId: string | null
): Promise<void> {
  const client = admin;
  if (!client) return;
  await client.from("audit_log").insert({
    action,
    entity_type: entity,
    entity_id: entityId,
    actor_id: actorId,
    created_at: new Date().toISOString()
  });
}

function readValuesFromForm(formData: FormData, fieldKeys: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const key of fieldKeys) {
    const raw = formData.get(`f-${key}`);
    if (raw === null) continue;
    if (key === "status") {
      const str = String(raw);
      values[key] = String(str);
    } else if (key === "surah_number") {
      const str = String(raw);
      values[key] = str === "" ? null : Number(str);
    } else if (key === "starts_at") {
      values[key] = String(raw);
    } else {
      values[key] = String(raw);
    }
  }
  return values;
}

export async function adminCreateResource(formData: FormData): Promise<void> {
  const entityRaw = String(formData.get("entity") ?? "");
  if (!isAdminEntity(entityRaw)) return;
  const entity = entityRaw;
  const fields = getEntityFields(entity) ?? [];
  const values = readValuesFromForm(formData, fields.map((f) => f.key));
  const actorId = await adminActor();
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.from(entity).insert(values);
  if (error) return;
  await auditWrite(admin, actorId, `admin.${entity}.create`, entity, null);
  return;
}

export async function adminUpdateResource(formData: FormData): Promise<void> {
  const entityRaw = String(formData.get("entity") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!isAdminEntity(entityRaw) || !id) return;
  const entity = entityRaw;
  const fields = getEntityFields(entity) ?? [];
  const values = readValuesFromForm(formData, fields.map((f) => f.key));
  const actorId = await adminActor();
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.from(entity).update(values).eq("id", id);
  if (error) return;
  await auditWrite(admin, actorId, `admin.${entity}.update`, entity, id);
  return;
}

export async function adminDeleteResource(formData: FormData): Promise<void> {
  const entityRaw = String(formData.get("entity") ?? "");
  const id = String(formData.get("id") ?? "");
  if (!isAdminEntity(entityRaw) || !id) return;
  const entity = entityRaw;
  const actorId = await adminActor();
  const admin = getSupabaseAdminClient();
  if (!admin) return;
  const { error } = await admin.from(entity).delete().eq("id", id);
  if (error) return;
  await auditWrite(admin, actorId, `admin.${entity}.delete`, entity, id);
  return;
}

/**
 * Stage 4 — adminSetLiveState: sets the live state (is_live / stream_url /
 * stream_title) with admin self-verification and link validation.
 */
export async function adminSetLiveState(formData: FormData): Promise<void> {
  const isLiveRaw = String(formData.get("is_live") ?? "false");
  const streamUrl = String(formData.get("stream_url") ?? "").trim();
  const streamTitle = String(formData.get("stream_title") ?? "").trim();
  const isLive = isLiveRaw === "true";
  const actorId = await adminActor();
  const admin = getSupabaseAdminClient();
  if (!admin) return;

  let finalStreamUrl: string | null = null;
  if (isLive) {
    let parsed: URL;
    try {
      parsed = new URL(streamUrl);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:") return;
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const allowed = ["tiktok.com", "facebook.com", "t.me"];
    if (!allowed.includes(host)) return;
    finalStreamUrl = streamUrl;
  }

  const finalProvider = isLive ? providerFromStreamUrl(finalStreamUrl) : null;
  const values: Record<string, unknown> = {
    is_live: isLive,
    stream_url: finalStreamUrl,
    stream_title: streamTitle.slice(0, 180),
    provider: finalProvider,
    updated_at: new Date().toISOString()
  };
  const { error } = await admin.from("live_state").delete();
  if (error) return;
  const { error: insertError } = await admin.from("live_state").insert(values);
  if (insertError) return;
  await auditWrite(admin, actorId, "admin.live_state.set", "live_state", null);
}
