// Turn the build into something a plain file host can serve.
//
// vinext builds the dashboard for a server that renders the first HTML, so its client bundle only
// ships hydrateRoot and expects that server to exist. Firebase Hosting and the desk server on
// Render serve files and nothing else, so we build the same app once more as an ordinary
// single-page bundle (vite.static.config.ts) and let it write index.html into dist/client.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const built = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build", "--config", "vite.static.config.ts"],
  { stdio: "inherit" },
);

if (built.status !== 0 || !existsSync("dist/client/index.html")) {
  console.error("Firebase static entry: the single-page build failed.");
  process.exit(built.status || 1);
}

console.log("Firebase static entry prepared in dist/client.");
