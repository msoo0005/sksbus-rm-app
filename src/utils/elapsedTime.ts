import { useEffect, useState } from "react";

function pad(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

const DAY_S = 24 * 3600;

// C2 (v2.0.0): under 24 h "hh:mm:ss" with leading zeros (00:41:07); from 24 h
// days, hours and minutes with no seconds ("1d 0h 42m", "100d 3h 5m").
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds >= DAY_S) {
    const d = Math.floor(totalSeconds / DAY_S);
    const h = Math.floor((totalSeconds % DAY_S) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  }
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

  // Past a day the readout has no seconds, so it only needs a tick a minute.
  const pastADay = !!since && now - new Date(since).getTime() >= DAY_S * 1000;
  useEffect(() => {
    if (!since || frozen) return;
    const id = setInterval(() => setNow(Date.now()), pastADay ? 60_000 : 1000);
    return () => clearInterval(id);
  }, [since, frozen, pastADay]);

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
