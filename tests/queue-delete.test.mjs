// Quick delete on the Liste d'attente, run against the real lib/queue-delete.ts: which
// reservation a typed code means, and when five D presses count as five.
import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";

const src = readFileSync(new URL("../lib/queue-delete.ts", import.meta.url), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const D = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

const res = (code, status = "EN_ATTENTE") => ({ code, status });
const list = [res("MK-6149"), res("MK-1165"), res("MK-2500", "SUPPRIMEE")];
const clientCodes = new Map([["MK-1165", "AZSM"]]);
const clientCodeOf = (code) => clientCodes.get(code);

test("several codes can be typed at once, in any case and separated any way", () => {
  assert.deepEqual(D.codesFrom(" mk-6149, 1165;azsm  "), ["MK-6149", "1165", "AZSM"]);
  assert.deepEqual(D.codesFrom("   "), []);
});

test("the desk code is found written in full, without the dash, or as its four digits", () => {
  for (const t of ["MK-6149", "mk6149", "6149"]) assert.equal(D.findByCode(list, clientCodeOf, t)?.code, "MK-6149", t);
});

test("the code the phone showed the client finds its reservation", () => {
  assert.equal(D.findByCode(list, clientCodeOf, "azsm")?.code, "MK-1165");
});

test("an already deleted reservation, or an unknown code, is not matched", () => {
  assert.equal(D.findByCode(list, clientCodeOf, "2500"), null);
  assert.equal(D.findByCode(list, clientCodeOf, "9999"), null);
});

test("five quick presses on the same row count to five; a pause or another row starts again", () => {
  let s = null;
  for (let i = 0; i < 5; i++) s = D.nextPress(s, "MK-6149", 1000 + i * 300);
  assert.equal(s.count, 5);
  assert.equal(D.nextPress({ code: "MK-6149", count: 4, at: 0 }, "MK-6149", D.PRESS_WINDOW_MS + 1).count, 1, "too slow");
  assert.equal(D.nextPress({ code: "MK-6149", count: 4, at: 0 }, "MK-1165", 100).count, 1, "another row");
  assert.equal(D.DELETE_PRESSES, 5);
});
