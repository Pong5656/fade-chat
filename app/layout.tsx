import type { Metadata } from "next";
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
  title: "FadeChat — ห้องแชตสดที่ข้อความจางหายไปเอง",
  description:
    "เข้าห้องแล้วพิมพ์ได้ทันทีไม่ต้องล็อกอิน ข้อความจะค่อย ๆ หายไปเอง ยิ่งสั้นยิ่งหายไว ยิ่งยาวยิ่งอยู่นาน เรียลไทม์รองรับ 60+ คนพร้อมกัน",
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
          <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
            <div className="mx-auto w-full max-w-5xl px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link href="/" className="flex flex-col leading-tight">
                  <span className="text-base font-semibold">FadeChat</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    ห้องแชตสด · ข้อความจางหายไปเอง · ไม่ต้องล็อกอิน
                  </span>
                </Link>
                <div className="flex items-center gap-3">
                  <a
                    href="https://github.com/Pong5656"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                  >
                    GitHub
                  </a>
                  <ThemeToggle />
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>

          <footer className="border-t border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/50">
            <div className="mx-auto w-full max-w-5xl px-4 py-5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <p>
                ข้อความทั้งหมดส่งผ่าน MQTT over WebSocket โดยตรงระหว่างเบราว์เซอร์
                ไม่มีเซิร์ฟเวอร์และไม่มีฐานข้อมูลของเรา เมื่อปิดห้องแล้วข้อมูลจะหายทั้งหมด
              </p>
              <p className="mt-1">
                ข้อความที่พิมพ์ไม่ถูกเก็บถาวร และจะถูกลบออกจากเครือข่ายเมื่อหมดอายุโดยอัตโนมัติ
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
