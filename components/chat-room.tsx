"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatMessageSchema,
  MAX_MESSAGE_LENGTH,
  cleanName,
  findBlockedWords,
  isValidRoomCode,
  messageId,
  messageTtlMs,
  newDeviceId,
  normalizeRoomCode,
  type ChatMessage,
} from "@/lib/chat";
import { useChatConnection } from "@/lib/connection";
import { readName, writeLastRoom, writeName } from "@/lib/storage";
import { MessageBoard } from "@/components/message-board";

/**
 * หน้าห้องแชตสด
 *
 * สถาปัตยกรรม: ไม่มีเซิร์ฟเวอร์กลาง
 * - ข้อความถูกส่งแบบ retained ที่หัวข้อของตัวเอง `m/<id>` ผู้เข้าห้องช้า
 *   จึงได้รับเฉพาะข้อความที่ยังไม่หมดอายุ
 * - ผู้ส่งเป็นผู้ล้าง retained เมื่อครบอายุ และทุกเครื่องถอดข้อความออกเมื่อหมดอายุเช่นกัน
 * - สถานะห้อง (ปิด/โหมดประกาศ) อยู่ที่ `ctl` ซึ่งแก้ได้เฉพาะเจ้าของห้อง
 */
export function ChatRoom({
  roomCode,
  ownerHint,
}: {
  roomCode: string;
  ownerHint: boolean;
}) {
  const [deviceId] = useState(() => newDeviceId());
  const [name, setName] = useState("");
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [people, setPeople] = useState<Record<string, { name: string; at: number }>>({});
  const [typing, setTyping] = useState<Record<string, { name: string; at: number }>>({});
  const [control, setControl] = useState<{ owner: string; announceOnly: boolean; autoCloseAt: number | null; updatedAt: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [announceMode, setAnnounceMode] = useState(false);
  const [revealNames, setRevealNames] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState(false);

  const lastSentAt = useRef(0);
  const knownIds = useRef<Set<string>>(new Set());
  const myTopics = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(true);
  const deviceRef = useRef(deviceId);
  const persistRef = useRef<((message: ChatMessage) => void) | null>(null);

  deviceRef.current = deviceId;
  soundOnRef.current = soundOn;

  useEffect(() => {
    setName(readName());
    writeLastRoom(roomCode);
  }, [roomCode]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const playBlip = useCallback(() => {
    if (!soundOnRef.current) return;
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      if (!audioRef.current) audioRef.current = new Ctor();
      const context = audioRef.current;
      if (context.state === "suspended") void context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 680;
      gain.gain.value = 0.03;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.07);
    } catch {
      /* เบราว์เซอร์ยังไม่อนุญาตเสียง: ข้าม */
    }
  }, []);

  const handleMessage = useCallback(
    (channel: string, payload: unknown) => {
      if (channel === "ctl") {
        if (!payload || typeof payload !== "object") return;
        setControl(payload as { owner: string; announceOnly: boolean; autoCloseAt: number | null; updatedAt: number });
        return;
      }
      if (channel.startsWith("m/")) {
        const parsed = ChatMessageSchema.safeParse(payload);
        if (!parsed.success) return;
        const message = parsed.data;
        if (!message.text.trim()) return;
        const isNew = !knownIds.current.has(message.id);
        knownIds.current.add(message.id);
        setMessages((current) => {
          const fresh = current.filter((item) => item.id !== message.id);
          return [...fresh, message].sort((a, b) => a.sentAt - b.sentAt);
        });
        if (isNew && message.senderId !== deviceRef.current) playBlip();
        return;
      }
      if (channel.startsWith("typing/")) {
        if (!payload || typeof payload !== "object") return;
        const value = payload as { senderId?: string; name?: string; at?: number };
        if (!value.senderId || !value.at) return;
        if (value.senderId === deviceRef.current) return;
        setTyping((current) => ({
          ...current,
          [value.senderId as string]: { name: value.name ?? "ใครบางคน", at: value.at as number },
        }));
        return;
      }
      if (channel.startsWith("p/")) {
        if (!payload || typeof payload !== "object") return;
        const value = payload as { id?: string; name?: string; at?: number };
        if (!value.id || !value.at) return;
        setPeople((current) => ({
          ...current,
          [value.id as string]: { name: value.name ?? "ผู้ไม่ระบุชื่อ", at: value.at as number },
        }));
        return;
      }
    },
    [playBlip],
  );

  const { status, error, publish, clearMessage } = useChatConnection({
    roomCode,
    enabled: joined,
    onMessage: handleMessage,
  });

  persistRef.current = (message: ChatMessage) => {
    publish(`m/${message.id}`, message, { retain: true });
    myTopics.current.add(`m/${message.id}`);
  };

  // ส่งสัญญาณชีพให้ทุกคนเห็นว่ายังอยู่
  useEffect(() => {
    if (!joined) return;
    const send = () =>
      publish(
        `p/${deviceId}`,
        { id: deviceId, name: cleanName(name), at: Date.now() },
        { retain: true },
      );
    if (status === "connected") send();
    const timer = window.setInterval(send, 5_000);
    return () => window.clearInterval(timer);
  }, [joined, deviceId, name, publish, status]);

  // เจ้าของห้องประกาศตัวตนครั้งแรก (ถ้ายังไม่มีใครเป็นเจ้าของ)
  useEffect(() => {
    if (!joined || !ownerHint || status !== "connected") return;
    if (control && control.owner !== deviceId) return;
    publish(
      "ctl",
      {
        owner: deviceId,
        announceOnly: control?.announceOnly ?? false,
        autoCloseAt: control?.autoCloseAt ?? null,
        updatedAt: Date.now(),
      },
      { retain: true },
    );
  }, [joined, ownerHint, status, control, deviceId, publish]);

  // ถอดผู้ที่หลุดและข้อความ "กำลังพิมพ์" ที่ค้างนานเกินไป
  useEffect(() => {
    setPeople((current) => pruneByTime(current, now, 20_000));
    setTyping((current) => pruneByTime(current, now, 4_000));
  }, [now]);

  const isOwner = Boolean(control && control.owner === deviceId);
  const locked = Boolean(control?.announceOnly) && !isOwner;

  // ล้าง retained ของข้อความตนเองเมื่อออกจากหน้า
  useEffect(() => {
    const topics = myTopics;
    return () => {
      for (const suffix of topics.current) {
        try {
          clearMessage(suffix);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function expire(ids: string[]) {
    setMessages((current) => current.filter((item) => !ids.includes(item.id)));
  }

  function send(kind: "normal" | "announce") {
    const text = draft.trim();
    if (!text) {
      setNotice("พิมพ์ข้อความก่อนส่ง");
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      setNotice(`ข้อความยาวเกิน ${MAX_MESSAGE_LENGTH} ตัวอักษร`);
      return;
    }
    const at = Date.now();
    if (at - lastSentAt.current < 1_500) {
      setNotice("ส่งถี่เกินไป รอสักครู่");
      return;
    }

    const ttl = messageTtlMs(text.length) + (kind === "announce" ? 60_000 : 0);
    const message: ChatMessage = {
      id: messageId(),
      roomId: roomCode,
      senderId: deviceId,
      senderName: cleanName(name),
      text,
      sentAt: at,
      ttlMs: ttl,
      expiresAt: at + ttl,
      kind,
    };

    persistRef.current?.(message);
    lastSentAt.current = at;
    setDraft("");
    setNotice(null);
  }

  function notifyTyping() {
    const at = Date.now();
    publish(`typing/${deviceId}`, { senderId: deviceId, name: cleanName(name), at }, { retain: true });
  }

  const activeTypers = Object.entries(typing)
    .filter(([id, value]) => id !== deviceId && now - value.at <= 4_000)
    .map(([, value]) => value.name);

  const visiblePeople = Object.entries(people).filter(
    ([, value]) => now - value.at <= 20_000,
  );

  const draftTtl = draft.trim() ? Math.round((messageTtlMs(draft.trim().length) + (announceMode && isOwner ? 60_000 : 0)) / 1000) : 0;

  if (!joined) {
    return (
      <JoinGate
        roomCode={roomCode}
        name={name}
        onName={(value) => {
          setName(value);
          writeName(cleanName(value));
        }}
        onJoin={() => {
          setJoined(true);
          void wakeAudio(audioRef);
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">รหัสห้อง</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-semibold tracking-[0.25em]">{roomCode}</span>
              <button
                type="button"
                onClick={() => copy(joinUrlText(roomCode), setNotice)}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs dark:border-slate-700"
              >
                คัดลอกลิงก์เชิญ
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <StatusBadge status={status} />
            <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">
              ในห้อง {visiblePeople.length} คน
            </span>
            {isOwner ? (
              <span className="rounded-md bg-amber-100 px-2 py-1 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                เจ้าของห้อง
              </span>
            ) : null}
            {control?.announceOnly ? (
              <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">โหมดประกาศ</span>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
        <div className="space-y-3">
          <MessageBoard
            messages={messages}
            selfId={deviceId}
            revealNames={revealNames}
            filterWords={[]}
            onExpire={expire}
          />

          <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
                  notifyTyping();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send(announceMode && isOwner ? "announce" : "normal");
                  }
                }}
                rows={2}
                disabled={locked}
                placeholder={
                  locked
                    ? "ห้องนี้เปิดโหมดประกาศ เฉพาะเจ้าของห้องส่งได้"
                    : "พิมพ์ข้อความแล้วกด Enter (Shift+Enter ขึ้นบรรทัดใหม่)"
                }
                className="min-h-[44px] flex-1 resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                disabled={locked}
                onClick={() => send(announceMode && isOwner ? "announce" : "normal")}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-60"
              >
                ส่ง
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                {draftTtl > 0
                  ? `${draft.length}/${MAX_MESSAGE_LENGTH} ตัวอักษร · จะอยู่อีกประมาณ ${draftTtl} วินาที`
                  : "ข้อความจะอยู่ 6–90 วินาที ตามความยาว"}
              </span>
              {isOwner ? (
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={announceMode}
                    onChange={(event) => setAnnounceMode(event.target.checked)}
                  />
                  ประกาศ (อยู่นานขึ้น 60 วินาที)
                </label>
              ) : null}
            </div>

            {notice ? (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{notice}</p>
            ) : null}
            {activeTypers.length > 0 ? (
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {activeTypers.slice(0, 4).join(", ")} กำลังพิมพ์
                <span className="typing-dot">…</span>
              </p>
            ) : null}
          </div>
        </div>

        <aside className="space-y-3">
          <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold">คนในห้อง ({visiblePeople.length})</h2>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {visiblePeople.map(([id, person]) => (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span className="truncate">
                    {revealNames ? person.name : shortName(id)}
                    {id === deviceId ? <span className="ml-1 text-xs text-slate-400">(คุณ)</span> : null}
                  </span>
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                </li>
              ))}
              {visiblePeople.length === 0 ? (
                <li className="text-xs text-slate-400">ยังไม่มีข้อมูลผู้ใช้</li>
              ) : null}
            </ul>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-sm font-semibold">การตั้งค่าของฉัน</h2>
            <label className="mt-2 flex items-center gap-2">
              <input
                type="checkbox"
                checked={revealNames}
                onChange={(event) => setRevealNames(event.target.checked)}
              />
              แสดงชื่อผู้ส่ง
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={soundOn}
                onChange={(event) => setSoundOn(event.target.checked)}
              />
              เสียงแจ้งเตือนข้อความใหม่
            </label>
          </section>

          {isOwner ? (
            <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700/60 dark:bg-amber-950/30">
              <h2 className="text-sm font-semibold">เครื่องมือเจ้าของห้อง</h2>
              <button
                type="button"
                onClick={() =>
                  publish("cmd", { type: "clear", by: deviceId, at: Date.now() }, { retain: false })
                }
                className="mt-2 w-full rounded-md border border-amber-400 px-3 py-1.5 text-xs font-medium text-amber-900 dark:text-amber-100"
              >
                ล้างข้อความในหน้าจอ
              </button>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={Boolean(control?.announceOnly)}
                  onChange={(event) =>
                    publish(
                      "ctl",
                      {
                        owner: deviceId,
                        announceOnly: event.target.checked,
                        autoCloseAt: control?.autoCloseAt ?? null,
                        updatedAt: Date.now(),
                      },
                      { retain: true },
                    )
                  }
                />
                เฉพาะเจ้าของห้องส่งได้
              </label>
              <button
                type="button"
                onClick={() => {
                  publish("cmd", { type: "close", by: deviceId, at: Date.now() }, { retain: false });
                  setClosed(true);
                }}
                className="mt-2 w-full rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white"
              >
                ปิดห้องตอนนี้
              </button>
            </section>
          ) : null}
        </aside>
      </div>

      {closed ? (
        <div className="rounded-lg border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-700/60 dark:bg-rose-950/40 dark:text-rose-100">
          <p className="font-medium">ห้องนี้ถูกปิดแล้ว</p>
          <p className="mt-1">
            ข้อความจะหายไปจากเครือข่ายภายในไม่กี่วินาที{" "}
            <a href="/" className="underline">
              กลับหน้าแรก
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

function JoinGate({
  roomCode,
  name,
  onName,
  onJoin,
}: {
  roomCode: string;
  name: string;
  onName: (value: string) => void;
  onJoin: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h1 className="text-lg font-semibold">เข้าห้อง {roomCode}</h1>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        ใส่ชื่อที่จะให้คนอื่นเห็น แล้วกดเข้าห้องได้เลย ไม่ต้องสมัครและไม่ต้องล็อกอิน
      </p>
      <input
        value={name}
        onChange={(event) => onName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onJoin();
        }}
        placeholder="ชื่อเล่นของคุณ"
        className="mt-4 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
        autoFocus
      />
      <button
        type="button"
        onClick={onJoin}
        className="mt-3 w-full rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
      >
        เข้าห้อง
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string }> = {
    idle: { label: "ยังไม่เชื่อมต่อ", className: "bg-slate-100 dark:bg-slate-800" },
    connecting: { label: "กำลังเชื่อมต่อ", className: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200" },
    connected: { label: "เชื่อมต่อแล้ว", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200" },
    reconnecting: { label: "กำลังเชื่อมต่อใหม่", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
    offline: { label: "ขาดการเชื่อมต่อ", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" },
    error: { label: "เชื่อมต่อไม่ได้", className: "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200" },
  };
  const item = map[status] ?? map.idle;
  return <span className={`rounded-md px-2 py-1 ${item.className}`}>{item.label}</span>;
}

function shortName(id: string): string {
  return `ผู้ใช้ ${id.slice(-4)}`;
}

function joinUrlText(code: string): string {
  if (typeof window === "undefined") return `/room/${code}`;
  return `${window.location.origin}/room/${code}`;
}

function copy(text: string, onDone: (message: string) => void) {
  try {
    void navigator.clipboard.writeText(text);
    onDone("คัดลอกลิงก์เชิญแล้ว ส่งให้ทุกคนได้เลย");
    window.setTimeout(() => onDone(""), 2_500);
  } catch {
    onDone("คัดลอกไม่สำเร็จ กรุณาคัดลอกด้วยตนเอง");
  }
}

/** ลบรายการที่ไม่ได้อัปเดตมานานแล้วออกจากตารางเวลา */
function pruneByTime<T extends { at: number }>(
  current: Record<string, T>,
  now: number,
  timeout: number,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(current)) {
    if (now - value.at <= timeout) next[key] = value;
    else changed = true;
  }
  return changed ? next : current;
}

async function wakeAudio(ref: { current: AudioContext | null }) {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ref.current = new Ctor();
    if (ref.current.state === "suspended") await ref.current.resume();
  } catch {
    /* ignore */
  }
}

export { findBlockedWords, isValidRoomCode, normalizeRoomCode };
