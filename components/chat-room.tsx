"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatMessageSchema,
  ControlSchema,
  DEFAULT_FILTER_WORDS,
  MAX_MESSAGE_LENGTH,
  PRESENCE_TIMEOUT_MS,
  TYPING_TIMEOUT_MS,
  VALIDATION_MESSAGE,
  announceTtlMs,
  cleanName,
  findBlockedWords,
  messageId,
  messageTtlMs,
  newDeviceId,
  validateSend,
  type ChatMessage,
} from "@/lib/chat";
import { useChatConnection } from "@/lib/connection";
import {
  readFilterWords,
  readName,
  readRevealNames,
  readSoundOn,
  writeFilterWords,
  writeLastRoom,
  writeName,
  writeRevealNames,
  writeSoundOn,
} from "@/lib/storage";
import { MessageBoard } from "@/components/message-board";

/**
 * หน้าห้องแชตสด สไตล์แอปแชต
 *
 * สถาปัตยกรรม: ไม่มีเซิร์ฟเวอร์กลาง
 * - ข้อความถูกส่งแบบ retained ที่หัวข้อของตัวเอง `m/<id>` ผู้เข้าห้องช้า
 *   จึงได้รับเฉพาะข้อความที่ยังไม่หมดอายุ
 * - ผู้ส่งเป็นผู้ล้าง retained เมื่อครบอายุ และทุกเครื่องถอดข้อความออกเมื่อหมดอายุเช่นกัน
 * - สถานะห้อง (โหมดประกาศ / ปิดห้อง) อยู่ที่ `ctl` ซึ่งแก้ได้เฉพาะเจ้าของห้อง
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
  const [control, setControl] = useState<{
    owner: string;
    announceOnly: boolean;
    autoCloseAt: number | null;
    updatedAt: number;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [announceMode, setAnnounceMode] = useState(false);
  const [revealNames, setRevealNames] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [filterWords, setFilterWords] = useState<string[]>(DEFAULT_FILTER_WORDS);
  const [filterOn, setFilterOn] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  const [newWord, setNewWord] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [closed, setClosed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const lastSentAt = useRef(0);
  const typingSentAt = useRef(0);
  const knownIds = useRef<Set<string>>(new Set());
  const myTopics = useRef<Set<string>>(new Set());
  const audioRef = useRef<AudioContext | null>(null);
  const soundOnRef = useRef(true);
  const deviceRef = useRef(deviceId);
  const persistRef = useRef<((message: ChatMessage) => void) | null>(null);
  const clearRef = useRef<((topic: string) => void) | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  deviceRef.current = deviceId;
  soundOnRef.current = soundOn;

  useEffect(() => {
    setName(readName());
    setFilterWords(readFilterWords());
    setRevealNames(readRevealNames());
    setSoundOn(readSoundOn());
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
        const parsed = ControlSchema.safeParse(payload);
        if (!parsed.success) return;
        setControl(parsed.data);
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
          [value.senderId as string]: { name: value.name ?? "ผู้ใช้", at: value.at as number },
        }));
        return;
      }
      if (channel.startsWith("p/")) {
        if (!payload || typeof payload !== "object") return;
        const value = payload as { id?: string; name?: string; at?: number };
        if (!value.id || !value.at) return;
        setPeople((current) => ({
          ...current,
          [value.id as string]: { name: value.name ?? "ผู้ใช้", at: value.at as number },
        }));
        return;
      }
      if (channel === "cmd") {
        if (!payload || typeof payload !== "object") return;
        const value = payload as { type?: string; id?: string; by?: string; at?: number };
        if (value.type === "clear" && value.by) {
          const known = [...myTopics.current];
          setMessages((current) => {
            for (const item of current) knownIds.current.add(item.id);
            return [];
          });
          for (const topic of known) {
            try {
              clearRef.current?.(topic);
            } catch {
              /* ignore */
            }
          }
          return;
        }
        if (value.type === "delete" && value.id) {
          knownIds.current.add(value.id);
          setMessages((current) => current.filter((item) => item.id !== value.id));
          return;
        }
        if (value.type === "close") {
          setClosed(true);
          setMessages([]);
          return;
        }
      }
    },
    [playBlip],
  );

  const { status, error, publish, clearMessage, reconnect } = useChatConnection({
    roomCode,
    enabled: joined,
    onMessage: handleMessage,
  });

  clearRef.current = clearMessage;

  persistRef.current = (message: ChatMessage) => {
    publish(`m/${message.id}`, message, { retain: true });
    myTopics.current.add(`m/${message.id}`);
  };

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

  useEffect(() => {
    setPeople((current) => pruneByTime(current, now, PRESENCE_TIMEOUT_MS));
    setTyping((current) => pruneByTime(current, now, TYPING_TIMEOUT_MS));
  }, [now]);

  useEffect(() => {
    if (!control?.autoCloseAt) return;
    if (now < control.autoCloseAt) return;
    setClosed(true);
  }, [control, now]);

  const isOwner = Boolean(control && control.owner === deviceId);
  const locked = Boolean(control?.announceOnly) && !isOwner;

  useEffect(() => {
    const topics = myTopics;
    return () => {
      for (const suffix of topics.current) {
        try {
          clearRef.current?.(suffix);
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
    const at = Date.now();
    if (locked) {
      setNotice("ห้องนี้เปิดโหมดประกาศ เฉพาะเจ้าของห้องส่งได้");
      return;
    }
    const check = validateSend({
      text: draft,
      filterWords,
      filterOn,
      now: at,
      lastSentAt: lastSentAt.current,
    });
    if (!check.ok) {
      const extra =
        check.reason === "blocked" && check.blocked.length > 0
          ? ` (${check.blocked.slice(0, 3).join(", ")})`
          : "";
      setNotice((VALIDATION_MESSAGE[check.reason] ?? "ส่งข้อความไม่ได้") + extra);
      return;
    }

    const ttl =
      kind === "announce" ? announceTtlMs(check.text.length) : messageTtlMs(check.text.length);
    const message: ChatMessage = {
      id: messageId(),
      roomId: roomCode,
      senderId: deviceId,
      senderName: cleanName(name),
      text: check.text,
      sentAt: at,
      ttlMs: ttl,
      expiresAt: at + ttl,
      kind,
    };

    persistRef.current?.(message);
    lastSentAt.current = at;
    setDraft("");
    setNotice(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }

  function notifyTyping() {
    const at = Date.now();
    if (at - typingSentAt.current < 1_200) return;
    typingSentAt.current = at;
    publish(`typing/${deviceId}`, { senderId: deviceId, name: cleanName(name), at });
  }

  function updateRoom(patch: { announceOnly?: boolean; autoCloseAt?: number | null }) {
    publish(
      "ctl",
      {
        owner: deviceId,
        announceOnly: patch.announceOnly ?? control?.announceOnly ?? false,
        autoCloseAt:
          patch.autoCloseAt !== undefined ? patch.autoCloseAt : (control?.autoCloseAt ?? null),
        updatedAt: Date.now(),
      },
      { retain: true },
    );
  }

  function clearScreen() {
    for (const id of knownIds.current) clearMessage(`m/${id}`);
    myTopics.current.clear();
    knownIds.current.clear();
    setMessages([]);
    publish("cmd", { type: "clear", by: deviceId, at: Date.now() });
  }

  function closeRoom() {
    for (const id of knownIds.current) clearMessage(`m/${id}`);
    myTopics.current.clear();
    knownIds.current.clear();
    setMessages([]);
    setClosed(true);
    publish("cmd", { type: "close", by: deviceId, at: Date.now() });
    publish(
      "ctl",
      { owner: deviceId, announceOnly: false, autoCloseAt: null, updatedAt: Date.now() },
      { retain: true },
    );
  }

  async function copyLink() {
    const url = joinUrlText(roomCode);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_500);
    } catch {
      setNotice("คัดลอกอัตโนมัติไม่สำเร็จ ลิงก์คือ " + url);
    }
  }

  function addFilterWord() {
    const word = newWord.trim();
    if (word.length < 2) {
      setNotice("คำที่กรองต้องมีอย่างน้อย 2 ตัวอักษร");
      return;
    }
    const next = [...new Set([...filterWords, word])];
    setFilterWords(next);
    writeFilterWords(next);
    setNewWord("");
    setNotice(null);
  }

  function removeFilterWord(word: string) {
    const next = filterWords.filter((item) => item !== word);
    setFilterWords(next);
    writeFilterWords(next);
  }

  function autoGrow(element: HTMLTextAreaElement) {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 140)}px`;
  }

  const activeTypers = Object.entries(typing)
    .filter(([id, value]) => id !== deviceId && now - value.at <= TYPING_TIMEOUT_MS)
    .map(([, value]) => value.name);

  const visiblePeople = Object.entries(people).filter(
    ([, value]) => now - value.at <= PRESENCE_TIMEOUT_MS,
  );

  const draftBlocked = useMemo(
    () => (filterOn ? findBlockedWords(draft, filterOn ? filterWords : []) : []),
    [draft, filterOn, filterWords],
  );

  const inviteUrl = useMemo(() => (joined ? joinUrlText(roomCode) : ""), [joined, roomCode]);

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
    <div className="flex h-[calc(100vh-140px)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
      {/* ------------------------------------------------------------- แถบหัวห้อง */}
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
          #
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold leading-tight">
            ห้อง {roomCode}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span
              className={`inline-block h-2 w-2 rounded-full ${DOT[status] ?? DOT.idle} ${
                status === "connecting" || status === "reconnecting" ? "status-pulse" : ""
              }`}
            />
            {STATUS_TEXT[status] ?? STATUS_TEXT.idle}
            {status === "connected" ? ` · ${visiblePeople.length} คน` : ""}
          </p>
        </div>

        {status === "error" || status === "offline" ? (
          <button
            type="button"
            onClick={reconnect}
            className="shrink-0 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            เชื่อมต่อใหม่
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setPanelOpen(true)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-300 px-3 text-xs font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 lg:hidden"
        >
          <span className="tabular-nums">{visiblePeople.length}</span> คน
        </button>
      </header>

      {/* ------------------------------------------------------------- เนื้อหา */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 flex-1 flex-col">
          <MessageBoard
            messages={messages}
            selfId={deviceId}
            revealNames={revealNames}
            filterWords={filterWords}
            showRemaining={isOwner}
            onExpire={expire}
          />

          {/* ตัวบอกว่ากำลังพิมพ์ */}
          <div className="h-6 shrink-0 px-4 text-xs text-slate-500 dark:text-slate-400">
            {activeTypers.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-flex gap-0.5">
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                  <span className="typing-dot h-1.5 w-1.5 rounded-full bg-slate-400" />
                </span>
                {activeTypers.slice(0, 3).join(", ")} กำลังพิมพ์
              </span>
            ) : null}
          </div>

          {/* ------------------------------------------------------- ช่องพิมพ์ */}
          <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
            {locked ? (
              <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                ห้องนี้เปิดโหมดประกาศ เฉพาะเจ้าของห้องส่งข้อความได้
              </p>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={draft}
                    onChange={(event) => {
                      setDraft(event.target.value.slice(0, MAX_MESSAGE_LENGTH));
                      autoGrow(event.target);
                      notifyTyping();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        send(announceMode && isOwner ? "announce" : "normal");
                      }
                    }}
                    rows={1}
                    placeholder="พิมพ์ข้อความ…"
                    className="max-h-36 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-[15px] leading-relaxed outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-950 dark:focus:bg-slate-950"
                  />
                  <button
                    type="button"
                    onClick={() => send(announceMode && isOwner ? "announce" : "normal")}
                    disabled={draft.trim().length === 0}
                    aria-label="ส่งข้อความ"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                  >
                    <SendIcon />
                  </button>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500 dark:text-slate-400">
                  {draftBlocked.length > 0 ? (
                    <span className="text-rose-600 dark:text-rose-400">
                      พบคำที่ถูกกรอง {draftBlocked.length} คำ
                    </span>
                  ) : (
                    <span>Enter ส่ง · Shift+Enter ขึ้นบรรทัดใหม่</span>
                  )}
                  {isOwner ? (
                    <label className="ml-auto flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={announceMode}
                        onChange={(event) => setAnnounceMode(event.target.checked)}
                      />
                      ส่งเป็นประกาศ
                    </label>
                  ) : null}
                </div>

                {notice ? (
                  <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{notice}</p>
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* --------------------------------------------------------- แผงด้านข้าง */}
        <SidePanel
          open={panelOpen}
          onClose={() => setPanelOpen(false)}
          roomCode={roomCode}
          inviteUrl={inviteUrl}
          copied={copied}
          onCopy={copyLink}
          people={visiblePeople}
          deviceId={deviceId}
          revealNames={revealNames}
          onRevealNames={(value) => {
            setRevealNames(value);
            writeRevealNames(value);
          }}
          soundOn={soundOn}
          onSoundOn={(value) => {
            setSoundOn(value);
            writeSoundOn(value);
          }}
          filterOn={filterOn}
          onFilterOn={setFilterOn}
          filterWords={filterWords}
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          newWord={newWord}
          onNewWord={setNewWord}
          onAddWord={addFilterWord}
          onRemoveWord={removeFilterWord}
          isOwner={isOwner}
          announceOnly={Boolean(control?.announceOnly)}
          autoCloseAt={control?.autoCloseAt ?? null}
          onAnnounceOnly={(value) => updateRoom({ announceOnly: value })}
          onAutoClose={(minutes) =>
            updateRoom({ autoCloseAt: minutes > 0 ? Date.now() + minutes * 60_000 : null })
          }
          onClear={clearScreen}
          onClose_={closeRoom}
          error={error}
        />
      </div>

      {closed ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-200">
          <p className="font-medium">ห้องนี้ถูกปิดแล้ว</p>
          <p className="mt-0.5">
            ข้อความทั้งหมดจะหายไปจากเครือข่ายภายในไม่กี่วินาที{" "}
            <a href="/" className="underline">
              กลับหน้าแรก
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/*  แผงด้านข้าง (ข้อมูลห้อง/การตั้งค่า/เครื่องมือเจ้าของ)                      */
/* ========================================================================== */

function SidePanel(props: {
  open: boolean;
  onClose: () => void;
  roomCode: string;
  inviteUrl: string;
  copied: boolean;
  onCopy: () => void;
  people: [string, { name: string; at: number }][];
  deviceId: string;
  revealNames: boolean;
  onRevealNames: (value: boolean) => void;
  soundOn: boolean;
  onSoundOn: (value: boolean) => void;
  filterOn: boolean;
  onFilterOn: (value: boolean) => void;
  filterWords: string[];
  filterOpen: boolean;
  onToggleFilter: () => void;
  newWord: string;
  onNewWord: (value: string) => void;
  onAddWord: () => void;
  onRemoveWord: (word: string) => void;
  isOwner: boolean;
  announceOnly: boolean;
  autoCloseAt: number | null;
  onAnnounceOnly: (value: boolean) => void;
  onAutoClose: (minutes: number) => void;
  onClear: () => void;
  onClose_: () => void;
  error: string | null;
}) {
  const panel = (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          ชวนคนเข้าห้อง
        </h2>
        <div className="mt-2 rounded-xl bg-slate-100 px-3 py-2.5 text-center dark:bg-slate-950">
          <span className="text-xl font-semibold tracking-[0.3em]">{props.roomCode}</span>
        </div>
        <div className="mt-2 flex gap-2">
          <input
            readOnly
            value={props.inviteUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-600 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
          />
          <button
            type="button"
            onClick={props.onCopy}
            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            {props.copied ? "คัดลอกแล้ว" : "คัดลอก"}
          </button>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            คนในห้อง
          </h2>
          <span className="tabular-nums text-xs text-slate-400 dark:text-slate-500">
            {props.people.length}
          </span>
        </div>
        <ul className="mt-2 space-y-1.5 text-sm">
          {props.people.map(([id, person]) => (
            <li key={id} className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <span className="truncate">
                {props.revealNames ? person.name : `ผู้ใช้ ${id.slice(-4)}`}
                {id === props.deviceId ? (
                  <span className="ml-1.5 text-xs text-slate-400">คุณ</span>
                ) : null}
              </span>
            </li>
          ))}
          {props.people.length === 0 ? (
            <li className="text-xs text-slate-400">กำลังตรวจสอบผู้ใช้ออนไลน์</li>
          ) : null}
        </ul>
      </section>

      <section className="border-t border-slate-200 pt-3 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          การตั้งค่าของฉัน
        </h2>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={props.revealNames}
            onChange={(event) => props.onRevealNames(event.target.checked)}
          />
          แสดงชื่อผู้ส่ง
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={props.soundOn}
            onChange={(event) => props.onSoundOn(event.target.checked)}
          />
          เสียงเตือนข้อความใหม่
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={props.filterOn}
            onChange={(event) => props.onFilterOn(event.target.checked)}
          />
          กรองคำไม่พึงประสงค์
        </label>
        <button
          type="button"
          onClick={props.onToggleFilter}
          className="mt-2 text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          {props.filterOpen
            ? "ซ่อนรายการคำที่กรอง"
            : `จัดการรายการคำที่กรอง (${props.filterWords.length} คำ)`}
        </button>
        {props.filterOpen ? (
          <div className="mt-2 space-y-2">
            <ul className="flex flex-wrap gap-1.5">
              {props.filterWords.map((word) => (
                <li key={word}>
                  <button
                    type="button"
                    onClick={() => props.onRemoveWord(word)}
                    title="กดเพื่อนำออก"
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-xs transition hover:bg-rose-100 hover:text-rose-700 dark:bg-slate-800 dark:hover:bg-rose-900/40 dark:hover:text-rose-300"
                  >
                    {word} ✕
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <input
                value={props.newWord}
                onChange={(event) => props.onNewWord(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    props.onAddWord();
                  }
                }}
                placeholder="เพิ่มคำที่ต้องการกรอง"
                className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-slate-400 dark:border-slate-700 dark:bg-slate-950"
              />
              <button
                type="button"
                onClick={props.onAddWord}
                className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
              >
                เพิ่ม
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {props.isOwner ? (
        <section className="border-t border-slate-200 pt-3 dark:border-slate-800">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            เครื่องมือเจ้าของห้อง
          </h2>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={props.announceOnly}
              onChange={(event) => props.onAnnounceOnly(event.target.checked)}
            />
            ให้เฉพาะเจ้าของห้องส่งได้
          </label>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span>ปิดห้องอัตโนมัติ</span>
            <select
              value={props.autoCloseAt ? "30" : "0"}
              onChange={(event) => props.onAutoClose(Number(event.target.value))}
              className="ml-auto rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              <option value="0">ไม่ปิด</option>
              <option value="15">15 นาที</option>
              <option value="30">30 นาที</option>
              <option value="60">60 นาที</option>
            </select>
          </div>
          <button
            type="button"
            onClick={props.onClear}
            className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium transition hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            ล้างข้อความในหน้าจอทุกคน
          </button>
          <button
            type="button"
            onClick={props.onClose_}
            className="mt-2 w-full rounded-lg border border-rose-300 px-3 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            ปิดห้องตอนนี้
          </button>
        </section>
      ) : null}

      {props.error ? (
        <p className="border-t border-slate-200 pt-3 text-xs text-rose-600 dark:border-slate-800 dark:text-rose-400">
          {props.error}
        </p>
      ) : null}
    </div>
  );

  return (
    <>
      {/* จอใหญ่: แผงติดด้านข้าง */}
      <aside className="hidden w-72 shrink-0 border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        {panel}
      </aside>

      {/* จอเล็ก: แผงเลื่อนขึ้นมา */}
      {props.open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={props.onClose}
          />
          <div className="absolute inset-y-0 right-0 w-[86%] max-w-sm bg-white shadow-2xl dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-800">
              <h2 className="text-sm font-semibold">ข้อมูลห้อง</h2>
              <button
                type="button"
                onClick={props.onClose}
                aria-label="ปิด"
                className="rounded-full px-2 py-1 text-lg leading-none text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                ✕
              </button>
            </div>
            <div className="h-[calc(100%-49px)]">{panel}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ========================================================================== */
/*  หน้าจอเข้าห้อง                                                            */
/* ========================================================================== */

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
    <div className="mx-auto mt-8 max-w-md">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-lg font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
          #
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">คุณกำลังเข้าห้อง</p>
        <h1 className="text-2xl font-semibold tracking-[0.3em]">{roomCode}</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          ใส่ชื่อที่จะให้คนอื่นเห็น แล้วเข้าห้องได้เลย ไม่ต้องล็อกอิน
        </p>
        <input
          value={name}
          onChange={(event) => onName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onJoin();
          }}
          placeholder="ชื่อเล่นของคุณ"
          className="mt-4 w-full rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-[15px] outline-none transition focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-950"
          autoFocus
        />
        <button
          type="button"
          onClick={onJoin}
          className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          เข้าห้อง
        </button>
      </div>
    </div>
  );
}

function SendIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M22 2 11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

const DOT: Record<string, string> = {
  idle: "bg-slate-400",
  connecting: "bg-sky-500",
  connected: "bg-emerald-500",
  reconnecting: "bg-amber-500",
  offline: "bg-rose-500",
  error: "bg-rose-500",
};

const STATUS_TEXT: Record<string, string> = {
  idle: "ยังไม่เชื่อมต่อ",
  connecting: "กำลังเชื่อมต่อ…",
  connected: "ออนไลน์",
  reconnecting: "กำลังเชื่อมต่อใหม่…",
  offline: "ขาดการเชื่อมต่อ",
  error: "เชื่อมต่อไม่ได้",
};

function joinUrlText(code: string): string {
  if (typeof window === "undefined") return `/room/${code}`;
  return `${window.location.origin}/room/${code}`;
}

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
