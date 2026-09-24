// Writes from the dashboard to the local Apex bridge. The bridge only accepts these from the
// PC it runs on; everything it forwards to Apex stays read-only.
import type { MegaKartSession } from "@/lib/megakart-session";

export const BRIDGE_URL =
  (typeof import.meta !== "undefined" && (import.meta as { env?: Record<string, string> }).env?.VITE_APEX_BRIDGE_URL) ||
  "http://localhost:8787";

export type ActiveSessionPayload = {
  id: string;
  name: string;
  type: string;
  drivers: { transponder: string; kartNumber: number; name: string; color?: number }[];
} | { id: null };

export function activeSessionPayload(session: MegaKartSession | undefined): ActiveSessionPayload {
  if (!session) return { id: null };
  return {
    id: session.id,
    name: session.name,
    type: session.type,
    drivers: session.drivers
      .filter((d) => d.transponder)
      .map((d) => ({ transponder: d.transponder!, kartNumber: d.kartNumber, name: d.name, color: d.color })),
  };
}

export type SignupPlayer = {
  name: string;
  phone?: string | null; // required on the form; absent on sign-ups taken before it was asked
  age: number;
  email: string | null;
  color: number;
  height?: number | null; // cm — JUNIOR karts need 130 cm, GT (adult) karts 160 cm
  category?: KartCategory;
  heightOk?: boolean; // false = too short for that kart, to check at the counter
};

// "CADET"/"SENIOR" are the first naming, kept so sign-ups taken before the rename still read right.
export type KartCategory = "JUNIOR" | "GT" | "CADET" | "SENIOR";
export const MIN_HEIGHT_CM: Record<"JUNIOR" | "GT", number> = { JUNIOR: 130, GT: 160 };

export function kartCategory(player: { age: number; category?: KartCategory }): "JUNIOR" | "GT" {
  if (player.category === "JUNIOR" || player.category === "CADET") return "JUNIOR";
  if (player.category === "GT" || player.category === "SENIOR") return "GT";
  return player.age <= 14 ? "JUNIOR" : "GT";
}

/** Tall enough for that kart? Re-checked against today's rule, so changing a minimum
 *  re-judges sign-ups taken under the old one instead of keeping a stale flag. */
export function isTallEnough(player: SignupPlayer): boolean {
  if (player.height == null) return player.heightOk ?? true;
  return player.height >= MIN_HEIGHT_CM[kartCategory(player)];
}

export type Signup = {
  id: string;
  code: string; // short code the client reads out at the counter
  createdAt: string;
  name: string;
  phone: string;
  email: string | null;
  birthdate: string;
  age: number;
  height?: number | null;
  category?: KartCategory;
  heightOk?: boolean;
  color?: number; // pilot colour picked on the phone (1-8, see public/drivers)
  team?: SignupPlayer[]; // friends added in the same sign-up
  waiver: boolean;
  pack?: string | null;           // pack id chosen at sign-up
  packLabel?: string | null;      // its human name, e.g. "2 courses"
  packPriceMad?: number | null;   // per driver
  packTotalMad?: number | null;   // what the caisse must collect: price x pilots, or the group price
  packBasis?: "personne" | "groupe" | null;   // a group offer's price covers the whole group
  packPeriod?: "unique" | "semaine" | "mois" | null;
  charter?: string; // version of the charte de bonne conduite that was signed
  signature?: string; // the signature itself, a PNG data URL drawn on the phone
  signedAt?: number; // epoch ms, when it was signed
  offers: boolean;
  status: "new" | "assigned" | "archived";
  queueCode?: string | null; // reservation code in the caisse queue (Liste d'attente)
  queueError?: string | null; // why the hand-off to the desk failed, if it did
};

/** Everyone in a sign-up, the person who registered first. */
export function signupPlayers(signup: Signup): SignupPlayer[] {
  const first: SignupPlayer = {
    name: signup.name,
    phone: signup.phone,
    age: signup.age,
    email: signup.email,
    color: signup.color ?? 1,
    height: signup.height ?? null,
    category: kartCategory(signup),
    heightOk: signup.heightOk ?? true,
  };
  return [first, ...(signup.team ?? [])];
}

/** Client sign-ups filled on phones at /inscription. Readable from the bridge PC only. */
export async function fetchSignups(): Promise<Signup[]> {
  const res = await fetch(`${BRIDGE_URL}/signups`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const list = (await res.json()) as Signup[];
  return Array.isArray(list) ? list : [];
}

export async function setSignupStatus(id: string, status: Signup["status"]): Promise<void> {
  await fetch(`${BRIDGE_URL}/signups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
}

/** The address a phone must open to reach the sign-up form: this PC on the venue Wi-Fi. */
export async function signupFormUrl(): Promise<string | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store" });
    if (!res.ok) return null;
    const health = (await res.json()) as { addresses?: string[]; port?: number };
    const address = health.addresses?.[0];
    return address ? `http://${address}:${health.port ?? 8787}/inscription` : null;
  } catch {
    return null;
  }
}

export class BridgeError extends Error {
  readonly kind: "offline" | "refused" | "outdated";
  constructor(kind: BridgeError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}

const OUTDATED_MESSAGE = "Pont de chronométrage à mettre à jour : redémarrez bridge.mjs pour envoyer les noms.";

export async function pushActiveSession(payload: ActiveSessionPayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BRIDGE_URL}/active-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // A bridge from before this endpoint rejects the CORS preflight, which surfaces as a network
    // error. If a plain GET still answers, the bridge is up but needs restarting with the new code.
    const reachable = await fetch(`${BRIDGE_URL}/health`, { cache: "no-store" }).then((r) => r.ok, () => false);
    if (reachable) throw new BridgeError("outdated", OUTDATED_MESSAGE);
    throw new BridgeError("offline", "Pont de chronométrage hors ligne : les noms seront envoyés dès qu’il répond.");
  }
  if (res.ok) return;
  if (res.status === 403) throw new BridgeError("refused", "Le pont refuse : ouvrez le dashboard sur le PC du chronométrage.");
  if (res.status === 404 || res.status === 405) throw new BridgeError("outdated", OUTDATED_MESSAGE);
  throw new BridgeError("offline", `Pont de chronométrage : erreur ${res.status}.`);
}


/** The address printed on the QR poster. It never changes: the page it opens issues its own
 *  single-use token, so one poster serves every client without ever pointing at a stale link. */
export const PUBLIC_SIGNUP_URL = "https://mega-karts.web.app/i";
