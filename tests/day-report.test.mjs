// The Rapport du jour, run against the real lib/day-report.ts and components/reports/day-report-html.ts
// with the cases met on 26/09/2026: names typed differently at the chrono and the till, a family
// that raced twice on one small payment, a pack changed at the counter only by the amount, first
// names alone, test races, and a payment with no race.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const R = await vite.ssrLoadModule("/lib/day-report.ts");
const H = await vite.ssrLoadModule("/components/reports/day-report-html.ts");

const DAY = "2026-09-26";
const at = (h, m = 0) => new Date(2026, 8, 26, h, m);
const iso = (h, m = 0) => at(h, m).toISOString();
const secs = (h, m = 0) => at(h, m).getTime() / 1000;
const offer = (id, name, price, over = {}) => ({ id, kind: "individuel", name, price, basis: "personne", people: null, period: "unique", unit: "sessions", quantity: 1, bonus: 0, enabled: true, ...over });
const OFFERS = [
  offer("s8", "Session 8 min", 120, { kind: "session", unit: "minutes", quantity: 8 }),
  offer("s16", "Session 16 min", 210, { kind: "session", unit: "minutes", quantity: 16 }),
  offer("silver", "Silver", 300, { quantity: 3 }),
  offer("famille", "Pack Famille", 400, { kind: "famille", basis: "groupe", people: 4 }),
  offer("amis", "Pack Amis", 500, { kind: "amis", basis: "groupe", people: 5 }),
];
let n = 0;
const res = (code, names, over = {}) => ({
  id: code, code, channel: "enligne", contactName: names[0], phone: "", email: null, raceType: "practice",
  pilots: names.map((fullName) => ({ id: `${code}-${++n}`, fullName, kartColor: "blue", kartNumber: null })),
  paymentMethod: "Espèces", status: "PAYEE", note: null, createdAt: iso(17), paidAt: iso(17, 5), paidBy: "YB", paidAmount: 120, sessionId: null, ...over,
});
const race = (id, name, h, m, drivers) => ({
  raceId: id, name, state: "FINISHED", startedAt: secs(h, m), finishedAt: secs(h, m + 8), durationS: 480, savedAt: secs(h, m + 8),
  racers: drivers.map(([driver, best, laps = 10], i) => ({ driver, kart: i + 1, transponder: `T${i}`, position: i + 1, laps, lastLapMs: best, bestLapMs: best, lapTimesMs: best ? [best + 900, best] : [] })),
});

test("names typed differently at the chrono and the till still match", () => {
  assert.equal(R.sameName("Simohamed berrada", "MOHAMMED BERRADA"), true);
  assert.equal(R.sameName("Yahya benmimoun", "Yahya Benmimoum"), true);
  assert.equal(R.sameName("ABDLLAH GHRNATI", "Abdellah Gharnati"), true);
  assert.equal(R.sameName("MALAK EL KARANI", "Malak Karani"), true, "particles do not count");
  assert.equal(R.sameName("SAMI HADDOUN", "HAMZA HADDOUN"), false, "brothers are not the same pilot");
  assert.equal(R.sameName("HAMZA", "Hamza Bennani"), false, "a first name alone is never a sure match");
});

test("a family that raced twice on one small payment: the second race is 'en plus', the payment 'sous le tarif'", () => {
  const report = R.buildDayReport({
    day: DAY, offers: OFFERS,
    reservations: [res("MK-3864", ["Ali kettani", "Adam kettani", "Simohamed berrada"], { paidAmount: 120 })],
    signups: [{ queueCode: "MK-3864", code: "AZSM", pack: "famille" }],
    races: [
      race("R1", "SESSION 11", 20, 24, [["ALI KETTANI", 27175], ["ADAM KETTANI", 29718], ["MOHAMMED BERRADA", 33792]]),
      race("R2", "SESSION17", 21, 40, [["ADAM KETTANI", 24449], ["MOHAMMED BERRADA", 24511], ["ALI KETTANI", 29402]]),
    ],
  });
  const p = report.payments[0];
  assert.equal(p.clientCode, "AZSM");
  assert.deepEqual([p.racesDone, p.racesCovered, p.racesExtra], [6, 3, 3]);
  assert.deepEqual(report.races[1].entries.map((e) => e.coverage), ["extra", "extra", "extra"]);
  assert.equal(p.packPrice, 400);
  assert.deepEqual([report.totals.underpaid, report.totals.underpaidDh], [1, 280]);
});

