import { z } from "zod";

/**
 * ตรรกะของห้องแชตสด (ephemeral chat)
 *
 * หลักการ:
 * - ข้อความแต่ละฉบับมี "เวลาหมดอายุ" ที่ผูกกับความยาวข้อความ
 *   ยิ่งสั้นยิ่งหายไว ยิ่งยาวยิ่งอยู่นาน
 * - ทุกฝั่งใช้ `expiresAt` แบบสัมบูรณ์ (same absolute timestamp)
 *   จึงมีเวลาหายพร้อมกันทุกเครื่อง ไม่ว่าจะเข้าห้องช้าหรือหลุดไปแล้วกลับ
 * - ข้อความถูกเผยแพร่แบบ retained บนหัวข้อแยกเฉพาะฉบับ (`m/<id>`)
 *   เพื่อให้ผู้ที่เข้าห้องช้าได้เฉพาะข้อความที่ยังมีชีวิตอยู่เท่านั้น
 * - ฝั่งผู้ส่งเป็นคนล้าง retained เมื่อครบอายุ
 */

// ---------------------------------------------------------------------------
// บรอคเกอร์และหัวข้อ MQTT
// ---------------------------------------------------------------------------
export const CHAT_TOPIC_PREFIX = "fadechat/v1";

/** บรอคเกอร์สาธารณะค่าเริ่มต้น เปลี่ยนได้ด้วย NEXT_PUBLIC_MQTT_URL */
export const DEFAULT_BROKER_URL = "wss://broker.emqx.io:8084/mqtt";

export type ChatTopics = {
  base: string;
  message: (id: string) => string;
  typing: (uid: string) => string;
  presence: (uid: string) => string;
  control: string;
  pin: string;
  command: string;
};

export function chatTopics(roomCode: string): ChatTopics {
  const base = `${CHAT_TOPIC_PREFIX}/${roomCode}`;
  return {
    base,
    message: (id) => `${base}/m/${id}`,
    typing: (uid) => `${base}/typing/${uid}`,
    presence: (uid) => `${base}/p/${uid}`,
    control: `${base}/ctl`,
    pin: `${base}/pin`,
    command: `${base}/cmd`,
  };
}

