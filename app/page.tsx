import type { Metadata } from "next";
import { Lobby } from "@/components/lobby";

export const metadata: Metadata = {
  title: "FadeChat — สร้างห้องแชตที่ข้อความจางหายไปเอง",
  description:
    "สร้างห้องแชตแล้วแจกรหัสให้ทุกคนเข้าพร้อมกัน ไม่ต้องล็อกอิน ข้อความจางหายไปเองตามความยาว",
};

export default function HomePage() {
  return <Lobby />;
}
