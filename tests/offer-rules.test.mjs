// Who is offered what on the sign-up form, and what the counter collects: the rules the phone,
// the bridge and the dashboard all share (lib/offer-rules.mjs), and the page that embeds them.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as R from "../lib/offer-rules.mjs";

const ids = (list) => list.map((o) => o.id);
const seed = R.SEED_OFFERS;
const byId = (id) => seed.find((o) => o.id === id);

test("one pilot sees the individual packs and the subscriptions, no group pack", () => {
  const f = R.offersFor(seed, 1);
  assert.deepEqual(ids(f.group), []);
  assert.deepEqual(ids(f.packs), ["bronze", "silver", "gold"]);
  assert.deepEqual(ids(f.subscriptions), ["starter", "pro", "vip"]);
  assert.equal(f.recommended, "bronze");
});

test("four pilots see Pack Famille and Pack Amis, and the snug one is preselected", () => {
  const f = R.offersFor(seed, 4);
  assert.deepEqual(ids(f.group), ["famille", "amis"]);
  assert.deepEqual(ids(f.subscriptions), [], "a subscription is personal, never offered to a group");
  assert.equal(f.recommended, "famille", "4 pilots fill Pack Famille exactly; Pack Amis would leave a seat empty");
});

test("five pilots get Pack Amis; three get Pack Famille; two and six pay per pilot", () => {
  assert.equal(R.offersFor(seed, 5).recommended, "amis");
  assert.equal(R.offersFor(seed, 3).recommended, "famille");
  assert.deepEqual(ids(R.offersFor(seed, 2).group), []);
  assert.equal(R.offersFor(seed, 2).recommended, "bronze");
  assert.deepEqual(ids(R.offersFor(seed, 6).group), []);
});

test("a group price is the price; a personal price is times the pilots", () => {
  assert.equal(R.offerTotal(byId("famille"), 4), 300);
  assert.equal(R.offerTotal(byId("famille"), 3), 300);
  assert.equal(R.offerTotal(byId("bronze"), 4), 1000);
  assert.equal(R.offerTotal(byId("pro"), 1), 850);
});

test("an offer switched off is never offered", () => {
  const off = seed.map((o) => (o.id === "famille" ? { ...o, enabled: false } : o));
  assert.deepEqual(ids(R.offersFor(off, 4).group), ["amis"]);
  assert.equal(R.offerFits({ ...byId("famille"), enabled: false }, 4), false);
});

test("a catalog saved before the minimum existed gets one seat of slack", () => {
  const legacy = { ...byId("famille"), minPeople: undefined };
  assert.deepEqual(R.groupRange(legacy), { min: 3, max: 4 });
  assert.deepEqual(R.groupRange({ basis: "groupe", people: 2 }), { min: 2, max: 2 });
  assert.equal(R.groupRange(byId("bronze")), null);
});

test("a weekly pass is a subscription too", () => {
  const weekly = { ...byId("starter"), id: "semaine", period: "semaine" };
  assert.deepEqual(ids(R.offersFor([weekly], 1).subscriptions), ["semaine"]);
  assert.equal(R.offerFits(weekly, 2), false);
});

test("a catalog with nothing for the group recommends nothing, rather than something wrong", () => {
  const f = R.offersFor([byId("starter")], 3);
  assert.equal(f.recommended, null);
  assert.equal(f.group.length + f.packs.length + f.subscriptions.length, 0);
});

test("the sign-up page embeds the same rules and its script parses", async () => {
  const { SIGNUP_PAGE } = await import("../tools/apex-bridge/signup-page.mjs");
  for (const fn of ["groupRange", "offerFits", "offerTotal", "offersFor"]) {
    assert.ok(SIGNUP_PAGE.includes(R[fn].toString()), `${fn} is embedded verbatim`);
  }
  const script = SIGNUP_PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script), "the page script compiles");
  const baked = JSON.parse(SIGNUP_PAGE.match(/var OFFERS = (\[.*?\]);\n/)[1]);
  assert.ok(baked.length > 0 && baked.every((o) => o.id && o.name), "offers are baked in");
  // The name check that once shipped without its backslashes.
  assert.ok(script.includes("/\\S+\\s+\\S/.test(payload.name)"));
});

test("simple session prices get their own list, for one pilot and for a group, priced per pilot", () => {
  const eight = { id: "s8", kind: "session", name: "Session 8 min", price: 100, basis: "personne", period: "unique", unit: "minutes", quantity: 8, enabled: true };
  const sixteen = { ...eight, id: "s16", name: "Session 16 min", price: 180, quantity: 16 };
  const withSessions = [...seed, eight, sixteen];
  const solo = R.offersFor(withSessions, 1);
  assert.deepEqual(ids(solo.sessions), ["s8", "s16"]);
  assert.ok(!ids(solo.packs).includes("s8"), "a session is not listed as a pack");
  assert.equal(solo.recommended, "bronze", "the first pack stays the suggestion");
  const four = R.offersFor(withSessions, 4);
  assert.deepEqual(ids(four.sessions), ["s8", "s16"]);
  assert.equal(R.offerTotal(sixteen, 4), 720);
  assert.equal(R.offersFor([eight], 1).recommended, "s8", "with nothing else on sale, the session is suggested");
});
