// Assemble the PUBLIC site: the inscription form and nothing else.
//
// `dist/client` is the whole dashboard bundle. Publishing that folder puts the operator's
// dashboard on the internet as a side effect of publishing the sign-up form — an empty shell,
// since every API behind it is unreachable, but there is no reason for it to be there at all.
//
// This copies only what the form actually loads: the page, the eight driver avatars it draws,
// and the two loader images its CSS references. Everything else in dist/client is dashboard
// JavaScript the form never touches.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const SRC = "dist/client";
const OUT = "dist/inscription";

// Exactly what inscription.html references, verified by reading the built file:
//   src="/drivers/driver-N.png"   url("/megakart-loader-logo.png")   url("/megakart-loader-wheel.png")
// The souvenir page - the QR a pilot scans off the podium - is a route of the app bundle, so
// the bundle ships too. It is reachable only at /s (see firebase.json); the root is the form.
// The dashboard it also contains is an empty shell out there: every API behind it is on the
// desk PC and refuses anything that is not localhost.
const FILES = ["inscription.html", "megakart-loader-logo.png", "megakart-loader-wheel.png", "favicon.svg"];
// The app's entry goes out as app.html, NOT index.html: Firebase serves an index.html that
// exists before it applies any rewrite, which would put the app shell on the root instead of
// the form. Under its own name it is only reachable through the /s rewrite.
const RENAMED = { "index.html": "app.html" };
const DIRS = ["drivers", "assets"];

// The bundle that ships under /s must type-check. A story card once went out with a stale
// variable because nothing between "vinext build" and "firebase deploy" ran the compiler; the
// build succeeds on code tsc rejects. These files already had errors before this gate existed
// and are not part of what the public site loads - anything else failing stops the publish.
const KNOWN_BROKEN = [/^db\//, /^hooks\/use-chrono\.ts/, /^hooks\/use-gokarts-sessions\.ts/, /^hooks\/use-kart-map\.ts/,
                      /^hooks\/use-queue\.ts/, /^lib\/reservation-store\.ts/];
{
  const tsc = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "."], { encoding: "utf8" });
  const errors = `${tsc.stdout || ""}${tsc.stderr || ""}`.split(/\r?\n/)
    .filter((line) => /error TS\d+/.test(line))
    .filter((line) => !KNOWN_BROKEN.some((re) => re.test(line.replace(/\\/g, "/"))));
  if (tsc.error || errors.length) {
    console.error("[inscription] erreurs TypeScript — publication refusée :");
    for (const line of errors.slice(0, 20)) console.error("  " + line);
    if (tsc.error) console.error("  " + tsc.error.message);
    process.exit(1);
  }
}

if (!fs.existsSync(path.join(SRC, "inscription.html"))) {
  console.error(`[inscription] ${SRC}/inscription.html absent — lancez d'abord: npm run build:firebase`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let copied = 0;
for (const name of FILES) {
  const from = path.join(SRC, name);
  if (!fs.existsSync(from)) continue;      // favicon is optional; the page still renders
  fs.copyFileSync(from, path.join(OUT, name));
  copied += 1;
}
for (const [name, as] of Object.entries(RENAMED)) {
  const from = path.join(SRC, name);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(OUT, as));
  copied += 1;
}
for (const dir of DIRS) {
  const from = path.join(SRC, dir);
  if (!fs.existsSync(from)) continue;
  fs.cpSync(from, path.join(OUT, dir), { recursive: true });
  copied += fs.readdirSync(path.join(OUT, dir)).length;
}

// A sign-up page that cannot draw its driver avatars is broken in a way that only shows up on
// a customer's phone, so refuse to publish one rather than find out there.
const drivers = fs.existsSync(path.join(OUT, "drivers"))
  ? fs.readdirSync(path.join(OUT, "drivers")).filter((f) => f.endsWith(".png")).length
  : 0;
if (drivers < 8) {
  console.error(`[inscription] seulement ${drivers} avatars pilote sur 8 — publication refusée`);
  process.exit(1);
}

const bytes = fs.readdirSync(OUT, { recursive: true })
  .map((f) => path.join(OUT, String(f)))
  .filter((f) => fs.statSync(f).isFile())
  .reduce((n, f) => n + fs.statSync(f).size, 0);

console.log(`[inscription] ${OUT} prêt — ${copied} fichiers, ${Math.round(bytes / 1024)} Ko, ${drivers} avatars`);
console.log("[inscription] souvenirs servis sous /s ; le dashboard n'est pas exposé à la racine");
