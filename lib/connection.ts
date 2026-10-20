"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_BROKER_URL } from "@/lib/chat";

/**
 * เชื่อมต่อบรอคเกอร์ MQTT ผ่าน WebSocket สำหรับห้องแชต
 *
 * - subscribe `${base}/#` ทุกหัวข้อย่อยของห้อง แล้วส่งต่อข้อความให้ onMessage
 *   โดยตัด prefix ออก เหลือเป็น "channel" เช่น `m/<id>`, `p/<uid>`, `ctl`
 * - publish(suffix, payload, { retain }) สำหรับส่งข้อมูลออก
 * - โมดูล mqtt ถูกโหลดแบบไดนามิก (import()) เฉพาะฝั่งเบราว์เซอร์
 *
 * การเชื่อมต่อทั้งหมดเกิดในเบราว์เซอร์ ไม่มีเซิร์ฟเวอร์และไม่มีฐานข้อมูลของตัวเอง
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
};

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
  const clientRef = useRef<MinimalClient | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    if (!enabled || !roomCode) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    let client: MinimalClient | null = null;
    const base = `fadechat/v1/${roomCode}`;
    const prefix = `${base}/`;

    setStatus("connecting");
    setError(null);

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
          reconnectPeriod: 2500,
          connectTimeout: 12_000,
          keepalive: 30,
        });
        clientRef.current = client;

        client.on("connect", () => {
          if (cancelled || !client) return;
          setStatus("connected");
          setError(null);
          client.subscribe(`${base}/#`, { qos: 1 });
        });

        client.on("reconnect", () => {
          if (!cancelled) setStatus("reconnecting");
        });

        client.on("close", () => {
          if (!cancelled) {
            setStatus((current) => (current === "error" ? current : "offline"));
          }
        });

        client.on("error", (err: Error) => {
          if (cancelled) return;
          setError(err?.message ?? "เชื่อมต่อบรอคเกอร์ไม่ได้");
          setStatus("error");
        });

        client.on("message", (topic: string, payload: Uint8Array) => {
          if (cancelled || typeof topic !== "string") return;
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

    return () => {
      cancelled = true;
      const current = clientRef.current;
      clientRef.current = null;
      try {
        current?.end(true);
      } catch {
        /* ignore */
      }
    };
  }, [roomCode, enabled]);

  const publishRaw = useCallback(
    (suffix: string, body: string, options?: { retain?: boolean }) => {
      const client = clientRef.current;
      if (!client) return;
      client.publish(`${prefixFor(roomCode)}/${suffix}`, body, {
        retain: options?.retain ?? false,
        qos: 1,
      });
    },
    [roomCode],
  );

  const publish = useCallback(
    (suffix: string, payload: unknown, options?: { retain?: boolean }) => {
      publishRaw(suffix, JSON.stringify(payload), options);
    },
    [publishRaw],
  );

  const clearMessage = useCallback(
    (topic: string) => {
      const client = clientRef.current;
      if (!client) return;
      client.publish(`${prefixFor(roomCode)}/${topic}`, "", { retain: true, qos: 1 });
    },
    [roomCode],
  );

  return { status, error, publish, publishRaw, clearMessage };
}

function prefixFor(roomCode: string): string {
  return `fadechat/v1/${roomCode}`;
}
