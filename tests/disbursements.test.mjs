// Décaissements, run against the real lib/disbursement-rules.mjs shared by the desk, the bridge
// and the MegaKart API: what a request must say, the only moves allowed, and a history that
// records every one of them.
import assert from "node:assert/strict";
import test from "node:test";
import * as D from "../lib/disbursement-rules.mjs";

const T0 = "2026-09-27T14:00:00.000Z";
const T1 = "2026-09-27T14:03:10.000Z";
const T2 = "2026-09-27T15:20:00.000Z";
const good = { amount: "350,5", category: "carburant", description: "20 L d'essence pour les karts GT", beneficiary: "Station Afriquia", method: "especes", reference: "F-1182", requestedBy: "YB" };
const make = () => D.create(D.checkNew(good).value, { id: "DC-X1", code: "DC-0001", at: T0 });

test("a request must say how much, what for, to whom and who asks", () => {
  assert.equal(D.checkNew(good).value.amount, 350.5, "a comma works as the decimal point");
  assert.match(D.checkNew({ ...good, amount: "0" }).error, /montant/);
  assert.match(D.checkNew({ ...good, category: "vacances" }).error, /motif/);
  assert.match(D.checkNew({ ...good, description: "ok" }).error, /Décrivez/);
  assert.match(D.checkNew({ ...good, beneficiary: "" }).error, /qui l’argent/);
  assert.match(D.checkNew({ ...good, requestedBy: "" }).error, /qui fait la demande/);
  assert.equal(D.checkNew({ ...good, method: "virement" }).value.method, "especes", "every décaissement is cash from the till");
});

test("codes follow on and are never reused", () => {
  assert.equal(D.nextCode([]), "DC-0001");
  assert.equal(D.nextCode([{ code: "DC-0001" }, { code: "DC-0009" }, { code: "DC-0003" }]), "DC-0010");
});

test("created → approved in the app → money handed out, every step in the history", () => {
  const created = make();
  assert.equal(created.status, "EN_ATTENTE");
  assert.match(D.payOut(created, { by: "YB", at: T1 }).error, /validation/, "nothing is handed out before the app approves");
  const approved = D.decide(created, { decision: "approve", by: "Karim (gérant)", comment: null }, { at: T1, via: "application" }).value;
  assert.equal(approved.status, "APPROUVE");
  assert.deepEqual([approved.decision.by, approved.decision.at], ["Karim (gérant)", T1]);
  const paid = D.payOut(approved, { by: "YB", at: T2 }).value;
  assert.equal(paid.status, "DECAISSE");
  assert.deepEqual(paid.history.map((h) => [h.event, h.by, h.via]), [
    ["cree", "YB", "accueil"], ["approuve", "Karim (gérant)", "application"], ["decaisse", "YB", "accueil"],
  ]);
  assert.equal(D.decide(paid, { decision: "refuse", by: "X Y", comment: "trop tard" }, { at: T2 }).status, 409, "a decision cannot be changed");
});

test("refused with its reason; cancelled only while waiting", () => {
  const refused = D.decide(make(), { decision: "refuse", by: "Karim", comment: "Pas de facture" }, { at: T1 }).value;
  assert.equal(refused.status, "REFUSE");
  assert.equal(refused.history.at(-1).note, "Pas de facture");
  assert.equal(D.payOut(refused, { by: "YB", at: T2 }).status, 409);
  assert.equal(D.cancel(refused, { by: "YB", at: T2 }).status, 409);
  const cancelled = D.cancel(make(), { by: "YB", reason: "erreur de montant", at: T1 }).value;
  assert.deepEqual([cancelled.status, cancelled.history.at(-1).event, cancelled.history.at(-1).note], ["ANNULE", "annule", "erreur de montant"]);
});

test("the app's decision: approve or refuse, who decides, and why when refusing", () => {
  assert.deepEqual(D.checkDecision({ decision: "APPROVE", by: "Karim" }).value, { decision: "approve", by: "Karim", comment: null });
  assert.equal(D.checkDecision({ decision: "refuser", by: "Karim", comment: "Budget dépassé" }).value.decision, "refuse");
  assert.match(D.checkDecision({ decision: "refuse", by: "Karim" }).error, /pourquoi/, "a refusal says why");
  assert.match(D.checkDecision({ decision: "maybe", by: "Karim" }).error, /approve/);
  assert.match(D.checkDecision({ decision: "approve" }).error, /by/);
});

test("what the app reads: times in ms, labels in French, the whole history", () => {
  const approved = D.decide(make(), { decision: "approve", by: "Karim", comment: "OK" }, { at: T1, via: "application" }).value;
  const doc = D.reportDoc(approved);
  assert.equal(doc.createdAt, Date.parse(T0));
  assert.equal(doc.decision.at, Date.parse(T1));
  assert.deepEqual([doc.statusLabel, doc.categoryLabel, doc.methodLabel], ["Approuvé", "Carburant", "Espèces (sortie de caisse)"]);
  assert.deepEqual(doc.history.map((h) => h.label), ["Demande créée", "Approuvé"]);
  assert.match(doc.day, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(D.totals([approved, make()]), { pending: 1, pendingDh: 350.5, approvedDh: 350.5, paidOutDh: 0 });
});

test("photos: images only, 4 MB and 5 per request at most, each addition in the history", () => {
  const png = "data:image/png;base64," + Buffer.from("fake-png-bytes").toString("base64");
  assert.equal(D.checkImage(png).value.type, "image/png");
  assert.equal(D.checkImage(png).value.size, 14);
  assert.match(D.checkImage("data:application/pdf;base64,AAAA").error, /JPEG, PNG ou WebP/);
  assert.match(D.checkImage("data:image/jpeg;base64," + "A".repeat(6 * 1024 * 1024)).error, /trop lourde/);
  const photo = (id) => ({ id, type: "image/jpeg", size: 1000, addedAt: T0 });
  const withTwo = D.create(D.checkNew(good).value, { id: "DC-X1", code: "DC-0001", at: T0, attachments: [photo("P1"), photo("P2")] });
  assert.equal(withTwo.history[0].note, "avec 2 photos");
  const receipt = D.withAttachments(withTwo, [photo("P3")], { by: "YB", at: T2 }).value;
  assert.deepEqual([receipt.attachments.length, receipt.history.at(-1).event, receipt.history.at(-1).note], [3, "piece", "1 photo"]);
  assert.match(D.withAttachments(receipt, [photo("P4"), photo("P5"), photo("P6")], { by: "YB", at: T2 }).error, /5 photos au plus/);
  assert.deepEqual(D.reportDoc(receipt).attachments.map((a) => a.path), [
    "/v1/disbursements/DC-X1/attachments/P1", "/v1/disbursements/DC-X1/attachments/P2", "/v1/disbursements/DC-X1/attachments/P3",
  ]);
});
