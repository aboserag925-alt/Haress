const SOCIALS: Array<{ href: string; label: string }> = [
  { href: "https://www.youtube.com/@Khaled_Najm", label: "قناة يوتيوب" },
  { href: "https://www.tiktok.com/@d.khaled.4", label: "تيك توك" },
  { href: "https://t.me/khaled_najm1", label: "تيليجرام" }
];

export default function Footer() {
  return (
    <footer className="mt-12 border-t border-gold/20 px-4 py-8">
      <div className="mx-auto max-w-5xl">
        <nav aria-label="حسابات المجلس" className="flex flex-wrap items-center gap-3">
          {SOCIALS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-gold/30 px-4 py-1.5 text-sm text-gold-soft transition hover:bg-panel-light"
            >
              {s.label}
            </a>
          ))}
        </nav>
        <p className="mt-4 text-xs text-muted">
          استراحة أهل الأثر — وُضع هذا الموقع الجديد لتكملة الموقع القائم؛
          الموقع القديم وروابطه تبقى صالحة.
        </p>
      </div>
    </footer>
  );
}
