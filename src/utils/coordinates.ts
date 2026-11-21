// Reading a location out of pasted text: plain coordinates, or a map link.
//
// No imports on purpose, so scripts/test_coordinates.mjs can run it directly
// under Node.

export type ParsedLocation =
  | { kind: "coords"; latitude: number; longitude: number }
  /** A short link that has to be fetched to see where it points. */
  | { kind: "shortLink"; url: string }
  /** A place name with no coordinates, for the geocoder. */
  | { kind: "query"; text: string }
  | null;

const NUM = String.raw`[-+]?\d{1,3}(?:\.\d+)?`;

function valid(lat: number, lng: number) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * A latitude/longitude pair in either order. "101.68, 3.13" cannot be
 * latitude-first, so it is read as longitude-first. Malaysian points are never
 * ambiguous: their longitude is always above 90.
 */
function pair(a: number, b: number): { latitude: number; longitude: number } | null {
  if (Math.abs(a) <= 90 && valid(a, b)) return { latitude: a, longitude: b };
  if (Math.abs(b) <= 90 && valid(b, a)) return { latitude: b, longitude: a };
  return null;
}

function coords(lat: number, lng: number): ParsedLocation {
  const p = pair(lat, lng);
  return p ? { kind: "coords", ...p } : null;
}

/** Degrees with optional minutes/seconds and an N/S/E/W letter, e.g. 3°08'20.4"N. */
function parseDms(text: string): ParsedLocation {
  const part = String.raw`(\d{1,3}(?:\.\d+)?)\s*[°º:\s]\s*(?:(\d{1,2}(?:\.\d+)?)\s*['′:\s]\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|''|)\s*)?([NSEW])`;
  const re = new RegExp(part, "gi");
  const found: { value: number; hemi: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && found.length < 2) {
    const deg = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const sec = m[3] ? Number(m[3]) : 0;
    if (min >= 60 || sec >= 60) return null;
    const hemi = m[4].toUpperCase();
    const v = deg + min / 60 + sec / 3600;
    found.push({ value: hemi === "S" || hemi === "W" ? -v : v, hemi });
  }
  if (found.length !== 2) return null;
  const lat = found.find((f) => f.hemi === "N" || f.hemi === "S");
  const lng = found.find((f) => f.hemi === "E" || f.hemi === "W");
  if (!lat || !lng) return null;
  return valid(lat.value, lng.value) ? { kind: "coords", latitude: lat.value, longitude: lng.value } : null;
}

/** Coordinates inside a map URL, most precise source first. */
export function coordsFromUrlText(text: string): ParsedLocation {
  const s = decodeSafe(text);
  // 1. The dropped pin itself (place links). "@" is only the view centre.
  let m = s.match(new RegExp(`!3d(${NUM})!4d(${NUM})`));
  if (m) return coords(Number(m[1]), Number(m[2]));
  // 2. Query parameters holding "lat,lng".
  m = s.match(new RegExp(`[?&](?:q|query|ll|sll|destination|daddr|center)=(${NUM})\\s*,\\s*(${NUM})`, "i"));
  if (m) return coords(Number(m[1]), Number(m[2]));
  // 3. /maps/search/lat,lng and /maps/place/lat,lng
  m = s.match(new RegExp(`/(?:search|place|dir)/(${NUM})\\s*,\\s*(${NUM})`, "i"));
  if (m) return coords(Number(m[1]), Number(m[2]));
  // 4. The view centre.
  m = s.match(new RegExp(`@(${NUM}),(${NUM})`));
  if (m) return coords(Number(m[1]), Number(m[2]));
  // geo:lat,lng
  m = s.match(new RegExp(`geo:(${NUM}),(${NUM})`, "i"));
  if (m) return coords(Number(m[1]), Number(m[2]));
  return null;
}

function decodeSafe(s: string) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

const SHORT_LINK = /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.google\.[a-z.]+\/\?cid|share\.google)\b/i;

/** What a pasted string points at, or null when it's unusable. */
export function parseLocationText(input: string): ParsedLocation {
  const text = String(input ?? "").trim();
  if (!text) return null;

  const url = text.match(/(?:https?:\/\/|geo:)\S+/i)?.[0];
  if (url) {
    const fromUrl = coordsFromUrlText(url);
    if (fromUrl) return fromUrl;
    if (SHORT_LINK.test(url)) return { kind: "shortLink", url };
    // A Maps link with only a place name in it.
    const q = decodeSafe(url).match(/[?&](?:q|query|daddr|destination)=([^&]+)/i)?.[1]
      ?? decodeSafe(url).match(/\/maps\/(?:place|search)\/([^/@?]+)/i)?.[1];
    if (q && q.trim()) return { kind: "query", text: q.trim() };
    return null;
  }

  const dms = parseDms(text);
  if (dms) return dms;

  // Plain decimal pair: "3.139, 101.687", "3.139 101.687", "(3.139,101.687)".
  const m = text.match(new RegExp(`^\\(?\\s*(${NUM})\\s*[,;\\s]\\s*(${NUM})\\s*\\)?$`));
  if (m) return coords(Number(m[1]), Number(m[2]));

  // Anything else with letters in it may be a place name.
  if (/[a-z]{3,}/i.test(text) && text.length <= 200) return { kind: "query", text };
  return null;
}

/** Roughly Peninsular Malaysia, Sabah and Sarawak. */
export function isInMalaysia(lat: number, lng: number) {
  return lat >= 0.8 && lat <= 7.5 && lng >= 99.5 && lng <= 119.5;
}
