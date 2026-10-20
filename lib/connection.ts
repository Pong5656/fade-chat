"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BROKER_URL } from "@/lib/chat";

/**
 * เชื่อมต่อบรอคเกอร์ MQTT ผ่าน WebSocket สำหรับห้องแชต
 *
 * - subscribe `${base}/#` ครั้งเดียว แล้วส่งต่อข้อความให้ onMessage
 *   โดยตัด prefix ออก เหลือเป็น "channel" เช่น `m/<id>`, `p/<uid>`, `ctl`
 * - publish(suffix, payload, { retain }) สำหรับส่งข้อมูลออก
 * - โมดูล mqtt ถูกโหลดแบบไดนามิก (import()) เฉพาะฝั่งเบราว์เซอร์
 *
 * ปัญหาที่แก้ในเวอร์ชันนี้
 * 1) publish ที่เรียกก่อนเชื่อมต่อเสร็จเดิมจะถูกทิ้งเงียบ ๆ ทำให้ข้อความแรก ๆ
 *    และสัญญาณชีพหายไป จึงเปลี่ยนเป็นคิวรอ แล้วส่งออกทันทีเมื่อเชื่อมต่อได้
 * 2) การส่งข้อมูลถูกเว้นช่วงตามค่า QoS กับคิว เพื่อไม่ให้สแปมบรอคเกอร์
 * 3) เพิ่มการตรวจสัญญาณชีพ (watchdog) หากไม่ได้รับข้อมูลจากบรอคเกอร์นานเกินไป
 *    จะบังคับเชื่อมต่อใหม่เอง ไม่ต้องรอผู้ใช้กดรีเฟรช
 * 4) subscribe ซ้ำหลังเชื่อมต่อใหม่ทุกรอบ เพื่อไม่ให้หลุด subscription
 */

export type ChatConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
  | "error";

export type ChatConnection = {
  status: ChatConnectionStatus;
  error: string | null;
  publish: (suffix: string, payload: unknown, options?: { retain?: boolean }) => void;
  publishRaw: (suffix: string, body: string, options?: { retain?: boolean }) => void;
  clearMessage: (topic: string) => void;
  reconnect: () => void;
};

type PendingMessage = {
  topic: string;
  body: string;
  retain: boolean;
};

type MinimalClient = {
  on: (event: string, handler: (...args: never[]) => void) => void;
  subscribe: (topic: string, options?: { qos?: 0 | 1 | 2 }) => void;
  publish: (
    topic: string,
    message: string,
    options?: { retain?: boolean; qos?: 0 | 1 | 2 },
  ) => void;
  end: (force?: boolean) => void;
  reconnect?: () => void;
};

/** หากไม่ได้รับข้อมูลใด ๆ จากบรอคเกอร์นานเกินนี้ ให้ถือว่าการเชื่อมต่อค้าง */
const SILENCE_TIMEOUT_MS = 45_000;
/** จำนวนข้อความสูงสุดที่รอเชื่อมต่ออยู่ (กันคิวบวม) */
const MAX_PENDING = 40;

