import Link from "next/link";

export const metadata = {
  title: "غير متصل — استراحة أهل الأثر"
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="text-4xl text-gold" aria-hidden="true">۞</span>
      <h1 className="text-xl font-bold text-gold-soft">لا يوجد اتصال بالإنترنت</h1>
      <p className="leading-7 text-muted">
        تعذر الوصول لهذه الصفحة لأنك غير متصل. الصفحات التي زرتها سابقًا قد
        تعمل من الذاكرة المؤقتة.
      </p>
      <Link
        href="/"
        className="rounded-full border border-gold/40 px-5 py-2 text-sm text-gold-soft hover:bg-panel-light"
      >
        حاول العودة للرئيسية
      </Link>
    </main>
  );
}
