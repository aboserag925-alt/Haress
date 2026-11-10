const LINKS: Array<{ href: string; label: string }> = [
  { href: "/", label: "الرئيسية" },
  { href: "#live", label: "البث" },
  { href: "#lectures", label: "المحاضرات" },
  { href: "#about", label: "عن المجلس" },
  { href: "#media", label: "المكتبة" },
  { href: "#q", label: "الأسئلة" },
  { href: "#prayers", label: "مواقيت الصلاة" },
  { href: "#adhkar", label: "الأذكار" },
  { href: "#compass", label: "القبلة" }
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-gold/20 bg-bg/90 backdrop-blur">
      <nav aria-label="التنقل الرئيسي" className="mx-auto max-w-5xl px-4">
        <div className="flex h-14 items-center justify-between">
          <a href="/" className="flex items-center gap-2 font-bold text-gold-soft">
            <span aria-hidden="true" className="text-lg">۞</span>
            <span>أهل الأثر</span>
          </a>
          <ul className="hidden md:flex md:items-center md:gap-1">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="rounded-md px-3 py-2 text-sm text-muted transition hover:bg-panel-light hover:text-gold-soft"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <details className="relative md:hidden">
            <summary
              className="list-none rounded-md border border-gold/30 px-3 py-1.5 text-sm text-gold-soft"
              aria-label="افتح القائمة"
            >
              القائمة
            </summary>
            <ul className="absolute left-0 top-12 w-48 rounded-xl border border-gold/30 bg-panel p-2 shadow-xl">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="block rounded-lg px-3 py-2 text-sm text-muted hover:bg-panel-light hover:text-gold-soft"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </nav>
    </header>
  );
}
