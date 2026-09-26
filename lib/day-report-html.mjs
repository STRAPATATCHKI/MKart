// The Rapport du jour as a printable page (A4): what to check first - the races no payment
// covers - then every payment of the day against the races its pilots did, then each race with
// its pilots, laps and times. Plain JavaScript: the dashboard opens it in a print window
// (components/reports/day-report-html.ts), the MegaKart API serves it to the manager's app
// (GET /v1/reports/day.html). Times are always the venue's, whatever the server's clock.

import { VENUE_TZ } from "./day-report-rules.mjs";

/** mm:ss.mmm past the minute, plain seconds under it - the format of every timing screen. */
export function fmtLap(ms) {
  if (ms == null) return "—";
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  return m ? `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

/** "samedi 26 septembre 2026" from "2026-09-26". */
export function dayLabel(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Always the venue's clock: on Render the server's own clock is UTC.
const hhmm = (ms) => (ms == null ? "—" : new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: VENUE_TZ }));
const dh = (n) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} DH`);

export const COVERAGE_FR = {
  paid: { label: "Payé", mark: "✓" },
  extra: { label: "Course en plus (non payée)", mark: "✗" },
  booked: { label: "Réservé, pas encaissé", mark: "✗" },
  check: { label: "À vérifier", mark: "?" },
  none: { label: "Aucun paiement", mark: "✗" },
};

function coverageCell(e) {
  const c = COVERAGE_FR[e.coverage];
  const detail = e.reservation ? ` · ${esc(e.reservation)}` : e.suggestions.length ? `<small>proche : ${e.suggestions.map(esc).join(" / ")}</small>` : "";
  return `<td class="cov is-${e.coverage}"><b>${c.mark}</b> ${esc(c.label)}${detail}</td>`;
}