test("paid for 16 minutes while the phone said 8: the amount decides, both races are covered", () => {
  const report = R.buildDayReport({
    day: DAY, offers: OFFERS,
    reservations: [res("MK-3819", ["OMAR ASTIOUI", "BAKKALI HASSAN"], { paidAmount: 420 })],
    signups: [{ queueCode: "MK-3819", code: "QWER", pack: "s8" }],
    races: [
      race("R1", "SESSION 20", 21, 54, [["OMAR ASTIOUI", 25085], ["BAKKALI HASSAN", 22480]]),
      race("R2", "SESSION 21", 22, 7, [["BAKKALI HASSAN", 23324], ["OMAR ASTIOUI", 23753]]),
    ],
  });
  assert.equal(report.payments[0].perPilot, 2);
  assert.equal(report.uncovered.length, 0);
  assert.equal(report.totals.underpaid, 0);
});

test("nobody paid, a first name alone, a test race and a payment with no race", () => {
  const report = R.buildDayReport({
    day: DAY, offers: OFFERS,
    reservations: [
      res("MK-2429", ["KHALID SKALLI", "MOHAMMED KHAWA"], { paidAmount: 240 }),
      res("MK-8094", ["YOUSSEF KHARROUBI"], { paidAmount: 120, paidAt: iso(23, 36) }),
      res("MK-0001", ["Deleted Person"], { status: "SUPPRIMEE" }),
    ],
    races: [
      race("T", "SESSION TEST", 15, 25, [["MOHAMMED", 22644]]),
      race("R1", "SESSION 13", 20, 36, [["MOHAMMED RAIS", 25554], ["HIBA RAIS", 40898]]),
      race("R2", "SESSION 21", 22, 7, [["KHALID SKALLI", 30000], ["KHALID", 34347]]),
    ],
  });
  const cov = Object.fromEntries(report.races.flatMap((r) => r.entries).map((e) => [e.driver, e.coverage]));
  assert.deepEqual(cov, { MOHAMMED: "none", "MOHAMMED RAIS": "none", "HIBA RAIS": "none", "KHALID SKALLI": "paid", KHALID: "check" });
  assert.equal(report.totals.tests, 1, "the test race is set apart");
  assert.equal(report.totals.driverRaces, 4, "and not counted");
  assert.deepEqual(report.paidNoRace.map((p) => p.code), ["MK-8094"]);
  assert.equal(report.totals.missingDh, 3 * 120, "three races uncovered, at the Session 8 min price");
  assert.equal(report.totals.revenue, 360, "the bin is not revenue");
  assert.match(report.races[2].entries[1].suggestions[0], /KHALID SKALLI · MK-2429/);
});

test("the printed report: problems first, every race with its times, names escaped", () => {
  const report = R.buildDayReport({
    day: DAY, offers: OFFERS,
    reservations: [res("MK-5545", ["Amal bouqdir"])],
    races: [race("R1", "SESSION 1", 17, 20, [["Amal bouqdir", 36437], ["<b>Intrus</b>", 30000]])],
  });
  const html = H.dayReportHtml(report, { generatedAt: at(23, 50) });
  assert.match(html, /<title>MegaKart - Rapport des courses - 2026-09-26<\/title>/);
  assert.ok(html.indexOf("À vérifier") < html.indexOf("Paiements du jour") && html.indexOf("Paiements du jour") < html.indexOf("Détail des courses"));
  assert.match(html, /&lt;b&gt;Intrus&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Intrus<\/b>/);
  assert.match(html, /T2 36\.437/, "every lap is listed");
  assert.match(html, /Aucun paiement/);
});

// ---- the same report from Firebase, as the MegaKart API builds it for the manager's app
const rules = await import("../lib/day-report-rules.mjs");
const { dayReportPdf } = await import("../lib/day-report-pdf.mjs");

