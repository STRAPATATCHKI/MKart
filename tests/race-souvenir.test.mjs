import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

// Souvenir links are printed on screens and saved on players' phones, so the encoding is a
// public format: these tests pin the round trip and the classification the phone shows.
const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});

after(async () => {
  await vite.close();
});

const souvenir = await vite.ssrLoadModule("/lib/race-souvenir.ts");
const { Ecc, QrCode } = await vite.ssrLoadModule("/lib/qrcodegen.ts");

const race = {
  id: "S-MU35PJB3",
  finishedAt: "2026-09-15T20:58:12.000Z",
  kind: "race",
  track: "MegaKart Fès",
  drivers: [
    { name: "Karim Benjelloun", kart: "6", laps: 4, bestLapMs: 40950, totalTimeMs: 165150, pilot: 1 },
    { name: "Lina Sefrioui", kart: "11", laps: 4, bestLapMs: 41350, totalTimeMs: 166850, pilot: 7 },
    { name: "Inès Lahlou", kart: "2", laps: 3, bestLapMs: null, totalTimeMs: null, pilot: null },
  ],
};

test("encodes a finished race into a link and decodes it back unchanged", async () => {
  const url = await souvenir.souvenirUrl(race, "https://mega-karts.web.app");
  assert.match(url, /^https:\/\/mega-karts\.web\.app\/#souvenir=[zj][A-Za-z0-9_-]+$/);
  const token = url.slice(url.indexOf(souvenir.SOUVENIR_HASH_PREFIX) + souvenir.SOUVENIR_HASH_PREFIX.length);
  assert.deepEqual(await souvenir.decodeSouvenir(token), race);
});

test("still decodes links made before pilots were added to the format", async () => {
  // A v1 link whose drivers have no pilot field: printed QR codes must keep working.
  const packed = [1, "S-OLD", 1758000000, 0, "MegaKart Fès", [["Ancien Pilote", "5", 8, 41000, 330000]]];
  const token = "j" + Buffer.from(JSON.stringify(packed), "utf8").toString("base64url");
  const decoded = await souvenir.decodeSouvenir(token);
  assert.equal(decoded.id, "S-OLD");
  assert.deepEqual(decoded.drivers, [{ name: "Ancien Pilote", kart: "5", laps: 8, bestLapMs: 41000, totalTimeMs: 330000, pilot: null }]);
});

test("rejects links that are not souvenirs", async () => {
  await assert.rejects(souvenir.decodeSouvenir("xnot-a-souvenir"));
});

test("orders archived bridge results by position and computes gaps to the winner", () => {
  const archived = souvenir.souvenirFromHistory({
    id: "S-1",
    archivedAt: race.finishedAt,
    drivers: [
      { position: 2, name: "B", kart: "2", laps: 4, bestLapMs: 41000, totalTimeMs: 166000, color: 3 },
      { position: 1, name: "A", kart: "1", laps: 4, bestLapMs: 40000, totalTimeMs: 164800, color: 6 },
      { position: 3, name: "C", kart: "3", laps: 3, bestLapMs: 42000, totalTimeMs: 130000 },
    ],
  });
  assert.deepEqual(archived.drivers.map((d) => d.name), ["A", "B", "C"]);
  // The pilot each player picked at sign-up follows them onto the souvenir page.
  assert.deepEqual(archived.drivers.map((d) => d.pilot), [6, 3, null]);
  const [winner, second, lapped] = archived.drivers;
  assert.equal(souvenir.souvenirGap(winner, winner), null);
  assert.equal(souvenir.souvenirGap(second, winner), "+1.200");
  assert.equal(souvenir.souvenirGap(lapped, winner), "+1 T");
});

test("a full 12-kart souvenir link still fits a QR code a phone can scan from the TV", async () => {
  const field = Array.from({ length: 12 }, (_, i) => ({
    name: `Pilote Numéro ${i + 1}`,
    kart: String(i + 1),
    laps: 12,
    bestLapMs: 40000 + i * 137,
    totalTimeMs: 500000 + i * 1733,
  }));
  const url = await souvenir.souvenirUrl({ ...race, drivers: field }, "https://mega-karts.web.app");
  const qr = QrCode.encodeText(url, Ecc.MEDIUM);
  assert.ok(qr.version <= 20, `QR version ${qr.version} is too dense for a TV scan`);
});
