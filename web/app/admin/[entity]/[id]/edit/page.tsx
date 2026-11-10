import { notFound } from "next/navigation";
import { getSupabaseAdminClient } from "../../../../../src/lib/supabase/admin-client";
import { getEntityFields, isAdminEntity } from "../../../../../src/lib/admin-entities";
import { adminUpdateResource } from "../../../../../src/actions/admin";

/**
 * Stage 3 — Generic admin edit page: /admin/[entity]/[id]/edit
 * Loads a row by id (admin/service client) and renders a validated form via
 * the `adminUpdateResource` server action.
 */
export default async function AdminEntityEditPage({
  params
}: {
  params: Promise<{ entity: string; id: string }>;
}) {
  const { entity, id } = await params;
  if (!isAdminEntity(entity)) notFound();
  const admin = getSupabaseAdminClient();
  if (!admin) notFound();
  const { data, error } = await admin.from(entity).select("*").eq("id", id).maybeSingle();
  if (error || !data) notFound();
  const row = data as Record<string, unknown>;
  const fields = getEntityFields(entity) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">تحرير: {entity}</h1>
      <form className="mt-6 card-surface space-y-4 p-5" action={adminUpdateResource}>
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="id" value={id} />
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="block text-sm font-bold text-gold-soft" htmlFor={`f-${f.key}`}>
              {f.label}
              {f.required ? " *" : ""}
            </label>
            {f.type === "select" ? (
              <select id={`f-${f.key}`} name={`f-${f.key}`} defaultValue={String(row[f.key] ?? f.options?.[0] ?? "draft")} className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm">
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea id={`f-${f.key}`} name={`f-${f.key}`} rows={4} defaultValue={String(row[f.key] ?? "")} className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
            ) : (
              <input id={`f-${f.key}`} name={`f-${f.key}`} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} defaultValue={String(row[f.key] ?? "")} className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
            )}
          </div>
        ))}
        <button type="submit" className="rounded-full bg-red-600 px-5 py-2 text-sm font-bold text-white">
          حفظ
        </button>
      </form>
    </main>
  );
}
