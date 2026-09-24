// The waiting badge on the "Liste d'attente" nav item.
//
// The rule is reimplemented here exactly as lib/queue-badge.ts defines it, the way
// live-track.test.mjs and start-sequence.test.mjs do. What it protects: the badge must appear
// the moment someone is waiting, must disappear completely when nobody is, and must agree with
// what the Liste d'attente page itself counts as waiting.
import { strict as assert } from "node:assert";
import test from "node:test";

const WAITING = new Set(["EN_ATTENTE", "AU_GUICHET"]);

function waitingCount(reservations) {
  if (!Array.isArray(reservations)) return 0;
  let n = 0;
  for (const r of reservations) if (r && typeof r.status === "string" && WAITING.has(r.status)) n += 1;
  return n;
}

function waitingPilots(reservations) {
  if (!Array.isArray(reservations)) return 0;
  let n = 0;
  for (const r of reservations) {
    if (!r || typeof r.status !== "string" || !WAITING.has(r.status)) continue;
    n += Array.isArray(r.pilots) ? r.pilots.length : 0;
  }
  return n;
}

function badgeLabel(count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? "99+" : String(Math.floor(count));
}

function badgeTitle(groups, pilots) {
  if (groups <= 0) return "Personne en attente";
  const g = `${groups} ${groups > 1 ? "groupes" : "groupe"} en attente`;
  if (pilots <= 0) return g;
  return `${g} · ${pilots} ${pilots > 1 ? "pilotes" : "pilote"}`;
}

const row = (status, pilots = 1) => ({ status, pilots: Array.from({ length: pilots }, (_, i) => ({ id: i })) });

test("someone waiting puts a number on the nav", () => {
  assert.equal(waitingCount([row("EN_ATTENTE")]), 1);
  assert.equal(badgeLabel(waitingCount([row("EN_ATTENTE")])), "1");
});

test("a group at the counter still counts — it is not dealt with until it is paid", () => {
  assert.equal(waitingCount([row("AU_GUICHET")]), 1);
});

test("nothing waiting draws no badge at all, not a zero", () => {
  assert.equal(badgeLabel(waitingCount([])), null);
  assert.equal(badgeLabel(waitingCount([row("PAYEE"), row("EN_PISTE"), row("TERMINEE")])), null);
  assert.equal(badgeLabel(0), null);
});

test("what has left the operator's hands is not counted", () => {
  for (const status of ["PAYEE", "EN_PISTE", "TERMINEE", "ABSENT", "ANNULEE"]) {
    assert.equal(waitingCount([row(status)]), 0, `${status} must not count`);
  }
});

test("the badge agrees with the Liste d'attente's own filter", () => {
  // file-attente-view.tsx: r.status === "EN_ATTENTE" || r.status === "AU_GUICHET"
  const queue = [row("EN_ATTENTE"), row("PAYEE"), row("AU_GUICHET"), row("ANNULEE"), row("EN_ATTENTE")];
  const pageWouldShow = queue.filter((r) => r.status === "EN_ATTENTE" || r.status === "AU_GUICHET").length;
  assert.equal(waitingCount(queue), pageWouldShow);
  assert.equal(waitingCount(queue), 3);
});

test("a big queue stays inside the pill", () => {
  const many = (n) => Array.from({ length: n }, () => row("EN_ATTENTE"));
  assert.equal(badgeLabel(waitingCount(many(9))), "9");
  assert.equal(badgeLabel(waitingCount(many(99))), "99");
  assert.equal(badgeLabel(waitingCount(many(100))), "99+");
});

test("the desk being offline or still loading shows nothing rather than lying", () => {
  assert.equal(waitingCount(null), 0);
  assert.equal(waitingCount(undefined), 0);
  assert.equal(badgeLabel(waitingCount(undefined)), null);
});

test("malformed rows cannot crash the sidebar", () => {
  assert.equal(waitingCount([null, undefined, {}, { status: 7 }, row("EN_ATTENTE")]), 1);
  assert.equal(waitingPilots([{ status: "EN_ATTENTE" }, { status: "EN_ATTENTE", pilots: null }]), 0);
});

test("the tooltip counts pilots, not just groups", () => {
  const queue = [row("EN_ATTENTE", 4), row("AU_GUICHET", 3), row("PAYEE", 9)];
  assert.equal(waitingCount(queue), 2);
  assert.equal(waitingPilots(queue), 7, "the paid group's pilots must not be counted");
  assert.equal(badgeTitle(2, 7), "2 groupes en attente · 7 pilotes");
});

test("one group, one pilot reads in the singular", () => {
  assert.equal(badgeTitle(1, 1), "1 groupe en attente · 1 pilote");
  assert.equal(badgeTitle(0, 0), "Personne en attente");
});
