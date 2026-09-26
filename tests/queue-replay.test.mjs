// "+ Rejouer" on the Liste d'attente, run against the real lib/queue-replay.mjs that the desk
// uses to create the reservation and the pop-up uses to find the client.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as R from "../lib/queue-replay.mjs";

let n = 0;
const ids = () => ({ id: `RES-${++n}`, code: `MK-90${n}`, pilotId: () => `PIL-${++n}` });
const pilot = (id, fullName, kartColor = "blue") => ({ id, fullName, kartColor, kartNumber: 4 });
const omar = {
  id: "RES-A", code: "MK-3108", channel: "enligne", contactName: "OMAR ASTIME", phone: "0611220225", email: null,
  raceType: "practice", pilots: [pilot("P1", "OMAR ASTIME"), pilot("P2", "BAKKALI HASAN", "green")],
  paymentMethod: "Espèces", status: "PAYEE", paidAt: "2026-09-25T19:27:24Z", paidAmount: 420, paidBy: "YB",
  createdAt: "2026-09-25T17:25:00Z", packOverride: null, sessionId: "S1",
};
const silver = { id: "silver", kind: "pack", name: "Silver", price: 150, basis: "personne", period: "unique", enabled: true };
const AT = "2026-09-25T20:00:00.000Z";

test("the whole group races again: a new reservation waiting, the paid one untouched", () => {
  const before = JSON.stringify(omar);
  const r = R.replayReservation(omar, { pilotIds: [], offer: silver, by: "YB", clientCode: "KYRW", at: AT, ids: ids() });
  assert.equal(JSON.stringify(omar), before, "the first reservation and its payment are not changed");
  assert.notEqual(r.code, omar.code);
  assert.equal(r.status, "EN_ATTENTE");
  assert.equal(r.channel, "guichet");
  assert.deepEqual([r.paidAt, r.paidBy, r.paidAmount, r.sessionId], [null, null, undefined, null]);
  assert.deepEqual(r.pilots.map((p) => p.fullName), ["OMAR ASTIME", "BAKKALI HASAN"]);
  assert.ok(r.pilots.every((p) => p.kartNumber === null && !["P1", "P2"].includes(p.id)), "fresh pilots, no kart yet");
  assert.equal(r.pilots[1].kartColor, "green");
  assert.deepEqual(r.replayOf, { code: "MK-3108", clientCode: "KYRW" });
  assert.equal(r.packOverride.total, 300, "Silver for two");
  assert.equal(r.packOverride.pilots, 2);
  assert.equal(r.createdAt, AT);
});

test("only one pilot of the group: they alone, their name on the row, priced for one", () => {
  const r = R.replayReservation(omar, { pilotIds: ["P2"], offer: silver, by: "YB", clientCode: "KYRW", at: AT, ids: ids() });
  assert.deepEqual(r.pilots.map((p) => p.fullName), ["BAKKALI HASAN"]);
  assert.equal(r.contactName, "BAKKALI HASAN");
  assert.equal(r.phone, omar.phone, "the group's number, the only one there is");
  assert.equal(r.packOverride.total, 150);
  const withBooker = R.replayReservation(omar, { pilotIds: ["P1"], offer: null, by: "YB", clientCode: null, at: AT, ids: ids() });
  assert.equal(withBooker.contactName, "OMAR ASTIME");
  assert.equal(withBooker.packOverride, null, "no pack yet: chosen at the counter later");
});

test("a re-race of a re-race still points to the client's first code", () => {
  const first = R.replayReservation(omar, { pilotIds: [], offer: null, by: "YB", clientCode: "KYRW", at: AT, ids: ids() });
  const second = R.replayReservation(first, { pilotIds: [], offer: null, by: "YB", clientCode: null, at: AT, ids: ids() });
  assert.deepEqual(second.replayOf, { code: first.code, clientCode: "KYRW" });
});

test("refused: nobody chosen, unknown pilots, or a deleted reservation", () => {
  assert.equal(typeof R.replayReservation(omar, { pilotIds: ["nope"], offer: null, at: AT, ids: ids() }), "string");
  assert.equal(typeof R.replayReservation({ ...omar, status: "SUPPRIMEE" }, { pilotIds: [], offer: null, at: AT, ids: ids() }), "string");
  assert.equal(typeof R.replayReservation(null, { pilotIds: [], offer: null, at: AT, ids: ids() }), "string");
});

test("the search finds a client by any pilot's name, accents and case ignored, newest first", () => {
  const list = [
    omar,
    { ...omar, id: "B", code: "MK-2744", contactName: "YAZID SLASSI", phone: "0612349347", pilots: [pilot("P3", "Yazid Slassi")], createdAt: "2026-09-25T17:05:00Z" },
    { ...omar, id: "C", code: "MK-1000", contactName: "Hasnaé Amrani", pilots: [pilot("P4", "Hasnaé Amrani")], createdAt: "2026-09-24T12:00:00Z" },
    { ...omar, id: "D", code: "MK-1001", contactName: "Omar Test", pilots: [pilot("P5", "Omar Test")], status: "SUPPRIMEE", createdAt: "2026-09-25T18:00:00Z" },
  ];
  const codes = new Map([["MK-3108", "KYRW"]]);
  const find = (q) => R.replayMatches(list, q, (c) => codes.get(c)).map((r) => r.code);
  assert.deepEqual(find("bakkali"), ["MK-3108"], "a pilot who is not the booker");
  assert.deepEqual(find("hasnae"), ["MK-1000"], "without the accent");
  assert.deepEqual(find("hasan bakkali"), ["MK-3108"], "words in any order");
  assert.deepEqual(find("omar"), ["MK-3108"], "deleted reservations are never offered");
  assert.deepEqual(find("kyrw"), ["MK-3108"], "the client's code");
  assert.deepEqual(find("2744"), ["MK-2744"], "the desk code");
  assert.deepEqual(find("06 12 34"), ["MK-2744"], "the phone");
  assert.deepEqual(find(""), ["MK-3108", "MK-2744", "MK-1000"], "nothing typed: the latest");
});

test("a pilot already waiting is flagged, so the same person is not queued twice by mistake", () => {
  const waiting = { ...omar, code: "MK-5555", status: "EN_ATTENTE" };
  assert.equal(R.alreadyWaiting([omar, waiting], "Bakkali Hasan")?.code, "MK-5555");
  assert.equal(R.alreadyWaiting([omar], "BAKKALI HASAN"), null, "a paid reservation is not waiting");
});

test("the pack chosen at the counter is priced from the catalog, as when correcting one", () => {
  const group = { id: "fam", kind: "pack", name: "Pack Famille", price: 400, basis: "groupe", period: "unique", people: 5, minPeople: 3, enabled: true };
  const o = R.packOverrideFor(group, 2, "YB", AT);
  assert.equal(o.basis, "groupe");
  assert.equal(o.total, 400);
  assert.equal(o.fits, false, "meant for 3 to 5: the cashier may still choose it");
});
