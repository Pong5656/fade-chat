import type { Metadata, Viewport } from "next";
import { Sarabun } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { ThemeToggle } from "@/components/theme-toggle";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sarabun",
  display: "swap",
});

export const metadata: Metadata = {
  title: "FadeChat — ห้องแชตที่ข้อความจางหายไปเอง",
  description:
    "เข้าห้องแล้วพิมพ์ได้ทันทีไม่ต้องล็อกอิน ข้อความจะค่อย ๆ หายไปเอง ข้อความสั้นหายไว ข้อความยาวอยู่นาน เรียลไทม์รองรับ 60+ คนพร้อมกัน",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

const themeScript = `
(function () {
  try {
    var saved = localStorage.getItem("fade-chat:theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (saved === "dark" || (!saved && prefersDark)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={sarabun.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="font-sans">
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/85">
            <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-base shadow-sm dark:bg-slate-100">
                  💬
                </span>
                <span className="flex flex-col leading-tight">
                  <span className="text-[15px] font-semibold">FadeChat</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    ข้อความจางหายไปเอง
                  </span>
                </span>
              </Link>
              <div className="flex items-center gap-2">
                <a
                  href="https://github.com/Pong5656/fade-chat"
                  target="_blank"
                  rel="noreferrer"
                  className="hidden rounded-lg px-2.5 py-1.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 sm:block"
                >
                  GitHub
                </a>
                <ThemeToggle />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-4 sm:px-4 sm:py-6">
            {children}
          </main>

          <footer className="mt-4 border-t border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="mx-auto w-full max-w-6xl px-4 py-4 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
              ข้อความส่งผ่าน MQTT over WebSocket ระหว่างเบราว์เซอร์โดยตรง
              ไม่มีเซิร์ฟเวอร์และไม่มีฐานข้อมูลของเรา ข้อความจะถูกลบออกจากเครือข่ายเมื่อหมดอายุ
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
