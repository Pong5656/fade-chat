/**
 * ชั้นจัดการข้อมูลบนเบราว์เซอร์ (localStorage / sessionStorage)
 *
 * ไม่มีข้อมูลผู้ใช้ใดถูกส่งขึ้นเซิร์ฟเวอร์ของตนเอง ทั้งหมดเก็บไว้ในเครื่องผู้ใช้
 */

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
    /* เต็มหรือถูกบล็อก: ข้าม */
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
