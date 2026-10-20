"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_NAME_LENGTH,
  cleanName,
  isValidRoomCode,
  normalizeRoomCode,
  randomRoomCode,
} from "@/lib/chat";
import { readLastRoom, readName, writeLastRoom, writeName } from "@/lib/storage";

/**
 * หน้าล็อบบี้: สร้างห้องใหม่ หรือเข้าห้องด้วยรหัส
 * ไม่มีการล็อกอินใด ๆ ใช้เพียงชื่อเล่นที่เก็บไว้ในเครื่องผู้ใช้
 */
export function Lobby() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [lastRoom, setLastRoom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(readName());
    setLastRoom(readLastRoom());
  }, []);

  const normalized = useMemo(() => normalizeRoomCode(code), [code]);

  function createRoom() {
    const generated = randomRoomCode();
    writeName(cleanName(name));
    writeLastRoom(generated);
    router.push(`/room/${generated}?owner=1`);
  }

  function joinRoom(target?: string) {
    const value = normalizeRoomCode(target ?? code);
    if (!isValidRoomCode(value)) {
      setError("รหัสห้องต้องมี 5 ตัวอักษร");
      codeRef.current?.focus();
      return;
    }
    setError(null);
    writeName(cleanName(name));
    writeLastRoom(value);
    router.push(`/room/${value}`);
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
        <div className="chat-canvas border-b border-slate-200 px-6 py-8 text-center dark:border-slate-800">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-2xl shadow-lg dark:bg-slate-100">
            💬
          </div>
          <h1 className="mt-4 text-xl font-semibold">ห้องแชตที่ข้อความจางหายไปเอง</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            สร้างห้องแล้วแชร์รหัสให้ทุกคนเข้าพร้อมกัน พิมพ์คุยได้ทันทีโดยไม่ต้องสมัครสมาชิก
            ข้อความสั้นจะหายไว ส่วนข้อความยาวจะอยู่บนจอนานขึ้น
          </p>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <label className="block text-sm font-medium" htmlFor="lobby-name">
              ชื่อที่จะแสดงในห้อง
            </label>
            <input
              id="lobby-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => writeName(cleanName(name))}
              placeholder="ชื่อเล่นของคุณ"
              maxLength={MAX_NAME_LENGTH}
              className="mt-1.5 w-full rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-[15px] outline-none transition focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-950"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              เก็บไว้ในเบราว์เซอร์ของคุณเท่านั้น ไม่ถูกส่งไปที่อื่น
            </p>
          </div>

          <button
            type="button"
            onClick={createRoom}
            className="w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          >
            สร้างห้องใหม่
          </button>

          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
            <span className="text-xs text-slate-400">หรือ</span>
            <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
          </div>

          <div>
            <label className="block text-sm font-medium" htmlFor="lobby-code">
              เข้าห้องด้วยรหัส
            </label>
            <input
              id="lobby-code"
              ref={codeRef}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") joinRoom();
              }}
              placeholder="– – – – –"
              className="mt-1.5 w-full rounded-2xl border border-slate-300 bg-slate-100 px-4 py-3 text-center text-xl font-semibold tracking-[0.4em] outline-none transition focus:border-slate-400 focus:bg-white dark:border-slate-700 dark:bg-slate-950"
            />
            {error ? (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{error}</p>
            ) : null}
            <button
              type="button"
              onClick={() => joinRoom()}
              disabled={normalized.length === 0}
              className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm font-medium transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              เข้าห้อง
            </button>
          </div>

          {lastRoom ? (
            <button
              type="button"
              onClick={() => joinRoom(lastRoom)}
              className="w-full text-center text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              กลับเข้าห้องล่าสุด ({lastRoom})
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
