// Build the web bundle on Render, and only there.
//
// Render runs `npm ci` and then starts the desk server — nothing builds the site in between, so
// desk.mjs finds no dist/client and answers "Bundle introuvable" to every page request. npm runs
// this script after an install, so the bundle is built where it is missing and nowhere else.
//
// A failure here never fails the deploy: the reservation API is worth more online than a page,
// so we log the reason and let the server start anyway.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

if (!process.env.RENDER) process.exit(0); // a laptop install: nothing to do
if (fs.existsSync("dist/client/index.html")) {
  console.log("[render] bundle déjà présent");
  process.exit(0);
}

console.log("[render] construction du bundle web…");
const built = spawnSync("npm", ["run", "build:firebase"], { stdio: "inherit", shell: process.platform === "win32" });
if (built.status === 0 && fs.existsSync("dist/client/index.html")) {
  console.log("[render] bundle prêt");
} else {
  console.log(`[render] bundle non construit (code ${built.status}) — l'API démarre quand même`);
}
