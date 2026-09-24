// MegaKart API on its own - for a host other than the MKart service, which already serves the
// same routes under /v1 through the desk server (tools/reservations/desk.mjs).
//
//   node tools/megakart-api/server.mjs        env: MEGAKART_API_KEY, FIREBASE_SERVICE_ACCOUNT, PORT

import http from "node:http";
import { createApiHandler } from "./api.mjs";

const PORT = Number(process.env.PORT || 10000);
const handle = createApiHandler({ apiKey: process.env.MEGAKART_API_KEY });

http.createServer(async (req, res) => {
  if (await handle(req, res)) return;
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "Route inconnue. Voir docs/megakart-api.md." }));
}).listen(PORT, () => console.log(`MegaKart API en écoute sur le port ${PORT}`));