test("from the /reports documents: the venue's day, whatever the server's clock", () => {
  // 23:30 in Fès on the 26th is 22:30 UTC: still the 26th at the venue.
  assert.equal(rules.venueDay(Date.UTC(2026, 8, 26, 22, 30)), "2026-09-26");
  assert.equal(rules.venueDay(Date.UTC(2026, 8, 26, 23, 30)), "2026-09-27");
  const input = rules.inputFromReports({
    day: DAY,
    raceDocs: [
      { raceId: "R1", day: DAY, name: "SESSION 20", startedAt: at(21, 54).getTime(), finishedAt: at(22, 2).getTime(),
        racers: [{ driver: "OMAR ASTIOUI", kart: 3, laps: 16, bestLapMs: 25085, lapTimesMs: [26000, 25085] }] },
      { raceId: "R0", day: "2026-09-25", name: "hier", racers: [] },
    ],
    reservationDocs: [
      { code: "MK-3819", clientCode: "UW66", status: "PAYEE", day: DAY, paidAt: at(21, 45).getTime(), paidAmount: 420, method: "cash",
        pilotNames: ["OMAR ASTIOUI", "BAKKALI HASSAN"], pack: "Session 8 min", expectedAmount: 240 },
      { code: "MK-1111", status: "PAYEE", day: "2026-09-24", paidAt: new Date(2026, 8, 24, 12).getTime(), paidAmount: 120, pilotNames: ["Paid Earlier"] },
      { code: "MK-2222", status: "PAYEE", day: "2026-09-25", paidAt: at(10).getTime(), paidAmount: 120, pilotNames: ["Booked Yesterday"] },
    ],
  });
  assert.deepEqual(input.races.map((r) => r.raceId), ["R1"]);
  assert.deepEqual(input.till.map((t) => t.code), ["MK-3819", "MK-2222"], "booked that day, or booked before and cashed that day");
  assert.equal(input.till[0].method, "Espèces");
  const report = rules.buildDayReport({ day: DAY, ...input, offers: OFFERS });
  assert.equal(report.payments.find((p) => p.code === "MK-3819").perPilot, 2, "420 DH for two: the amount decides");
  assert.equal(report.totals.covered, 1);
  assert.equal(report.totals.revenue, 540);
});

test("the PDF: a real file, one entry per object in its index, every race and pilot in it", async () => {
  const zlib = await import("node:zlib");
  const report = R.buildDayReport({
    day: DAY, offers: OFFERS,
    reservations: [res("MK-3864", ["Ali kettani", "Adam kettani"], { paidAmount: 120 })],
    signups: [{ queueCode: "MK-3864", code: "AZSM", pack: "famille" }],
    races: [race("R1", "SESSION 11", 20, 24, [["ALI KETTANI", 27175], ["ADAM KETTANI", 29718], ["Asmaé El Khelifi", 37031]])],
  });
  const pdf = dayReportPdf(report, { generatedAt: at(23, 50) });
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4") && text.trimEnd().endsWith("%%EOF"));
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.ok(text.startsWith("xref", xrefAt));
  const rows = text.slice(xrefAt).split("\n");
  const count = Number(rows[1].split(" ")[1]);
  for (let n = 1; n < count; n++) assert.ok(text.startsWith(`${n} 0 obj`, Number(rows[2 + n].slice(0, 10))), `object ${n}`);
  // The pages' drawing, unpacked: names (accents in the PDF's own encoding), times, verdicts.
  const drawn = [...text.matchAll(/>>\nstream\n/g)].map((m) => {
    const start = m.index + 10;
    return zlib.inflateSync(pdf.subarray(start, text.indexOf("\nendstream", start))).toString("latin1");
  }).join("\n");
  for (const s of ["(ALI KETTANI)", "(ADAM KETTANI)", "(Asma\\351 El Khelifi)", "(27.175)", "(Aucun paiement)", "(SESSION 11)"]) assert.ok(drawn.includes(s), s);
  assert.match(drawn, /\(tarif 400 DH\)/);
});
