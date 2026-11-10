import { notFound } from "next/navigation";
import { getEntityFields, isAdminEntity } from "../../../../src/lib/admin-entities";
import { adminCreateResource } from "../../../../src/actions/admin";

/**
 * Stage 3 — Generic admin create page: /admin/[entity]/create
 * Renders a validated form from entity field descriptors, submits via
 * the `adminCreateResource` server action (self-verifying admin guard inside).
 */
export default async function AdminEntityCreatePage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!isAdminEntity(entity)) notFound();
  const fields = getEntityFields(entity) ?? [];

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">إنشاء: {entity}</h1>
      <form className="mt-6 card-surface space-y-4 p-5" action={adminCreateResource}>
        <input type="hidden" name="entity" value={entity} />
        {fields.map((f) => (
          <div key={f.key} className="space-y-1">
            <label className="block text-sm font-bold text-gold-soft" htmlFor={`f-${f.key}`}>
              {f.label}
              {f.required ? " *" : ""}
            </label>
            {f.type === "select" ? (
              <select id={`f-${f.key}`} name={`f-${f.key}`} defaultValue={f.options?.[0]} className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm">
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea id={`f-${f.key}`} name={`f-${f.key}`} rows={4} defaultValue="" className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
            ) : (
              <input id={`f-${f.key}`} name={`f-${f.key}`} type={f.type === "number" ? "number" : f.type === "url" ? "url" : "text"} defaultValue="" className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
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
