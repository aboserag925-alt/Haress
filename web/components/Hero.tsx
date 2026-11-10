export default function Hero() {
  return (
    <section id="live" className="mx-auto max-w-5xl px-4 pt-10 pb-6">
      <div className="grid items-center gap-8 md:grid-cols-[180px_1fr]">
        {/* Doctor's photo in an arch frame */}
        <div className="arch-frame mx-auto w-40 md:w-full" dir="ltr">
          <img
            src="/images/logo.jpg"
            alt="صورة الدكتور"
            width={220}
            height={220}
            className="w-full object-cover"
            fetchPriority="high"
          />
        </div>
        <div>
          <h1 className="font-extrabold tracking-tight text-gold-soft text-3xl md:text-4xl">
            استراحة أهل الأثر
          </h1>
          <div className="gold-rule my-3 w-40" aria-hidden="true" />
          <p className="max-w-xl leading-8 text-muted">
            مجلس لتدارس العلم والأدب، فيه دروس يومية في الحديث والعقيدة والتفسير
            والفقه. الدروس: من السبت إلى الخميس، الساعة 7:00 والساعة 10:00
            مساءً، والجمعة بلا دروس.
          </p>
        </div>
      </div>
    </section>
  );
}
