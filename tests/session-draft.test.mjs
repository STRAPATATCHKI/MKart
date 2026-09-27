// The race being prepared on Sessions, run against the real lib/session-draft.ts: pilots sent
// from Liste d'attente fill the empty rows with their karts, never twice the same person.
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => { await vite.close(); });
const D = await vite.ssrLoadModule("/lib/session-draft.ts");
const Q = await vite.ssrLoadModule("/lib/session-queue.ts");

test("a paid group fills the empty rows first, with the karts given at the counter", () => {
  const rows = [{ name: "Sami Haddoun", kart: "3", transponder: "" }, { name: "", kart: "", transponder: "" }];
  const { rows: next, added, already } = D.mergePilots(rows, [{ name: "Omar Astioui", kart: 12 }, { name: "Bakkali Hassan", kart: null }]);
  assert.deepEqual(next.map((r) => [r.name, r.kart]), [["Sami Haddoun", "3"], ["Omar Astioui", "12"], ["Bakkali Hassan", ""]]);
  assert.deepEqual([added, already], [["Omar Astioui", "Bakkali Hassan"], []]);
});

test("sent twice, or already typed by hand: nobody is added twice", () => {
  const rows = [{ name: "OMAR  ASTIOUI", kart: "", transponder: "" }];
  const { rows: next, added, already } = D.mergePilots(rows, [{ name: "Omar Astioui" }, { name: "Asmaé El Khelifi" }]);
  assert.equal(next.length, 2);
  assert.deepEqual([added, already], [["Asmaé El Khelifi"], ["Omar Astioui"]]);
  assert.equal(D.allInDraft({ ...D.emptyDraft(), rows: next }, ["omar astioui", "Asmae el khelifi"]), true, "case and accents do not matter");
  assert.equal(D.allInDraft({ ...D.emptyDraft(), rows: next }, ["Omar Astioui", "Someone Else"]), false);
});

test("the form survives in the browser, and a broken copy falls back to a clean one", () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  globalThis.window = { dispatchEvent: () => true };
  try {
    D.saveDraft({ name: "SESSION 7", type: "practice", durationMin: 8, rows: [{ name: "Luna", kart: "4", transponder: "" }], gridManual: true });
    assert.equal(D.loadDraft().name, "SESSION 7");
    const d = D.loadDraft();
    D.saveDraft({ ...d, rows: D.mergePilots(d.rows, [{ name: "Hamza Bennani", kart: 7 }]).rows });
    assert.deepEqual(D.loadDraft().rows.map((r) => [r.name, r.kart]), [["Luna", "4"], ["Hamza Bennani", "7"]]);
    store.set(D.DRAFT_KEY, "{not json");
    assert.equal(D.loadDraft(), null);
  } finally {
    delete globalThis.localStorage;
    delete globalThis.window;
  }
});

test("the session name follows the day's numbering, whatever way it was typed", () => {
  assert.equal(D.nextSessionName(["SESSION 1", "Session 9", "SESSION14", "SESSON 23", "session 6"]), "SESSION 24");
  assert.equal(D.nextSessionName(["SESSION TEST", null, "Course enfants"]), "SESSION 1", "no numbered session yet");
  assert.equal(D.nextSessionName([]), "SESSION 1");
});

test("a group sent twice from Liste d'attente is refreshed, not doubled; « Ajouter » takes it out", () => {
  const g = (code, kart) => ({ code, clientCode: null, contactName: "A", pilots: [{ name: "A B", kart }], pack: null, sentAt: 1 });
  let list = Q.withGroup([], g("MK-1", null));
  list = Q.withGroup(list, g("MK-2", null));
  list = Q.withGroup(list, g("MK-1", 12));
  assert.deepEqual(list.map((x) => [x.code, x.pilots[0].kart]), [["MK-1", 12], ["MK-2", null]], "newest first, karts updated");
  assert.deepEqual(Q.withoutGroup(list, "MK-1").map((x) => x.code), ["MK-2"]);
});
