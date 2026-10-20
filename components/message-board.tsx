"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
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
 * - เดินเวลาทุก 100 มิลลิวินาที เพื่อให้แถบเวลาถอยหลังลื่นและตัดข้อความที่หมดอายุตรงเวลา
 * - ข้อความที่หมดอายุจะถูกถอดออกจากรายการ (ผู้ใช้เห็นว่าหายไปจริง)
 * - เลื่อนลงล่างอัตโนมัติเมื่อมีข้อความใหม่ ถ้าผู้ใช้ยังอยู่ใกล้ล่างสุด
 */
export function MessageBoard({
  messages,
  selfId,
  revealNames,
  filterWords,
  onExpire,
  highlightId,
}: {
  messages: ChatMessage[];
  selfId: string;
  revealNames: boolean;
  filterWords: string[];
  onExpire: (ids: string[]) => void;
  highlightId?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const expiredRef = useRef<Set<string>>(new Set());

  // เดินเวลาให้แถบชีวิตและตัวเลขนับถอยหลังอัปเดต
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  // แจ้งฝ่ายที่ดูแลรายการให้ถอดข้อความที่หมดอายุ
  useEffect(() => {
    const dead: string[] = [];
    for (const message of messages) {
      if (remainingMs(message, now) <= 0 && !expiredRef.current.has(message.id)) {
        expiredRef.current.add(message.id);
        dead.push(message.id);
      }
    }
    if (dead.length > 0) onExpire(dead);
  }, [messages, now, onExpire]);

  // เลื่อนตามข้อความใหม่ ถ้าผู้ใช้ยังอยู่ท้ายกระดาน
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !stickToBottom.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages]);

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
      className="feed-scroll h-[52vh] min-h-[280px] space-y-2 overflow-y-auto rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:h-[58vh]"
      aria-live="polite"
      aria-label="กระดานข้อความ"
    >
      {visible.length === 0 ? (
        <p className="flex h-full items-center justify-center text-center text-sm text-slate-400 dark:text-slate-500">
          ยังไม่มีข้อความ — พิมพ์อะไรสั้น ๆ ส่งดูสิ ข้อความจะหายไปในไม่กี่วินาที
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
            highlighted={highlightId === message.id}
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
  highlighted,
}: {
  message: ChatMessage;
  now: number;
  mine: boolean;
  revealNames: boolean;
  filterWords: string[];
  highlighted: boolean;
}) {
  const ratio = lifeRatio(message, now);
  const left = remainingMs(message, now);
  const masked = maskBlockedWords(message.text, filterWords);
  const name = revealNames ? message.senderName : shortId(message.senderId);

  const style: CSSProperties = {
    animationDuration: "260ms",
  };

  return (
    <article
      style={style}
      className={[
        "animate-fade-in rounded-md border px-3 py-2",
        mine
          ? "border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40"
          : "border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40",
        message.kind === "announce"
          ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/30"
          : "",
        highlighted ? "ring-2 ring-amber-400" : "",
      ].join(" ")}
    >
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate font-medium text-slate-600 dark:text-slate-300">
          {message.kind === "announce" ? (
            <span className="mr-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-800/70 dark:text-amber-100">
              ประกาศ
            </span>
          ) : null}
          {name}
          {mine ? <span className="ml-1 text-slate-400">(คุณ)</span> : null}
        </span>
        <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">
          {left <= 0 ? "กำลังหาย" : `${formatRemaining(left)} • ${masked.count > 0 ? `ปิดบัง ${masked.count} คำ • ` : ""}${Math.round(ratio * 100)}%`}
        </span>
      </div>

      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
        {masked.text}
      </p>

      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div
          className={[
            "life-bar h-full rounded-full",
            ratio > 0.5
              ? "bg-emerald-400"
              : ratio > 0.25
                ? "bg-amber-400"
                : "bg-rose-400",
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
