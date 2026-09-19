// Firebase, used only for what must work away from the venue: clients booking from their phone
// on mobile data. Timing, the big screen and kart naming stay on the local bridge.
//
// These values are public by design — a Firebase web config identifies the project, it does not
// grant access. Access is decided by database.rules.json, and staff read anything only after
// signing in. The admin service-account key is never used here and must never ship to a browser.
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";
import { getAuth, type Auth } from "firebase/auth";

const env = (typeof import.meta !== "undefined" ? (import.meta as { env?: Record<string, string> }).env : undefined) ?? {};

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? "",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? "",
  databaseURL: env.VITE_FIREBASE_DATABASE_URL ?? "",
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? "",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: env.VITE_FIREBASE_SENDER_ID ?? "",
  appId: env.VITE_FIREBASE_APP_ID ?? "",
};

/** True when this build was given a Firebase project; false keeps everything local. */
export const firebaseEnabled = Boolean(config.apiKey && config.databaseURL);

let app: FirebaseApp | null = null;
function firebaseApp(): FirebaseApp | null {
  if (!firebaseEnabled) return null;
  if (!app) app = getApps()[0] ?? initializeApp(config);
  return app;
}

export function cloudDb(): Database | null {
  const a = firebaseApp();
  return a ? getDatabase(a) : null;
}

export function cloudAuth(): Auth | null {
  const a = firebaseApp();
  return a ? getAuth(a) : null;
}
