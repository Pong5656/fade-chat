import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatRoom } from "@/components/chat-room";
import { isValidRoomCode, normalizeRoomCode } from "@/lib/chat";

export const metadata: Metadata = {
  title: "ห้องแชต | FadeChat",
  description: "ห้องแชตสดที่ข้อความจางหายไปเองตามความยาว",
};

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ owner?: string }>;
}) {
  const { code } = await params;
  const { owner } = await searchParams;
  const roomCode = normalizeRoomCode(code);
  if (!isValidRoomCode(roomCode)) notFound();
  return <ChatRoom roomCode={roomCode} ownerHint={owner === "1"} />;
}