// ---------------------------------------------------------------------------
// รหัสห้อง
// ---------------------------------------------------------------------------
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomRoomCode(length = 5): string {
  const values = new Uint32Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < length; i += 1) {
      values[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[values[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function normalizeRoomCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

export function isValidRoomCode(code: string): boolean {
  return normalizeRoomCode(code).length >= 4;
}

export function joinUrl(code: string): string {
  const normalized = normalizeRoomCode(code);
  if (typeof window === "undefined") return `/room/${normalized}`;
  return `${window.location.origin}/room/${normalized}`;
}

// ---------------------------------------------------------------------------
// อายุของข้อความ
// ---------------------------------------------------------------------------
export const MIN_MESSAGE_TTL_MS = 6_000;
export const MAX_MESSAGE_TTL_MS = 90_000;
export const TTL_BASE_MS = 6_000;
export const TTL_PER_CHAR_MS = 350;
export const ANNOUNCE_EXTRA_MS = 60_000;

/** คำนวณอายุของข้อตามตามความยาวข้อความ (หน่วย: มิลลิวินาที) */
export function messageTtlMs(length: number): number {
  const chars = Math.max(0, Math.floor(length));
  const raw = TTL_BASE_MS + chars * TTL_PER_CHAR_MS;
  return Math.min(MAX_MESSAGE_TTL_MS, Math.max(MIN_MESSAGE_TTL_MS, raw));
}

/** อายุของข้อความประเภทประกาศ (อยู่นานกว่าปกติ) */
export function announceTtlMs(length: number): number {
  return messageTtlMs(length) + ANNOUNCE_EXTRA_MS;
}

/** เวลาที่เหลืออยู่ของข้อความ (0 ถ้าหมดอายุแล้ว) */
export function remainingMs(message: { expiresAt: number }, now: number): number {
  return Math.max(0, message.expiresAt - now);
}

/** สัดส่วนเวลาที่เหลือ (0–1) ใช้ตัดแถบแสดงเวลาถอยหลัง */
export function lifeRatio(message: { expiresAt: number; ttlMs: number }, now: number): number {
  if (message.ttlMs <= 0) return 0;
  return Math.min(1, Math.max(0, remainingMs(message, now) / message.ttlMs));
}

/** รูปแบบเวลาที่เหลือสำหรับแสดงผล เช่น "12 วินาที" หรือ "1.4 วินาที" */
export function formatRemaining(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} วินาที`;
  return `${Math.ceil(seconds)} วินาที`;
}

// ---------------------------------------------------------------------------
// ขีดจำกัด
// ---------------------------------------------------------------------------
export const MAX_MESSAGE_LENGTH = 500;
export const MAX_NAME_LENGTH = 24;
export const MIN_SEND_INTERVAL_MS = 1_500;
export const MAX_VISIBLE_MESSAGES = 120;
export const PRESENCE_TIMEOUT_MS = 20_000;
export const TYPING_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// สคีมาตรวจสอบข้อมูล (ข้อมูลมาจากบรอคเกอร์สาธารณะ จึงถือว่าไม่น่าเชื่อถือ)
// ---------------------------------------------------------------------------
export type ChatMessageKind = "normal" | "announce";

export const ChatMessageSchema = z.object({
  id: z.string().min(1).max(64),
  roomId: z.string().min(1).max(16),
  senderId: z.string().min(1).max(64),
  senderName: z.string().min(1).max(MAX_NAME_LENGTH * 2),
  text: z.string().min(1).max(MAX_MESSAGE_LENGTH * 4),
  sentAt: z.number().int().nonnegative(),
  ttlMs: z.number().int().positive().max(240_000),
  expiresAt: z.number().int().nonnegative(),
  kind: z.enum(["normal", "announce"]).catch("normal"),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const PresenceSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(MAX_NAME_LENGTH * 2),
  at: z.number().int().nonnegative(),
});

export type ChatPresence = z.infer<typeof PresenceSchema>;

export const TypingSchema = z.object({
  senderId: z.string().min(1).max(64),
  name: z.string().min(1).max(MAX_NAME_LENGTH * 2),
  at: z.number().int().nonnegative(),
});

export const ControlSchema = z.object({
  owner: z.string().min(1).max(64),
  title: z.string().max(MAX_NAME_LENGTH * 2).catch(""),
  announceOnly: z.boolean().catch(false),
  filterOn: z.boolean().catch(true),
  autoCloseAt: z.number().int().nonnegative().nullable().catch(null),
  updatedAt: z.number().int().nonnegative().catch(0),
});

export type ChatControl = z.infer<typeof ControlSchema>;

export const CommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clear"), by: z.string().min(1).max(64), at: z.number() }),
  z.object({ type: z.literal("delete"), id: z.string().min(1).max(64), by: z.string().min(1).max(64), at: z.number() }),
  z.object({ type: z.literal("close"), by: z.string().min(1).max(64), at: z.number() }),
]);

export type ChatCommand = z.infer<typeof CommandSchema>;

/** แปลง payload ที่ได้รับเป็น ChatMessage หรือ null ถ้าไม่ถูกสคีมา */
export function parseMessage(payload: unknown): ChatMessage | null {
  const parsed = ChatMessageSchema.safeParse(payload);
  if (!parsed.success) return null;
  const message = parsed.data;
  if (!message.text.trim()) return null;
  if (message.expiresAt <= message.sentAt) return null;
  return message;
}

// ---------------------------------------------------------------------------
// การกรองคำ
// ---------------------------------------------------------------------------
/** รายการคำเริ่มต้นสำหรับตัวกรอง (แก้ไขได้จากหน้าห้อง และเก็บไว้ในเครื่องผู้ใช้) */
export const DEFAULT_FILTER_WORDS: string[] = [
  "ควย",
  "หี",
  "ไอสัส",
  "สัส",
  "เย็ด",
  "เยด",
  "ตอแหล",
  "ร่าน",
];

/** ตรวจว่าข้อความมีคำในรายการที่ต้องห้ามหรือไม่ คืนค่ารายการที่พบ */
export function findBlockedWords(text: string, words: string[]): string[] {
  const haystack = normalizeForFilter(text);
  if (!haystack) return [];
  const found: string[] = [];
  for (const raw of words) {
    const needle = normalizeForFilter(raw);
    if (needle.length >= 2 && haystack.includes(needle)) found.push(raw.trim());
  }
  return [...new Set(found)];
}

/**
 * ตัดช่องว่างและตัวเลขออกเพื่อให้เทียบได้แม่นยำขึ้น
 * (ภาษาไทยไม่มีช่องว่างระหว่างคำ การเทียบแบบ substring จึงเหมาะสมกว่า)
 */
function normalizeForFilter(value: string): string {
  let out = "";
  for (const char of value.toLowerCase()) {
    if (/\s/.test(char)) continue;
    if (/[0-9๐-๙]/.test(char)) continue;
    out += char;
  }
  return out;
}

/** แทนที่คำที่ไม่พึงประสงค์ด้วย ▓ เพื่อแสดงผลแบบปกปิด (ไม่แตะตำแหน่งตัวอักษรเดิม) */
export function maskBlockedWords(text: string, words: string[]): { text: string; count: number } {
  const needles = words
    .map((word) => normalizeForFilter(word))
    .filter((word) => word.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (needles.length === 0) return { text, count: 0 };

  // สร้างข้อความแบบไม่มีช่องว่าง/ตัวเลข พร้อมแผนที่กลับไปยังตำแหน่งในข้อความเดิม
  let compact = "";
  const indexOfOriginal: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i].toLowerCase();
    if (/\s/.test(char) || /[0-9๐-๙]/.test(char)) continue;
    compact += char;
    indexOfOriginal.push(i);
  }

  const mask = new Array<boolean>(text.length).fill(false);
  for (const needle of needles) {
    let from = 0;
    while (from + needle.length <= compact.length) {
      const at = compact.indexOf(needle, from);
      if (at < 0) break;
      for (let k = 0; k < needle.length; k += 1) {
        const original = indexOfOriginal[at + k];
        if (text[original]?.trim()) mask[original] = true;
      }
      from = at + needle.length;
    }
  }

  if (!mask.some(Boolean)) return { text, count: 0 };

  const out = [...text];
  let count = 0;
  let inMask = false;
  for (let i = 0; i < out.length; i += 1) {
    if (mask[i]) {
      out[i] = "▓";
      if (!inMask) {
        count += 1;
        inMask = true;
      }
    } else {
      inMask = false;
    }
  }
  return { text: out.join(""), count };
}

// ---------------------------------------------------------------------------
// ตรวจสอบข้อความก่อนส่ง
// ---------------------------------------------------------------------------
export type SendValidation =
  | { ok: true; text: string; blocked: string[] }
  | { ok: false; reason: "empty" | "too_long" | "blocked" | "rate"; blocked: string[] };

export function validateSend({
  text,
  filterWords,
  filterOn,
  now,
  lastSentAt,
}: {
  text: string;
  filterWords: string[];
  filterOn: boolean;
  now: number;
  lastSentAt: number;
}): SendValidation {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "empty", blocked: [] };
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, reason: "too_long", blocked: [] };
  }
  if (now - lastSentAt < MIN_SEND_INTERVAL_MS) {
    return { ok: false, reason: "rate", blocked: [] };
  }
  const blocked = filterOn ? findBlockedWords(trimmed, filterWords) : [];
  if (blocked.length > 0) return { ok: false, reason: "blocked", blocked };
  return { ok: true, text: trimmed, blocked: [] };
}

export const VALIDATION_MESSAGE: Record<string, string> = {
  empty: "พิมพ์ข้อความก่อนส่ง",
  too_long: `ข้อความยาวเกิน ${MAX_MESSAGE_LENGTH} ตัวอักษร`,
  blocked: "มีคำที่ไม่พึงประสงค์ในข้อความ",
  rate: "ส่งถี่เกินไป รอสักครู่",
};

// ---------------------------------------------------------------------------
// ชื่อผู้ใช้และรหัสประจำตัวอุปกรณ์
// ---------------------------------------------------------------------------
export function cleanName(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  return trimmed || "ผู้ไม่ระบุชื่อ";
}

export function newDeviceId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `u-${Date.now().toString(36)}-${rand}`;
}

export function messageId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now().toString(36)}${rand}`;
}

// ---------------------------------------------------------------------------
// ป้ายกำกับ
// ---------------------------------------------------------------------------
export function kindLabel(kind: ChatMessageKind): string {
  return kind === "announce" ? "ประกาศ" : "";
}
