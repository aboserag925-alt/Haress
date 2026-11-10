type SectionCardProps = {
  id: string;
  title: string;
  note?: string;
  description: string;
};

/**
 * Card for a site section. `id` deliberately reuses the legacy-site anchors
 * (about/media/q/prayers/adhkar/compass…) so old in-page links keep working.
 */
export default function SectionCard({ id, title, note, description }: SectionCardProps) {
  return (
    <section id={id} className="card-surface p-5 transition-colors">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-gold-soft">{title}</h2>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </div>
      <p className="leading-7 text-sm text-muted">{description}</p>
      <p className="mt-3 text-xs text-gold-dim">
        <span aria-hidden="true">…</span>{" "}
        هذا القسم يكتمل في مراحل لاحقة.
      </p>
    </section>
  );
}
