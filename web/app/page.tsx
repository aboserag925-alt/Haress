import Hero from "../components/Hero";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import LiveButton from "../components/LiveButton";
import SectionCard from "../components/SectionCard";
import NextBroadcast from "../src/components/NextBroadcast";

const SECTIONS: Array<{
  id: string;
  title: string;
  note?: string;
  description: string;
}> = [
  {
    id: "lectures",
    title: "المحاضرات والدروس",
    note: "قريبًا",
    description:
      "جدول الدروس اليومية والمحاضرات المسجّلة، مع مواعيد البث المباشر وأرشيف المحاضرات."
  },
  {
    id: "about",
    title: "عن المجلس",
    description:
      "مجلس لتدارس العلم والأدب، فيه دروس يومية في الحديث والعقيدة والتفسير والفقه."
  },
  {
    id: "media",
    title: "المكتبة والمرئيات",
    note: "قريبًا",
    description:
      "الكتب والمقالات والمحاضرات الصوتية والمرئية في مكان واحد، مع إمكانية الاستماع المباشر."
  },
  {
    id: "q",
    title: "الأسئلة",
    note: "قريبًا",
    description:
      "قدّم سؤالك واقرأ أسئلة الناس وأجوبتها، مع منتدى للنقاش بين أهل المجلس."
  },
  {
    id: "prayers",
    title: "مواقيت الصلاة",
    description:
      "مواقيت الصلاة والإمساك والقِبلة حسب موقعك، مع جدول أسبوعي كامل."
  },
  {
    id: "adhkar",
    title: "الأذكار والقرآن",
    description:
      "أذكار الصباح والمساء، وراديو القرآن، وتلاوات مسجّلة بجودة عالية."
  },
  {
    id: "compass",
    title: "القبلة",
    description:
      "اتجاه القبلة بدقة عبر البوصلة الذي يعمل حتى دون اتصال بالإنترنت."
  }
];

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-4">
        <Hero />
        <div className="gold-rule my-4" aria-hidden="true" />
        <NextBroadcast />
        <h2 className="mb-4 text-sm font-bold text-gold-dim">أقسام الموقع</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((s) => (
            <SectionCard key={s.id} {...s} />
          ))}
        </div>
      </main>
      <Footer />
      <LiveButton />
    </>
  );
}
