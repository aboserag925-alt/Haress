import { notFound } from "next/navigation";
import { getSupabaseAdminClient } from "../../../src/lib/supabase/admin-client";
import { isAdminEntity } from "../../../src/lib/admin-entities";

/**
 * Stage 3 — Generic admin list page: /admin/[entity]
 * Lists content rows for an allowed admin entity via the server-only
 * service client (admin boundary).
 */
export default async function AdminEntityPage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!isAdminEntity(entity)) notFound();
  const admin = getSupabaseAdminClient();
  if (!admin) notFound();

  const { data, error } = await admin.from(entity).select("*").order("created_at", { ascending: false });
  if (error) notFound();

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">إدارة: {entity}</h1>
      <p className="mt-2 text-sm text-muted">قائمة المحتوى. الإدراج والتحرير من مسارات /admin/{entity}/create و/admin/{entity}/[id]/edit.</p>
      <div className="mt-6 card-surface overflow-x-auto">
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-gold/20 text-gold-soft">
              <th className="p-3">المعرّف</th>
              <th className="p-3">الحالة</th>
              <th className="p-3">تاريخ الإنشاء</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="p-3 text-muted" colSpan={3}>
                  لا توجد سجلات.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={String(row.id)} className="border-b border-white/5">
                  <td className="p-3">{String(row.id)}</td>
                  <td className="p-3">{String(row.status ?? "—")}</td>
                  <td className="p-3">{String(row.created_at ?? "—")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
