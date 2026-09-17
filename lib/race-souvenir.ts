// Race "souvenir": a finished race packed into a shareable link, so a player can scan a QR code
// at the end of the race and keep the full classification on their phone.
//
// The whole result travels inside the URL fragment (#souvenir=…). No server has to store
// anything: the static site (Firebase hosting) just decodes and renders it, and the fragment is
// never sent to the server. Format: compact JSON → deflate-raw (when the browser supports
// CompressionStream) → base64url, prefixed with "z" (compressed) or "j" (plain).

export type SouvenirDriver = {
  name: string;
  kart: string;
  laps: number;
  bestLapMs: number | null;
  totalTimeMs: number | null;
  pilot?: number | null; // pilot chosen at sign-up (1-8), drawn on the phone and the big screen
};

export type SouvenirKind = "race" | "simulation";

export type RaceSouvenir = {
  id: string;
  finishedAt: string; // ISO date
  kind: SouvenirKind;
  track: string;
  drivers: SouvenirDriver[]; // classification order, P1 first
};

const VERSION = 1;
export const SOUVENIR_HASH_PREFIX = "#souvenir=";
const PUBLIC_SITE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_PUBLIC_SITE_URL) ||
  "https://mega-karts.web.app";

// Driver tuple: [name, kart, laps, bestLapMs, totalTimeMs, pilot?] — -1 means "unknown". The pilot
// is appended last so links made before pilots existed still decode.
type PackedDriver = [string, string, number, number, number, number?];
type Packed = [number, string, number, 0 | 1, string, PackedDriver[]];

const toBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string) => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSouvenir(souvenir: RaceSouvenir): Promise<string> {
  const packed: Packed = [
    VERSION,
    souvenir.id,
    Math.round(new Date(souvenir.finishedAt).getTime() / 1000),
    souvenir.kind === "simulation" ? 1 : 0,
    souvenir.track,
    souvenir.drivers.map((d): PackedDriver => [d.name, d.kart, d.laps, d.bestLapMs ?? -1, d.totalTimeMs ?? -1, d.pilot ?? -1]),
  ];
  const json = new TextEncoder().encode(JSON.stringify(packed));
  if (typeof CompressionStream !== "undefined") {
    try {
      return "z" + toBase64Url(await pipe(json, new CompressionStream("deflate-raw")));
    } catch {
      /* fall through to the plain encoding */
    }
  }
  return "j" + toBase64Url(json);
}

export async function decodeSouvenir(token: string): Promise<RaceSouvenir> {
  const mode = token[0];
  let bytes = fromBase64Url(token.slice(1));
  if (mode === "z") {
    if (typeof DecompressionStream === "undefined") throw new Error("Ce navigateur est trop ancien pour ouvrir ce souvenir.");
    bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  } else if (mode !== "j") {
    throw new Error("Lien de souvenir invalide.");
  }
  const packed = JSON.parse(new TextDecoder().decode(bytes)) as Packed;
  if (!Array.isArray(packed) || packed[0] !== VERSION) throw new Error("Lien de souvenir invalide.");
  const [, id, finishedAtSec, kind, track, drivers] = packed;
  return {
    id,
    finishedAt: new Date(finishedAtSec * 1000).toISOString(),
    kind: kind === 1 ? "simulation" : "race",
    track,
    drivers: drivers.map(([name, kart, laps, best, total, pilot]) => ({
      name,
      kart,
      laps,
      bestLapMs: best < 0 ? null : best,
      totalTimeMs: total < 0 ? null : total,
      pilot: pilot == null || pilot < 0 ? null : pilot,
    })),
  };
}

export async function souvenirUrl(souvenir: RaceSouvenir, base = PUBLIC_SITE_URL): Promise<string> {
  return `${base.replace(/\/+$/, "")}/${SOUVENIR_HASH_PREFIX}${await encodeSouvenir(souvenir)}`;
}

export const MEGAKART_TRACK = "MegaKart Fès";

type ArchivedDriver = { position: number | null; name: string; kart: string; laps: number; bestLapMs: number | null; totalTimeMs: number | null; color?: number | null };
type ArchivedSession = { id: string; archivedAt: string; drivers: ArchivedDriver[] };

/** Classification order for an archived timing session: by position, then laps, then total time. */
export function souvenirFromHistory(session: ArchivedSession, track = MEGAKART_TRACK): RaceSouvenir {
  const drivers = [...session.drivers].sort((a, b) => {
    if (a.position != null && b.position != null) return a.position - b.position;
    if (a.position != null) return -1;
    if (b.position != null) return 1;
    return b.laps - a.laps || (a.totalTimeMs ?? Infinity) - (b.totalTimeMs ?? Infinity);
  });
  return {
    id: session.id,
    finishedAt: session.archivedAt,
    kind: "race",
    track,
    drivers: drivers.map((d) => ({ name: d.name, kart: d.kart, laps: d.laps, bestLapMs: d.bestLapMs, totalTimeMs: d.totalTimeMs, pilot: d.color ?? null })),
  };
}

/** Gap to the winner as shown on the classification: "+1.204", "+2 T", or null for P1. */
export function souvenirGap(driver: SouvenirDriver, winner: SouvenirDriver): string | null {
  if (driver === winner) return null;
  if (driver.laps < winner.laps) return `+${winner.laps - driver.laps} T`;
  if (driver.totalTimeMs == null || winner.totalTimeMs == null) return null;
  return `+${((driver.totalTimeMs - winner.totalTimeMs) / 1000).toFixed(3)}`;
}
