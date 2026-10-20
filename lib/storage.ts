/**
 * ชั้นจัดการข้อมูลบนเบราว์เซอร์ (localStorage)
 *
 * ไม่มีข้อมูลผู้ใช้ใดถูกส่งขึ้นเซิร์ฟเวอร์ของตนเอง ทั้งหมดเก็บไว้ในเครื่องผู้ใช้
 */

import { DEFAULT_FILTER_WORDS } from "@/lib/chat";

const NAMESPACE = "fade-chat:";
const isBrowser = typeof window !== "undefined";

function readRaw(key: string): string | null {
  if (!isBrowser) return null;
  try {
    return window.localStorage.getItem(NAMESPACE + key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string | null): void {
  if (!isBrowser) return;
  try {
    if (value === null) window.localStorage.removeItem(NAMESPACE + key);
    else window.localStorage.setItem(NAMESPACE + key, value);
  } catch {
    /* ที่เก็บเต็มหรือถูกบล็อก: ข้าม */
  }
}

export function readJSON<T>(key: string, fallback: T): T {
  const raw = readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    writeRaw(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

export const StorageKey = {
  name: "name",
  lastRoom: "last-room",
  filterWords: "filter-words",
  soundOn: "sound",
  reveal: "reveal",
} as const;

export function readName(): string {
  return (readRaw(StorageKey.name) ?? "").slice(0, 40);
}

export function writeName(name: string): void {
  writeRaw(StorageKey.name, name.trim().slice(0, 40));
}

export function readLastRoom(): string {
  return readRaw(StorageKey.lastRoom) ?? "";
}

export function writeLastRoom(code: string): void {
  writeRaw(StorageKey.lastRoom, code);
}

export function readSoundOn(): boolean {
  const raw = readRaw(StorageKey.soundOn);
  if (raw === null) return true;
  return raw !== "off";
}

export function writeSoundOn(on: boolean): void {
  writeRaw(StorageKey.soundOn, on ? "on" : "off");
}

export function readRevealNames(): boolean {
  const raw = readRaw(StorageKey.reveal);
  if (raw === null) return true;
  return raw !== "off";
}

export function writeRevealNames(on: boolean): void {
  writeRaw(StorageKey.reveal, on ? "on" : "off");
}

/** รายการคำที่ถูกกรองของผู้ใช้ (ค่าเริ่มต้นมาจาก DEFAULT_FILTER_WORDS) */
export function readFilterWords(): string[] {
  const raw = readRaw(StorageKey.filterWords);
  if (raw === null) return [...DEFAULT_FILTER_WORDS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_FILTER_WORDS];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [...DEFAULT_FILTER_WORDS];
  }
}

export function writeFilterWords(words: string[]): void {
  try {
    writeRaw(StorageKey.filterWords, JSON.stringify([...new Set(words)]));
  } catch {
    /* ignore */
  }
}
