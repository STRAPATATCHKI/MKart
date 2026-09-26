// The timing sheet a client takes home, built by the real components/timing/print-timings.ts:
// black and white, one page per driver, every lap with the best one marked, names escaped.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
after(async () => { await vite.close(); });
const P = await vite.ssrLoadModule("/components/timing/print-timings.ts");

const t = new Date(2026, 8, 25, 19, 53).getTime() / 1000;
const race = {
  raceId: "20260925-003", name: "SESSION 6", state: "FINISHED", startedAt: t - 600, finishedAt: t, durationS: 600, savedAt: t,
  racers: [
    { driver: "BAKKALI HASAN", kart: 13, transponder: "T13", position: 1, laps: 3, lastLapMs: 23078, bestLapMs: 22519, lapTimesMs: [27613, 22519, 23078] },
    { driver: "OMAR <b>ASTIME</b>", kart: 3, transponder: "T3", position: 2, laps: 2, lastLapMs: 25308, bestLapMs: 23710, lapTimesMs: [23710, 25308] },
  ],
};

test("one page per driver, every lap listed, the best one marked", () => {
  const html = P.timingSheetsHtml(race, race.racers);
  assert.equal(html.match(/<section class="sheet">/g).length, 2);
  assert.match(html, /\.sheet \+ \.sheet \{ break-before: page/);
  assert.equal(html.match(/<li/g).length, 5, "3 + 2 laps");
  assert.match(html, /<li class="best"><span>T2<\/span><b>22\.519<\/b><em>★ meilleur<\/em>/);
  assert.match(html, /<span>T1<\/span><b>27\.613<\/b><em>\+5\.094<\/em>/);
  assert.match(html, /1er<small> \/ 2<\/small>/);
  assert.match(html, /<footer>[^<]*megakart\.ma<\/footer>/, "the venue's website on the paper");
});

test("black and white only: no colour anywhere in the sheet", () => {
  const html = P.timingSheetsHtml(race, race.racers, { record: { lapMs: 23594, driver: null } });
  const colours = (html.match(/#[0-9a-f]{3,6}\b/gi) || []).map((c) => c.toLowerCase());
  assert.ok(colours.every((c) => ["#000", "#fff", "#000000", "#ffffff"].includes(c)), colours.join(","));
  assert.match(html, /grayscale\(1\)/, "the logo is printed in grey");
});

test("a driver's own sheet: gap to the race's best lap, and the record to chase", () => {
  const html = P.timingSheetsHtml(race, [race.racers[1]], { record: { lapMs: 23594, driver: "Yassen" } });
  assert.equal(html.match(/<section class="sheet">/g).length, 1);
  assert.match(html, /par BAKKALI HASAN · écart <b>\+1\.191<\/b>/);
  assert.match(html, /Record de la piste : <b>23\.594<\/b> par Yassen · encore <b>0\.116 s<\/b> à gagner/);
  const fastest = P.timingSheetsHtml(race, [race.racers[0]], { record: { lapMs: 23594, driver: null } });
  assert.match(fastest, /Meilleur tour de la course\./);
  assert.doesNotMatch(fastest, /à gagner/, "under the record: nothing left to gain");
});

test("names are printed as text, never as markup", () => {
  const html = P.timingSheetsHtml(race, [race.racers[1]]);
  assert.match(html, /OMAR &lt;b&gt;ASTIME&lt;\/b&gt;/);
  assert.doesNotMatch(html, /OMAR <b>ASTIME/);
});

test("a race saved without lap detail says so rather than printing an empty list", () => {
  const old = { ...race, racers: [{ ...race.racers[0], lapTimesMs: undefined }] };
  assert.match(P.timingSheetsHtml(old, old.racers), /Détail des tours non enregistré/);
});
