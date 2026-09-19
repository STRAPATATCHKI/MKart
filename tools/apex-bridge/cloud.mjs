// Privileged access to the Firebase Realtime Database, from this PC only.
//
// The venue PC holds the service-account key; phones never do. It is used for exactly one thing:
// minting the short-lived, single-use invites behind the inscription QR code. Google's OAuth
// dance is done by hand with node:crypto so the bridge keeps its "no npm dependencies" rule.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = process.env.FIREBASE_KEY_FILE || path.join(__dirname, "..", "..", "ignore.json");
const SCOPES = "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email";

let key = null;
export function cloudConfigured() {
  if (key) return true;
  try {
    // A host has no repository to put a file in, so the key may come through the environment:
    // FIREBASE_SERVICE_ACCOUNT holds the JSON itself, FIREBASE_KEY_FILE a path to it (Render's
    // secret files land in /etc/secrets). On the venue PC neither is set and we read ignore.json.
    const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
    const raw = JSON.parse(inline || fs.readFileSync(KEY_FILE, "utf8"));
    if (!raw.client_email || !raw.private_key) return false;
    // An environment variable cannot hold real newlines, so a pasted key arrives with \n in it.
    raw.private_key = raw.private_key.replace(/\\n/g, "\n");
    key = raw;
    return true;
  } catch {
    return false;
  }
}

export const DB_URL = (process.env.FIREBASE_DATABASE_URL || "https://mega-karts-default-rtdb.asia-southeast1.firebasedatabase.app").replace(/\/+$/, "");

const b64url = (input) => Buffer.from(input).toString("base64url");
let cached = { token: null, expires: 0 };

async function accessToken() {
  if (!cloudConfigured()) throw new Error("clé de service Firebase absente");
  if (cached.token && Date.now() < cached.expires - 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: key.client_email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(key.private_key).toString("base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`OAuth ${res.status}: ${body.error_description || body.error || "refusé"}`);
  cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function rtdb(method, at, data) {
  const token = await accessToken();
  const res = await fetch(`${DB_URL}/${at}.json?access_token=${encodeURIComponent(token)}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!res.ok) throw new Error(`base de données ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json().catch(() => null);
}

export const cloudGet = (at) => rtdb("GET", at);
export const cloudPut = (at, data) => rtdb("PUT", at, data);
export const cloudPatch = (at, data) => rtdb("PATCH", at, data);
export const cloudDelete = (at) => rtdb("DELETE", at);

/** A fresh single-use invite: the QR at the counter points at it, and it dies on use or on timeout. */
export async function mintInvite({ ttlMinutes = 15, label = "" } = {}) {
  const token = crypto.randomBytes(9).toString("base64url"); // 12 chars, unguessable
  const invite = { createdAt: Date.now(), expiresAt: Date.now() + ttlMinutes * 60_000, used: false };
  if (label) invite.label = label.slice(0, 40);
  await cloudPut(`invites/${token}`, invite);
  return { token, ...invite };
}
