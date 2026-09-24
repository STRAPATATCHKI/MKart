// The sidebar's system card, run against the real lib/system-status.ts: when it offers
// Synchroniser, and what it says when the page cannot synchronise at all.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/system-status.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const S = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const system = (over = {}) => ({
  startedAt: 1_000, codeUpdatedAt: 900, stale: false, bridgeCodeUpdatedAt: 900, bundleBuiltAt: 500,
  launchers: { desk: true, bridge: true }, ...over,
});
const ok = (over) => ({ kind: "ok", system: system(over) });
const bridge = (over = {}) => ({ ok: true, startedAt: 1_000, codeUpdatedAt: 900, stale: false, ...over });

test("all current: operational, and the button stays available", () => {
  const s = S.summarize(ok(), bridge(), true, 500);
  assert.equal(s.tone, "ok");
  assert.equal(s.title, "Systèmes opérationnels");
  assert.deepEqual(s.pending, []);
  assert.equal(s.canSync, true);
});

test("desk code newer than the desk: an update is waiting", () => {
  const s = S.summarize(ok({ stale: true }), bridge(), true, 500);
  assert.equal(s.tone, "update");
  assert.deepEqual(s.pending, ["accueil"]);
});

test("a bridge that does not report its start predates the card and needs the restart too", () => {
  const s = S.summarize(ok(), { ok: true }, true, 500);
  assert.deepEqual(s.pending, ["inscriptions"]);
});

test("a rebuilt dashboard bundle marks the open page as stale", () => {
  const s = S.summarize(ok({ bundleBuiltAt: 800 }), bridge(), true, 500);
  assert.deepEqual(s.pending, ["dashboard"]);
});

test("bridge down: a warning, and Synchroniser can bring it back", () => {
  const s = S.summarize(ok(), null, true, 500);
  assert.equal(s.tone, "warn");
  assert.equal(s.canSync, true);
  assert.equal(s.rows.find((r) => r.label === "Inscriptions").up, false);
});

test("opened through the Wi-Fi address: no button, and it says where to go", () => {
  const s = S.summarize({ kind: "wifi" }, bridge(), true, null);
  assert.equal(s.canSync, false);
  assert.match(s.detail, /127\.0\.0\.1:5190/);
});

test("a desk from before the card: no button, restart it once by hand", () => {
  const s = S.summarize({ kind: "old" }, bridge(), true, null);
  assert.equal(s.canSync, false);
  assert.match(s.detail, /restart-desk\.bat/);
});

test("the online copy of the dashboard never offers to restart the venue", () => {
  const s = S.summarize({ kind: "hosted" }, null, false, null);
  assert.equal(s.canSync, false);
  assert.equal(S.isVenueHost("mega-karts.web.app"), false);
  assert.equal(S.isVenueHost("192.168.100.44"), true);
  assert.equal(S.isVenueHost("127.0.0.1"), true);
  assert.equal(S.isLoopbackHost("192.168.100.44"), false);
});

test("a missing launcher removes the button rather than failing later", () => {
  const s = S.summarize(ok({ launchers: { desk: true, bridge: false } }), bridge(), true, 500);
  assert.equal(s.canSync, false);
});
