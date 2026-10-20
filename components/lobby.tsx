"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_MESSAGE_LENGTH,
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
  const [busy, setBusy] = useState(false);
  const codeRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setName(readName());
    setLastRoom(readLastRoom());
  }, []);

  const normalized = useMemo(() => normalizeRoomCode(code), [code]);

  function persistName(value: string) {
    const cleaned = cleanName(value);
    setName(value);
    writeName(cleaned);
  }

  function createRoom() {
    setBusy(true);
    const generated = randomRoomCode();
    writeName(cleanName(name));
    writeLastRoom(generated);
    router.push(`/room/${generated}?owner=1`);
  }

  function joinRoom(target?: string) {
    const value = normalizeRoomCode(target ?? code);
    if (!isValidRoomCode(value)) {
      setError("รหัสห้องต้องมีอย่างน้อย 4 ตัวอักษร");
      codeRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    writeName(cleanName(name));
    writeLastRoom(value);
    router.push(`/room/${value}`);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-lg font-semibold">ห้องแชตที่ข้อความจางหายไปเอง</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          ทุกคนเข้าห้องแล้วพิมพ์ได้ทันที ไม่ต้องสมัครและไม่ต้องล็อกอิน
          ข้อความจะค่อย ๆ จางและหายไปเอง <span className="font-medium">ยิ่งสั้นยิ่งหายไว
          ยิ่งยาวยิ่งอยู่นาน</span> ทุกเครื่องเห็นพร้อมกันแบบเรียลไทม์ และใช้พร้อมกันได้เกิน 60 คน
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="lobby-name">
          ชื่อที่จะแสดงในห้อง
        </label>
        <input
          id="lobby-name"
          value={name}
          onChange={(event) => persistName(event.target.value)}
          placeholder="เช่น น้องพลอย"
          maxLength={MAX_MESSAGE_LENGTH}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          เก็บไว้ในเบราว์เซอร์ของคุณเท่านั้น ไม่ถูกส่งไปเก็บที่ใด
        </p>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold">สร้างห้องใหม่</h2>
          <p className="mt-1 flex-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            ระบบจะสุ่มรหัสห้องให้ 5 ตัวอักษร แล้วคุณแจกรหัสหรือลิงก์ให้ทุกคนเข้าพร้อมกัน
          </p>
          <button
            type="button"
            onClick={createRoom}
            disabled={busy}
            className="mt-4 rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700 disabled:opacity-60"
          >
            สร้างห้องเลย
          </button>
        </section>

        <section className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-base font-semibold">เข้าห้องด้วยรหัส</h2>
          <label className="mt-1 text-sm text-slate-600 dark:text-slate-300" htmlFor="lobby-code">
            กรอกรหัสห้องที่ได้รับ
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
            placeholder="เช่น 7KQX2"
            className="mt-2 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-lg font-semibold tracking-[0.3em] outline-none focus:border-sky-500 dark:border-slate-700 dark:bg-slate-950"
          />
          {error ? (
            <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
          ) : null}
          <button
            type="button"
            onClick={() => joinRoom()}
            disabled={busy || normalized.length === 0}
            className="mt-4 rounded-md border border-sky-600 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-50 disabled:opacity-60 dark:border-sky-500 dark:text-sky-400 dark:hover:bg-sky-950/40"
          >
            เข้าห้อง
          </button>

          {lastRoom ? (
            <button
              type="button"
              onClick={() => joinRoom(lastRoom)}
              className="mt-2 text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              เข้าห้องล่าสุดอีกครั้ง ({lastRoom})
            </button>
          ) : null}
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-base font-semibold">ทำไมข้อความถึงหายเอง</h2>
        <ul className="mt-2 space-y-1 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          <li>
            อายุของข้อความคำนวณจากความยาว: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">6 วินาที + 0.35 × จำนวนตัวอักษร</code>{" "}
            สูงสุด 90 วินาที
          </li>
          <li>&ldquo;สวัสดี&rdquo; อยู่ประมาณ 8 วินาที ส่วนข้อความยาว ๆ อยู่ได้เป็นนาที</li>
          <li>ข้อความที่หายแล้วจะถูกลบออกจากเครือข่ายทันที ไม่ค้างอยู่ที่ใด</li>
          <li>ไม่มีประวัติย้อนหลัง ทุกคนเห็นหน้าต่างเวลาเดียวกัน</li>
        </ul>
      </section>
    </div>
  );
}
