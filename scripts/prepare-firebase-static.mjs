import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const clientDir = join(process.cwd(), "dist", "client");
const manifestPath = join(clientDir, ".vite", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const assets = await readdir(join(clientDir, "assets"));

const pageFile = manifest["app/page.tsx"]?.file;
const frameworkKey = manifest["app/page.tsx"]?.imports?.find((key) =>
  manifest[key]?.name === "framework",
);
const frameworkFile = frameworkKey ? manifest[frameworkKey]?.file : undefined;
const cssFile = assets.find((file) => /^index-[\w-]+\.css$/.test(file));

if (!pageFile || !frameworkFile || !cssFile) {
  throw new Error("Firebase static entry assets were not found in dist/client.");
}

const staticEntry = `import { i as loadReact, t as loadReactDomClient } from "/${frameworkFile}";
import Home from "/${pageFile}";

const React = loadReact();
const ReactDOMClient = loadReactDomClient();
const root = document.getElementById("root");

ReactDOMClient.createRoot(root).render(React.createElement(Home));
`;

const indexHtml = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#050604" />
    <link rel="icon" href="/favicon.svg" />
    <link rel="stylesheet" href="/assets/${cssFile}" />
    <title>MegaKart Operations Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/static-entry.js"></script>
  </body>
</html>
`;

await Promise.all([
  writeFile(join(clientDir, "static-entry.js"), staticEntry),
  writeFile(join(clientDir, "index.html"), indexHtml),
]);

console.log("Firebase static entry prepared in dist/client.");
