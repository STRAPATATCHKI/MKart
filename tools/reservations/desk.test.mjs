// End-to-end check of the desk server: a phone books, the caisse sees it, payment is
// validated, karts are assigned. Run with the server already listening on DESK_PORT.
//
//   node desk.test.mjs

const PORT = Number(process.env.DESK_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "  ok  " : "FAIL  "}${label}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const post = async (p, body, headers = {}) => {
  const r = await fetch(BASE + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const booking = (phone, name = "Youssef Amrani") => ({
  contactName: name,
  phone,
  email: "y.amrani@exemple.ma",
  paymentMethod: "Espèces",
  pilots: [
    { fullName: name, kartColor: "blue" },
    { fullName: "Rania Kettani", kartColor: "green" },
  ],
});

// ---------------------------------------------------------------- health
eq("service en ligne", (await get("/api/sante")).body?.ok, true);

// ---------------------------------------------------------------- validation
eq("nom incomplet refusé", (await post("/api/reservations", { ...booking("0612345678"), contactName: "Youssef" })).status, 400);
eq("téléphone invalide refusé", (await post("/api/reservations", booking("123"))).status, 400);
eq("e-mail invalide refusé", (await post("/api/reservations", { ...booking("0612345678"), email: "pas-un-email" })).status, 400);
eq("sans pilote refusé", (await post("/api/reservations", { ...booking("0612345678"), pilots: [] })).status, 400);

// ---------------------------------------------------------------- create
const created = await post("/api/reservations", booking("0612345678"));
eq("réservation créée", created.status, 200);
eq("code attribué", /^MK-\d{4}$/.test(created.body.code), true);
eq("statut initial", created.body.status, "EN_ATTENTE");
eq("2 pilotes", created.body.pilots.length, 2);
eq("téléphone normalisé", created.body.phone, "0612345678");
const code = created.body.code;

// phone formats all normalise to the same number -> caught as a duplicate
eq("doublon +212 détecté", (await post("/api/reservations", booking("+212612345678"))).status, 409);
eq("doublon 00212 détecté", (await post("/api/reservations", booking("00212 6 12 34 56 78"))).status, 409);

// ---------------------------------------------------------------- idempotency
const key = "test-key-" + Math.random().toString(36).slice(2);
const a = await post("/api/reservations", booking("0698765432", "Mehdi Rahali"), { "Idempotency-Key": key });
const b = await post("/api/reservations", booking("0698765432", "Mehdi Rahali"), { "Idempotency-Key": key });
eq("retry renvoie la même réservation", a.body.code, b.body.code);

// ---------------------------------------------------------------- public lookup is minimal
const pub = await get(`/api/reservations/${code}`);
eq("consultation publique OK", pub.status, 200);
eq("pas de fuite de données personnelles", pub.body.phone === undefined && pub.body.contactName === undefined, true);

// ---------------------------------------------------------------- the queue
const q = await get("/api/queue");
eq("file visible depuis ce PC", q.status, 200);
eq("contient nos réservations", q.body.reservations.length >= 2, true);

// ---------------------------------------------------------------- payment
const paid = await post(`/api/queue/${code}/paiement`, { mode: "Carte bancaire", par: "YB" });
eq("paiement validé", paid.body.status, "PAYEE");
eq("opérateur enregistré", paid.body.paidBy, "YB");
eq("mode corrigé à l'encaissement", paid.body.paymentMethod, "Carte bancaire");
eq("horodaté", typeof paid.body.paidAt === "string", true);

const undone = await post(`/api/queue/${code}/annuler-paiement`, {});
eq("annulation du paiement", undone.body.status, "EN_ATTENTE");
eq("horodatage effacé", undone.body.paidAt, null);

// ---------------------------------------------------------------- kart assignment
const res2 = (await get("/api/queue")).body.reservations.find((r) => r.code === code);
const karts = {};
res2.pilots.forEach((p, i) => { karts[p.id] = [3, 5][i]; });
const assigned = await post(`/api/queue/${code}/karts`, { karts, sessionId: "MK-TEST" });
eq("karts attribués", assigned.body.pilots.map((p) => p.kartNumber), [3, 5]);
eq("session liée", assigned.body.sessionId, "MK-TEST");

// ---------------------------------------------------------------- status moves
eq("passage au guichet", (await post(`/api/queue/${code}/statut`, { statut: "AU_GUICHET" })).body.status, "AU_GUICHET");
eq("absent", (await post(`/api/queue/${code}/statut`, { statut: "ABSENT" })).body.status, "ABSENT");
eq("réintégré dans la file", (await post(`/api/queue/${code}/statut`, { statut: "EN_ATTENTE" })).body.status, "EN_ATTENTE");
eq("statut inconnu refusé", (await post(`/api/queue/${code}/statut`, { statut: "N_IMPORTE_QUOI" })).status, 400);

// ---------------------------------------------------------------- walk-in
const walkin = await post("/api/reservations", {
  channel: "guichet",
  contactName: "Client Comptoir",
  phone: "",
  paymentMethod: "Espèces",
  pilots: [{ fullName: "Client Comptoir", kartColor: "black" }],
});
eq("client au guichet sans téléphone", walkin.status, 200);
eq("canal guichet", walkin.body.channel, "guichet");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
