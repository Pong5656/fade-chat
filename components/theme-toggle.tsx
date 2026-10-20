"use client";

import { useEffect, useState } from "react";

const KEY = "fade-chat:theme";

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="สลับโหมดสี"
      className="rounded-md border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      {ready ? (dark ? "โหมดสว่าง" : "โหมดมืด") : "โหมดสี"}
    </button>
  );
}
