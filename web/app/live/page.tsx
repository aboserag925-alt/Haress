import LiveScreen, { type LiveScreenState, type NextBroadcast } from "../../src/components/LiveScreen";
import { getLiveState, getNextBroadcast } from "../../src/lib/live-state";

export const dynamic = "force-dynamic";

/**
 * Stage 4 — public /live page.
 * Reads live state + next broadcast from DB via lib; renders LiveScreen.
 * Public questions section placeholder (content + moderation) is reserved
 * for the upcoming Stage 5.
 */

export default async function LivePage() {
  const live = await getLiveState();
  const next = await getNextBroadcast();
  const state: LiveScreenState = live
    ? { is_live: live.is_live, stream_url: live.stream_url, stream_title: live.stream_title, provider: live.provider, updated_at: live.updated_at }
    : { is_live: false, stream_url: null, stream_title: "", provider: null, updated_at: null };
  const nb: NextBroadcast | null = next
    ? { id: next.id, title: next.title, starts_at_utc: next.starts_at_utc, status: next.status, stream_url: next.stream_url }
    : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-extrabold text-gold-soft">البث المباشر</h1>
      <p className="mt-2 text-sm text-muted">مشاهدة البث أو الانتظار.</p>
      <div className="mt-6">
        <LiveScreen initial={state} next={nb} />
      </div>
      <section id="q" className="mt-10 card-surface p-5" aria-label="أسئلة الجمهور">
        <h2 className="text-lg font-bold text-gold-soft">أسئلة الجمهور</h2>
        <p className="mt-2 text-sm text-muted">قسم استقبال الأسئلة والمراجعات سيُضيف في المرحلة التالية.</p>
      </section>
    </main>
  );
}
