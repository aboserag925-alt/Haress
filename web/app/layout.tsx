import type { Metadata, Viewport } from "next";
import "./globals.css";
import PWARegister from "../components/PWARegister";

export const metadata: Metadata = {
  title: "استراحة أهل الأثر",
  description:
    "مجلس لتدارس العلم والأدب: دروس يومية في الحديث والعقيدة والتفسير والفقه — السبت إلى الخميس، والجمعة بلا دروس.",
  manifest: "/manifest.webmanifest",
  applicationName: "أهل الأثر"
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Tajawal at runtime (no build-time font fetch, mirrors legacy-site
            approach so CI/regional builds never need font network access). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
