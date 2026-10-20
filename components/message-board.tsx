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
 * กระดานข้อความ สไตล์แอปแชต
 *
 * - ข้อความของตัวเองชิดขวา คนอื่นชิดซ้าย พร้อมรูปย่อและชื่อ
 * - เดินเวลาทุก 200 มิลลิวินาที เพื่อให้แถบชีวิตลื่นและตัดข้อความหมดอายุตรงเวลา
 * - ถ้าข้อความเดียวกันส่งติดกันจากคนเดิม จะไม่แสดงชื่อซ้ำ (เหมือนแอปแชตจริง)
 */
const GROUP_WINDOW_MS = 60_000;

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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

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
      className="feed-scroll chat-canvas flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4 sm:px-5"
      aria-live="polite"
      aria-label="กระดานข้อความ"
    >
      {visible.length === 0 ? (
        <div className="m-auto flex max-w-xs flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/70 text-xl shadow-sm dark:bg-slate-800/70">
            💬
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ยังไม่มีข้อความ เริ่มพิมพ์ได้เลย
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            ข้อความสั้นจะหายไว ข้อความยาวจะอยู่นานขึ้น
          </p>
        </div>
      ) : (
        visible.map((message, index) => {
          const mine = message.senderId === selfId;
          const previous = visible[index - 1];
          const sameSender =
            previous &&
            previous.senderId === message.senderId &&
            message.sentAt - previous.sentAt < GROUP_WINDOW_MS;
          const next = visible[index + 1];
          const continues =
            next &&
            next.senderId === message.senderId &&
            next.sentAt - message.sentAt < GROUP_WINDOW_MS &&
            remainingMs(next, now) > 0;

          return (
            <Bubble
              key={message.id}
              message={message}
              now={now}
              mine={mine}
              revealNames={revealNames}
              filterWords={filterWords}
              showRemaining={showRemaining}
              showName={!sameSender}
              tail={!continues}
            />
          );
        })
      )}
    </div>
  );
}

function Bubble({
  message,
  now,
  mine,
  revealNames,
  filterWords,
  showRemaining,
  showName,
  tail,
}: {
  message: ChatMessage;
  now: number;
  mine: boolean;
  revealNames: boolean;
  filterWords: string[];
  showRemaining: boolean;
  showName: boolean;
  tail: boolean;
}) {
  const ratio = lifeRatio(message, now);
  const left = remainingMs(message, now);
  const masked = maskBlockedWords(message.text, filterWords);
  const name = revealNames ? message.senderName : shortId(message.senderId);
  const fading = ratio < 0.28;

  return (
    <div
      className={[
        "animate-bubble group flex w-full gap-2",
        mine ? "justify-end" : "justify-start",
        showName ? "mt-3" : "mt-0",
      ].join(" ")}
      style={{ opacity: fading ? 0.35 + ratio * 2.3 : 1, transition: "opacity 380ms linear" }}
    >
      {/* รูปย่อของคู่สนทนา (เฉพาะฝั่งซ้าย) */}
      {!mine ? (
        <div className="w-8 shrink-0 self-end">
          {tail ? (
            <Avatar name={name} senderId={message.senderId} />
          ) : null}
        </div>
      ) : null}

      <div className={["flex max-w-[82%] flex-col sm:max-w-[70%]", mine ? "items-end" : "items-start"].join(" ")}>
        {showName ? (
          <span className="mb-1 px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
            {name}
            {message.kind === "announce" ? (
              <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                ประกาศ
              </span>
            ) : null}
          </span>
        ) : null}

        <div
          className={[
            "relative",
            mine
              ? "rounded-[18px] rounded-br-[6px] bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
              : "rounded-[18px] rounded-bl-[6px] bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100",
            message.kind === "announce"
              ? "ring-1 ring-amber-300 dark:ring-amber-700"
              : "",
            "px-3.5 py-2",
          ].join(" ")}
        >
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
            {masked.text}
          </p>

          {/* แถบชีวิตของข้อความ */}
          <div
            className={[
              "mt-1.5 h-[3px] w-full overflow-hidden rounded-full",
              mine ? "bg-white/20 dark:bg-slate-900/15" : "bg-slate-200/80 dark:bg-slate-700/70",
            ].join(" ")}
          >
            <div
              className={[
                "life-bar h-full rounded-full",
                ratio > 0.5
                  ? mine
                    ? "bg-emerald-300"
                    : "bg-emerald-400"
                  : ratio > 0.25
                    ? "bg-amber-400"
                    : "bg-rose-400",
              ].join(" ")}
              style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
            />
          </div>
        </div>

        {/* เวลาที่เหลือ (เฉพาะเจ้าของห้องที่เปิดไว้) */}
        {showRemaining ? (
          <span className="mt-0.5 px-1 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">
            {formatRemaining(left)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const AVATAR_TONES = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-teal-500",
];

/** รูปย่อจากตัวอักษรแรกของชื่อ พร้อมสีคงที่ตามรหัสผู้ใช้ */
function Avatar({ name, senderId }: { name: string; senderId: string }) {
  const initial = firstGrapheme(name);
  const tone = AVATAR_TONES[hash(senderId) % AVATAR_TONES.length];
  return (
    <span
      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white shadow-sm ${tone}`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function firstGrapheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "?";
  const chars = Array.from(trimmed);
  return chars[0].toUpperCase();
}

function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) {
    total = (total * 31 + value.charCodeAt(i)) % 100000;
  }
  return total;
}

function shortId(id: string): string {
  return `ผู้ใช้ ${id.slice(-4)}`;
}
