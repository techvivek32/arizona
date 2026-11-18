"use client";

import { useEffect } from "react";

const IDLE_MS = 30 * 60_000;
const EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;

/**
 * Automatic log-off for staff (HIPAA §164.312(a)(2)(iii)): after 30 minutes
 * with no mouse, keyboard, touch or scrolling, the staff session ends and the
 * page goes to the sign-in screen. Background polling (chats) doesn't count
 * as activity. Checked on a timer and when the tab comes back, so a computer
 * that slept is signed out as soon as it wakes.
 */
export default function IdleLogout() {
  useEffect(() => {
    let last = Date.now();
    let leaving = false;
    const touch = () => {
      last = Date.now();
    };
    const check = () => {
      if (leaving || Date.now() - last < IDLE_MS) return;
      leaving = true;
      void fetch("/api/admin/session", { method: "DELETE" })
        .catch(() => undefined)
        // A full page load on purpose: nothing about patients stays in memory.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        .finally(() => window.location.assign("/login?idle=1"));
    };
    for (const name of EVENTS) window.addEventListener(name, touch, { passive: true });
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 30_000);
    return () => {
      for (const name of EVENTS) window.removeEventListener(name, touch);
      document.removeEventListener("visibilitychange", check);
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