/** The report as one self-contained HTML page (A4); `opts.logoUrl` may be a data: URL. */
export function dayReportHtml(report, opts = {}) {
  const t = report.totals;
  const date = dayLabel(report.day);
  const problems = t.extra + t.booked + t.check + t.none;

  const tiles = [
    ["Courses", String(t.races), t.tests ? `+ ${t.tests} test${t.tests > 1 ? "s" : ""}` : ""],
    ["Passages en piste", String(t.driverRaces), `${t.pilots} pilote${t.pilots > 1 ? "s" : ""}`],
    ["Couverts par un paiement", String(t.covered), t.driverRaces ? `${Math.round((t.covered / t.driverRaces) * 100)} %` : ""],
    ["Sans paiement", String(problems), t.missingDh != null && problems ? `≈ ${dh(t.missingDh)} au tarif de ${dh(t.racePrice)}` : ""],
    ["Payés sous le tarif", String(t.underpaid), t.underpaid ? `− ${dh(t.underpaidDh)} sur leur formule` : "aucun"],
    ["Encaissé ce jour", dh(t.revenue), `${report.payments.filter((p) => p.paidAt != null).length} paiement(s)`],
  ];

  const uncovered = report.uncovered.length === 0
    ? `<p class="ok">Chaque passage en piste de la journée est couvert par un paiement.</p>`
    : `<table class="grid">
        <thead><tr><th>Heure</th><th>Course</th><th>Pilote</th><th>Kart</th><th>Tours</th><th>Meilleur</th><th>Paiement</th></tr></thead>
        <tbody>${report.uncovered.map((e) => `<tr>
          <td>${hhmm(e.at)}</td><td>${esc(e.raceName)}</td><td><b>${esc(e.driver)}</b></td><td>${esc(e.kart ?? "—")}</td>
          <td>${e.laps}</td><td class="num">${esc(fmtLap(e.bestLapMs))}</td>${coverageCell(e)}</tr>`).join("")}</tbody>
      </table>`;

  const payments = report.payments.length === 0
    ? `<p class="note">Aucun paiement enregistré ce jour.</p>`
    : `<table class="grid">
        <thead><tr><th>Code</th><th>Encaissé</th><th>Montant</th><th>Formule · courses par pilote</th><th>Pilotes · courses faites</th><th>Bilan</th></tr></thead>
        <tbody>${report.payments.map((p) => {
          const allowed = p.perPilot == null ? "?" : Number.isFinite(p.perPilot) ? String(p.perPilot) : "abonnement";
          const short = p.amount != null && p.packPrice != null && p.amount < p.packPrice;
          const verdict = [
            p.racesDone === 0 ? `<b>Aucune course</b>`
              : p.racesExtra > 0 ? `<b class="bad">${p.racesExtra} course${p.racesExtra > 1 ? "s" : ""} en plus</b>`
              : `✓ ${p.racesCovered} couverte${p.racesCovered > 1 ? "s" : ""}`,
            short ? `<b class="bad">payé ${dh(p.amount)} au lieu de ${dh(p.packPrice)}</b>` : "",
          ].filter(Boolean).join("<br>");
          return `<tr${p.racesExtra > 0 || short ? ' class="row-bad"' : ""}>
            <td><b>${esc(p.clientCode ?? p.code)}</b>${p.clientCode ? `<small>${esc(p.code)}</small>` : ""}</td>
            <td>${hhmm(p.paidAt)}<small>${esc(p.method)}</small></td>
            <td class="num">${dh(p.amount)}${short ? `<small class="bad">tarif ${dh(p.packPrice)}</small>` : ""}</td>
            <td>${esc(p.pack ?? "—")}<small>${allowed} · ${esc(p.allowanceFrom)}</small></td>
            <td>${p.pilots.map((x) => `${esc(x.name)} <b>×${x.races}</b>`).join("<br>")}</td>
            <td>${verdict}</td></tr>`;
        }).join("")}</tbody>
      </table>`;

  const races = report.races.map((race) => `
    <section class="race${race.test ? " is-test" : ""}">
      <h3>${esc(race.name)}${race.test ? " · TEST" : ""} <small>${esc(race.raceId)} · ${hhmm(race.startedAt)} → ${hhmm(race.finishedAt)} · ${race.entries.length} pilote${race.entries.length > 1 ? "s" : ""}</small></h3>
      <table class="grid">
        <thead><tr><th>Pos</th><th>Pilote</th><th>Kart</th><th>Tours</th><th>Meilleur</th><th>Moyenne</th><th>${race.test ? "" : "Paiement"}</th></tr></thead>
        <tbody>${race.entries.map((e) => {
          const avg = e.lapTimesMs.length ? Math.round(e.lapTimesMs.reduce((a, b) => a + b, 0) / e.lapTimesMs.length) : null;
          const laps = e.lapTimesMs.length
            ? `<tr class="laps"><td></td><td colspan="6">${e.lapTimesMs.map((l, i) => `<span${l === e.bestLapMs ? ' class="best"' : ""}>T${i + 1} ${esc(fmtLap(l))}</span>`).join("")}</td></tr>` : "";
          return `<tr><td>${e.position ?? "—"}</td><td><b>${esc(e.driver)}</b></td><td>${esc(e.kart ?? "—")}</td><td>${e.laps}</td>
            <td class="num"><b>${esc(fmtLap(e.bestLapMs))}</b></td><td class="num">${esc(fmtLap(avg))}</td>
            ${race.test ? "<td></td>" : coverageCell(e)}</tr>${laps}`;
        }).join("")}</tbody>
      </table>
    </section>`).join("");

  const generated = (opts.generatedAt ?? new Date()).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: VENUE_TZ });

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>MegaKart - Rapport des courses - ${esc(report.day)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111; background: #fff; font: 11px/1.4 "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  header { display: flex; align-items: center; gap: 12px; padding-bottom: 8px; border-bottom: 2px solid #111; }
  header img { height: 40px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 2px 0 0; color: #444; text-transform: capitalize; }
  header .gen { margin-left: auto; text-align: right; color: #666; font-size: 10px; text-transform: none; }
  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); margin: 12px 0; border: 1.5px solid #111; }
  .tiles div { padding: 7px 9px; border-right: 1px solid #111; }
  .tiles div:last-child { border-right: 0; }
  .tiles span { display: block; font-size: 8.5px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #444; }
  .tiles strong { display: block; margin-top: 2px; font-size: 18px; }
  .tiles small { display: block; color: #555; font-size: 9px; }
  h2 { margin: 18px 0 6px; font-size: 14px; padding-bottom: 3px; border-bottom: 1px solid #111; }
  h2 small { font-weight: 400; color: #555; font-size: 10px; }
  .grid { width: 100%; border-collapse: collapse; }
  .grid th { text-align: left; font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; color: #444; border-bottom: 1px solid #111; padding: 3px 4px; }
  .grid td { padding: 3px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .grid td small { display: block; color: #555; font-size: 9px; }
  .num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cov b { display: inline-block; width: 12px; }
  .cov.is-paid { color: #1a6b35; }
  .cov.is-extra, .cov.is-none, .cov.is-booked, .bad { color: #b3261e; font-weight: 700; }
  .cov.is-check { color: #8a5a00; font-weight: 700; }
  .row-bad td { background: #fdecea; }
  tr.laps td { padding-top: 0; border-bottom: 1px solid #bbb; }
  tr.laps span { display: inline-block; margin: 0 9px 1px 0; font: 9px/1.3 Consolas, "Courier New", monospace; color: #333; }
  tr.laps span.best { font-weight: 700; color: #000; text-decoration: underline; }
  .race { margin-top: 10px; break-inside: avoid; page-break-inside: avoid; }
  .race h3 { margin: 0 0 3px; font-size: 12.5px; }
  .race h3 small { font-weight: 400; color: #555; font-size: 9.5px; }
  .race.is-test { opacity: .6; }
  .ok { padding: 8px 10px; border: 1px solid #1a6b35; color: #1a6b35; font-weight: 700; }
  .note { color: #555; }
  .explain { margin: 4px 0 0; color: #444; font-size: 9.5px; }
  .toolbar { position: sticky; top: 0; padding: 8px; background: #f3f3f3; border-bottom: 1px solid #ccc; text-align: center; font-size: 12px; }
  .toolbar button { margin-left: 8px; padding: 6px 12px; font: inherit; font-weight: 700; cursor: pointer; }
  @media print { .toolbar { display: none; } .page { padding: 0; } }
</style></head><body>
<div class="toolbar">Pour le PDF : Imprimer → « Enregistrer au format PDF ».<button onclick="window.print()">Imprimer / PDF</button></div>
<div class="page">
  <header>
    ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="">` : ""}
    <div><h1>Rapport des courses</h1><p>MegaKart Fès · ${esc(date)}</p></div>
    <p class="gen">Généré le ${esc(generated)}<br>Courses : MegaKart Timing Control · Paiements : caisse</p>
  </header>

  <div class="tiles">${tiles.map(([k, v, s]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong><small>${esc(s)}</small></div>`).join("")}</div>

  <h2>À vérifier : passages en piste sans paiement <small>${report.uncovered.length} sur ${t.driverRaces}</small></h2>
  ${uncovered}
  <p class="explain">« Course en plus » : le pilote a payé, mais moins de courses qu’il n’en a fait. « Réservé, pas encaissé » : réservation du jour jamais encaissée.
  « À vérifier » : prénom seul ou nom proche d’un client payé — à contrôler à la main. Les courses de test ne sont pas comptées.
  Les noms sont rapprochés sans tenir compte des accents ni de petites fautes de frappe ; les forfaits achetés un autre jour ne sont pas pris en compte.</p>

  <h2>Paiements du jour et courses faites <small>${report.payments.length} paiement(s)${t.underpaid ? ` · ${t.underpaid} sous le tarif de leur formule` : ""}</small></h2>
  ${payments}

  <h2>Détail des courses <small>${report.races.length} course(s), dans l’ordre de la journée · classement au meilleur tour</small></h2>
  ${races || `<p class="note">Aucune course enregistrée ce jour.</p>`}
</div>
</body></html>`;
}
