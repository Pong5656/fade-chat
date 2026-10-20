"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_VISIBLE_MESSAGES,
  formatRemaining,
  lifeRatio,
  maskBlockedWords,
  remainingMs,
  type ChatMessage,
} from "@/lib/chat";

/**
 * กระดานข้อความ (ephemeral chat)
 *
 * - เดินเวลาทุก 200 มิลลิวินาที เพื่อให้แถบเวลาถอยหลังลื่นและตัดข้อความหมดอายุตรงเวลา
 * - ข้อความที่หมดอายุจะถูกถอดออกจากรายการทันที
 * - เลื่อนลงล่างอัตโนมัติเมื่อมีข้อความใหม่ ถ้าผู้ใช้ยังอยู่ใกล้ล่างสุด
 * - แสดงเฉพาะเนื้อความที่จำเป็น: ชื่อผู้ส่ง ข้อความ และแถบเวลาที่เหลือ
 */
export function MessageBoard({
  messages,
  selfId,
  revealNames,
  filterWords,
  showRemaining = false,
  onExpire,
}: {
  messages: ChatMessage[];
  selfId: string;
  revealNames: boolean;
  filterWords: string[];
  showRemaining?: boolean;
  onExpire: (ids: string[]) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const expiredRef = useRef<Set<string>>(new Set());

  // เดินเวลาให้แถบชีวิตอัปเดต
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  // แจ้งฝ่ายที่ดูแลรายการให้ถอดข้อความที่หมดอายุ
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;
  useEffect(() => {
    const dead: string[] = [];
    for (const message of messages) {
      if (remainingMs(message, now) <= 0 && !expiredRef.current.has(message.id)) {
        expiredRef.current.add(message.id);
        dead.push(message.id);
      }
    }
    if (dead.length > 0) expireRef.current(dead);
  }, [messages, now]);

  // เลื่อนตามข้อความใหม่ ถ้าผู้ใช้ยังอยู่ท้ายกระดาน
  const count = messages.length;
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [count]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distance < 96;
  }

  const visible = messages
    .filter((message) => remainingMs(message, now) > 0)
    .slice(-MAX_VISIBLE_MESSAGES);

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="feed-scroll flex min-h-[320px] flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 lg:h-[calc(100vh-320px)]"
      aria-live="polite"
      aria-label="กระดานข้อความ"
    >
      {visible.length === 0 ? (
        <p className="m-auto max-w-xs text-center text-sm text-slate-400 dark:text-slate-500">
          ยังไม่มีข้อความ พิมพ์แล้วกด Enter ได้เลย
        </p>
      ) : (
        visible.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            now={now}
            mine={message.senderId === selfId}
            revealNames={revealNames}
            filterWords={filterWords}
            showRemaining={showRemaining}
          />
        ))
      )}
    </div>
  );
}

function MessageRow({
  message,
  now,
  mine,
  revealNames,
  filterWords,
  showRemaining,
}: {
  message: ChatMessage;
  now: number;
  mine: boolean;
  revealNames: boolean;
  filterWords: string[];
  showRemaining: boolean;
}) {
  const ratio = lifeRatio(message, now);
  const left = remainingMs(message, now);
  const masked = maskBlockedWords(message.text, filterWords);
  const name = revealNames ? message.senderName : shortId(message.senderId);
  const isAnnounce = message.kind === "announce";

  return (
    <article
      className={[
        "animate-fade-in rounded-xl border px-3.5 py-2.5 text-[15px]",
        isAnnounce
          ? "border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-800"
          : mine
            ? "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/60"
            : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
          {name}
          {mine ? <span className="ml-1 font-normal text-slate-400">· คุณ</span> : null}
          {isAnnounce ? (
            <span className="ml-1.5 font-medium text-slate-400">ประกาศ</span>
          ) : null}
        </span>
        {showRemaining ? (
          <span className="shrink-0 tabular-nums text-xs text-slate-400 dark:text-slate-500">
            {formatRemaining(left)}
          </span>
        ) : null}
      </div>

      <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-slate-800 dark:text-slate-100">
        {masked.text}
      </p>

      <div className="mt-2 h-px w-full overflow-hidden bg-slate-200 dark:bg-slate-800">
        <div
          className={[
            "life-bar h-full",
            ratio > 0.5 ? "bg-emerald-400" : ratio > 0.25 ? "bg-amber-400" : "bg-rose-400",
          ].join(" ")}
          style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
        />
      </div>
    </article>
  );
}

/** รหัสย่อสำหรับโหมดไม่เปิดเผยชื่อ */
function shortId(id: string): string {
  return `ผู้ใช้ ${id.slice(-4)}`;
}
