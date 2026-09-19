// Generates public/inscription.html — the hosted twin of the bridge's sign-up form.
//
// One source of truth (tools/apex-bridge/signup-page.mjs): this script only repoints the images
// at the hosted paths and flips the form into "cloud" mode, where it writes straight to the
// Realtime Database instead of posting to the local bridge. Run it before a deploy.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SIGNUP_PAGE } from "../tools/apex-bridge/signup-page.mjs";

const DB_URL = process.env.VITE_FIREBASE_DATABASE_URL || process.env.FIREBASE_DATABASE_URL;
if (!DB_URL) {
  console.error("Set VITE_FIREBASE_DATABASE_URL (see .env.local) before building the hosted form.");
  process.exit(1);
}

const html = SIGNUP_PAGE
  // assets served by the bridge at /assets/… live at the site root once hosted
  .replaceAll('url("/assets/logo.png")', 'url("/megakart-loader-logo.png")')
  .replaceAll('url("/assets/wheel.png")', 'url("/megakart-loader-wheel.png")')
  .replaceAll("/assets/driver-", "/drivers/driver-")
  // talk to the database instead of the bridge
  .replace('var SIGNUP_MODE = "local";', 'var SIGNUP_MODE = "cloud";')
  .replace('var CLOUD_DB_URL = "";', `var CLOUD_DB_URL = ${JSON.stringify(DB_URL.replace(/\/+$/, ""))};`)
  // the offline hint is wrong online: a phone here is on mobile data, not the venue Wi-Fi
  .replaceAll("Vérifiez le Wi-Fi MegaKart et réessayez.", "Vérifiez votre connexion et réessayez.");

const out = fileURLToPath(new URL("../public/inscription.html", import.meta.url));
writeFileSync(out, html);
console.log(`inscription.html written (${(html.length / 1024).toFixed(0)} KB) → ${DB_URL}`);
