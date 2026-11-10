import { redirect } from "next/navigation";
import { getAdminUserId } from "../../src/lib/admin-guard";

/**
 * Stage 3 — Admin overview page.
 * Protected twice: middleware (/admin matcher) + server-side admin check here.
 */
export default async function AdminPage() {
  const userId = await getAdminUserId();
  if (!userId) {
    redirect("/?auth=admin-denied");
  }
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">لوحة الإدارة</h1>
      <p className="mt-2 text-sm text-muted">إدارة المحتوى (المحاضرات، السلاسل، المقالات، الكتب، التلاوات).</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="card-surface p-5">
          <h2 className="text-lg font-bold text-gold-soft">المحاضرات</h2>
          <p className="mt-1 text-sm text-muted">إنشاء وتحرير وإدراج محاضرة.</p>
        </div>
        <div className="card-surface p-5">
          <h2 className="text-lg font-bold text-gold-soft">السلاسل</h2>
          <p className="mt-1 text-sm text-muted">إنشاء وتحرير وإدراج سلسلة.</p>
        </div>
        <div className="card-surface p-5">
          <h2 className="text-lg font-bold text-gold-soft">المقالات</h2>
          <p className="mt-1 text-sm text-muted">إنشاء وتحرير وإدراج مقال.</p>
        </div>
        <div className="card-surface p-5">
          <h2 className="text-lg font-bold text-gold-soft">الكتب</h2>
          <p className="mt-1 text-sm text-muted">إنشاء وتحرير وإدراج كتاب.</p>
        </div>
        <div className="card-surface p-5">
          <h2 className="text-lg font-bold text-gold-soft">التلاوات</h2>
          <p className="mt-1 text-sm text-muted">إنشاء وتحرير وإدراج تلاوة.</p>
        </div>
      </div>
    </main>
  );
}
