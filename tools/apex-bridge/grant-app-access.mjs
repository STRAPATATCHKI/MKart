// Give (or take back) an app account's access to /reports - revenue and races.
//
//   node grant-app-access.mjs <UID>            give access
//   node grant-app-access.mjs --remove <UID>   take it back
//   node grant-app-access.mjs --list           who has access
//
// The UID is the account's "User UID" in Firebase console > Authentication > Users. Being
// signed in is not enough to read the reports: the rules also require /staff/<UID> = true, and
// only this PC's service key can write there.

import { cloudConfigured, cloudDelete, cloudGet, cloudPut } from "./cloud.mjs";

const args = process.argv.slice(2);
if (!cloudConfigured()) { console.error("Clé de service Firebase absente sur ce PC."); process.exit(1); }

const validUid = (uid) => /^[A-Za-z0-9_-]{6,128}$/.test(uid || "");

try {
  if (args[0] === "--list") {
    const staff = await cloudGet("staff.json");
    const uids = Object.keys(staff || {}).filter((k) => staff[k] === true);
    console.log(uids.length ? `Accès aux rapports :\n  ${uids.join("\n  ")}` : "Aucun compte n'a accès aux rapports.");
  } else if (args[0] === "--remove") {
    if (!validUid(args[1])) throw new Error("UID manquant ou invalide.");
    await cloudDelete(`staff/${args[1]}`);
    console.log(`Accès retiré : ${args[1]}`);
  } else {
    if (!validUid(args[0])) throw new Error("Usage : node grant-app-access.mjs <UID>   (UID : Firebase > Authentication > Users)");
    await cloudPut(`staff/${args[0]}`, true);
    console.log(`Accès donné : ${args[0]} peut lire /reports (revenus et courses).`);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
