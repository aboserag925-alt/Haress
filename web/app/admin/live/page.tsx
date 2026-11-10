import { notFound } from "next/navigation";
import { adminSetLiveState } from "../../../src/actions/admin";
import { getEntityFields, isAdminEntity } from "../../../src/lib/admin-entities";

/**
 * Stage 4 — Admin live panel: /admin/live
 * Dedicated toggle panel backed by `adminSetLiveState` (admin self-verify +
 * https/allowlisted-domain validation + audit_log). Reads its field set from
 * the `live_state` entity registry.
 */
export default async function AdminLivePage({ params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  const resolvedEntity = entity === "live" ? ("live_state" as const) : entity;
  if (!isAdminEntity(resolvedEntity)) notFound();
  const fields = getEntityFields(resolvedEntity) ?? [];
  if (resolvedEntity !== "live_state") notFound();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">البث المباشر — الإعدادات</h1>
      <p className="mt-2 text-sm text-muted">إعدادات البث المباشر (حالة / رابط / عنوان).</p>
      <form className="mt-6 card-surface space-y-4 p-5" action={adminSetLiveState}>
        <div className="space-y-1">
          <label className="block text-sm font-bold text-gold-soft" htmlFor="is_live">
            الحالة
          </label>
          <select id="is_live" name="is_live" defaultValue="false" className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm">
            <option value="false">إيقاف</option>
            <option value="true">على الهواء</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-bold text-gold-soft" htmlFor="stream_url">
            رابط البث
          </label>
          <input id="stream_url" name="stream_url" type="url" dir="ltr" className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
        </div>
        <div className="space-y-1">
          <label className="block text-sm font-bold text-gold-soft" htmlFor="stream_title">
            عنوان البث
          </label>
          <input id="stream_title" name="stream_title" maxLength={180} className="w-full rounded-lg border border-gold/30 bg-panel p-2 text-sm" />
        </div>
        <button type="submit" className="rounded-full bg-red-600 px-5 py-2 text-sm font-bold text-white">
          حفظ
        </button>
      </form>
      <p className="mt-4 text-xs text-muted">الإعدادات تُكتب بصلاحية مشرف (admin_users) وتُسجَّل في audit_log.</p>
    </main>
  );
}
