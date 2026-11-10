import { useEffect, useState } from "react";

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

// Hours are allowed to grow past 24 rather than rolling into a day counter —
// this is meant to read as "how long has this been going," not a calendar.
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}

// Live-ticking (or frozen, once `until` is given) elapsed milliseconds since
// `since`. Returns null when `since` is missing/invalid, so callers can
// render nothing rather than a bogus "00:00:00".
export function useElapsedMs(since?: string | null, until?: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const frozen = !!until;

  useEffect(() => {
    if (!since || frozen) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since, frozen]);

  if (!since) return null;

  const sinceMs = new Date(since).getTime();
  if (Number.isNaN(sinceMs)) return null;

  let endMs = now;
  if (frozen) {
    const untilMs = new Date(until as string).getTime();
    endMs = Number.isNaN(untilMs) ? sinceMs : untilMs;
  }

  return Math.max(0, endMs - sinceMs);
}