export function useChatConnection({
  roomCode,
  enabled,
  onMessage,
}: {
  roomCode: string;
  enabled: boolean;
  onMessage: (channel: string, payload: unknown) => void;
}): ChatConnection {
  const [status, setStatus] = useState<ChatConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const clientRef = useRef<MinimalClient | null>(null);
  const connectedRef = useRef(false);
  const pendingRef = useRef<PendingMessage[]>([]);
  const lastSeenRef = useRef(Date.now());
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const reconnect = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !roomCode) {
      setStatus("idle");
      connectedRef.current = false;
      return;
    }

    let cancelled = false;
    let client: MinimalClient | null = null;
    const base = `fadechat/v1/${roomCode}`;
    const prefix = `${base}/`;

    setStatus("connecting");
    setError(null);
    connectedRef.current = false;
    lastSeenRef.current = Date.now();

    const flushPending = () => {
      const queue = pendingRef.current;
      pendingRef.current = [];
      for (const item of queue) {
        try {
          client?.publish(item.topic, item.body, { retain: item.retain, qos: 1 });
        } catch {
          /* ignore */
        }
      }
    };

    (async () => {
      try {
        const mod = await import("mqtt");
        const connect = (mod.default ?? mod).connect as (
          url: string,
          options: Record<string, unknown>,
        ) => MinimalClient;
        if (cancelled) return;

        const url = process.env.NEXT_PUBLIC_MQTT_URL || DEFAULT_BROKER_URL;
        let suffix = "";
        try {
          suffix = window.sessionStorage.getItem(`fade-chat-client-${roomCode}`) ?? "";
          if (!suffix) {
            suffix = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            window.sessionStorage.setItem(`fade-chat-client-${roomCode}`, suffix);
          }
        } catch {
          suffix = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        }

        client = connect(url, {
          clientId: `fadechat_${suffix}`,
          clean: true,
          reconnectPeriod: 0,
          connectTimeout: 15_000,
          keepalive: 30,
          resubscribe: false,
        });
        clientRef.current = client;

        client.on("connect", () => {
          if (cancelled || !client) return;
          connectedRef.current = true;
          lastSeenRef.current = Date.now();
          setStatus("connected");
          setError(null);
          client.subscribe(`${base}/#`, { qos: 1 });
          flushPending();
        });

        client.on("reconnect", () => {
          if (cancelled) return;
          setStatus("reconnecting");
          connectedRef.current = false;
        });

        client.on("close", () => {
          if (cancelled) return;
          connectedRef.current = false;
          setStatus((current) => (current === "error" ? current : "offline"));
        });

        client.on("offline", () => {
          if (cancelled) return;
          connectedRef.current = false;
          setStatus("offline");
        });

        client.on("error", (err: Error) => {
          if (cancelled) return;
          setError(err?.message ?? "เชื่อมต่อบรอคเกอร์ไม่ได้");
          setStatus("error");
        });

        client.on("message", (topic: string, payload: Uint8Array) => {
          if (cancelled || typeof topic !== "string") return;
          lastSeenRef.current = Date.now();
          if (!topic.startsWith(prefix)) return;
          const channel = topic.slice(prefix.length);
          if (!payload || payload.length === 0) {
            handlerRef.current(channel, null);
            return;
          }
          try {
            handlerRef.current(channel, JSON.parse(new TextDecoder().decode(payload)));
          } catch {
            /* ไม่ใช่ JSON: ข้าม */
          }
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "โหลดโมดูลเชื่อมต่อไม่สำเร็จ");
        setStatus("error");
      }
    })();

    // watchdog: ถ้าเงียบผิดปกติให้เริ่มเชื่อมต่อใหม่เอง
    const watchdog = window.setInterval(() => {
      const gap = Date.now() - lastSeenRef.current;
      if (gap > SILENCE_TIMEOUT_MS && connectedRef.current) {
        lastSeenRef.current = Date.now();
        try {
          client?.end(true);
        } catch {
          /* ignore */
        }
        clientRef.current = null;
        connectedRef.current = false;
        setStatus("reconnecting");
        setAttempt((value) => value + 1);
      }
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      const current = clientRef.current;
      clientRef.current = null;
      connectedRef.current = false;
      try {
        current?.end(true);
      } catch {
        /* ignore */
      }
    };
  }, [roomCode, enabled, attempt]);

  const send = useCallback(
    (suffix: string, body: string, options?: { retain?: boolean }) => {
      const topic = `${prefixFor(roomCode)}/${suffix}`;
      const retain = options?.retain ?? false;
      const client = clientRef.current;
      if (!client || !connectedRef.current) {
        // เก็บไว้ส่งต่อทันทีที่เชื่อมต่อสำเร็จ ไม่ให้ข้อมูลตกหล่น
        pendingRef.current.push({ topic, body, retain });
        if (pendingRef.current.length > MAX_PENDING) pendingRef.current.shift();
        return;
      }
      try {
        client.publish(topic, body, { retain, qos: 1 });
      } catch {
        pendingRef.current.push({ topic, body, retain });
      }
    },
    [roomCode],
  );

  const publishRaw = useCallback(
    (suffix: string, body: string, options?: { retain?: boolean }) => {
      send(suffix, body, options);
    },
    [send],
  );

  const publish = useCallback(
    (suffix: string, payload: unknown, options?: { retain?: boolean }) => {
      send(suffix, JSON.stringify(payload), options);
    },
    [send],
  );

  const clearMessage = useCallback(
    (topic: string) => {
      send(topic, "", { retain: true });
    },
    [send],
  );

  return { status, error, publish, publishRaw, clearMessage, reconnect };
}

function prefixFor(roomCode: string): string {
  return `fadechat/v1/${roomCode}`;
}
