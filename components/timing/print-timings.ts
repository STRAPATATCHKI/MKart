// A driver's timings on paper, for the client to take home: black and white only (any office or
// receipt printer, no ink wasted on colour), one page per driver. The lap list flows into as many
// columns as the paper allows - three or four on A4, one on an 80 mm receipt roll.
//
// The sheet is built as a plain HTML string here, so its content can be checked without a
// browser (tests/print-timings.test.mjs); printTimings() only opens it and asks to print.

import { fmtLap, hasLapList, lapRows } from "@/components/timing/lap-rows";
import type { TimingSavedRace, TimingSavedRacer } from "@/lib/timing-client";

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const ordinal = (n: number) => (n === 1 ? "1er" : `${n}e`);

function when(race: TimingSavedRace): string {
  const s = race.finishedAt ?? race.startedAt ?? race.savedAt;
  if (s == null) return "";
  return new Date(s * 1000).toLocaleString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export type SheetOptions = {
  /** The venue's lap record, printed as the time to chase. */
  record?: { lapMs: number; driver: string | null } | null;
  /** Where the MegaKart logo is served (the dashboard's own file). */
  logoUrl?: string;
};

function sheet(race: TimingSavedRace, d: TimingSavedRacer, field: number, raceBest: { driver: string; ms: number } | null, opts: SheetOptions): string {
  const laps = lapRows(d);
  const best = laps.find((l) => l.best) ?? null;
  const avg = laps.length ? laps.reduce((sum, l) => sum + l.ms, 0) / laps.length : null;
  const title = race.name?.trim() || race.raceId;
  const isRaceBest = raceBest != null && d.bestLapMs != null && d.bestLapMs === raceBest.ms;
  const gap = raceBest && d.bestLapMs != null && !isRaceBest ? d.bestLapMs - raceBest.ms : null;

  const stats = [
    ["Classement", d.position != null ? `${ordinal(d.position)}<small> / ${field}</small>` : "—"],
    ["Meilleur tour", `${esc(fmtLap(d.bestLapMs))}${best ? `<small> tour ${best.lap}</small>` : ""}`],
    ["Tours", String(d.laps ?? 0)],
    ["Moyenne", avg != null ? esc(fmtLap(Math.round(avg))) : "—"],
    ["Kart", d.kart != null ? String(d.kart) : "—"],
  ];

  const lapList = !hasLapList(d)
    ? `<p class="note">Détail des tours non enregistré pour cette course.</p>`
    : laps.length === 0
      ? `<p class="note">Aucun tour chronométré.</p>`
      : `<ol class="laps">${laps.map((l) =>
          `<li class="${l.best ? "best" : ""}"><span>T${l.lap}</span><b>${esc(fmtLap(l.ms))}</b><em>${l.best ? "★ meilleur" : esc(l.delta ?? "")}</em></li>`).join("")}</ol>`;

  const context = [
    isRaceBest ? `<p><b>Meilleur tour de la course.</b></p>`
      : raceBest && gap != null ? `<p>Meilleur tour de la course : <b>${esc(fmtLap(raceBest.ms))}</b> par ${esc(raceBest.driver)} · écart <b>+${(gap / 1000).toFixed(3)}</b></p>` : "",
    opts.record ? `<p>Record de la piste : <b>${esc(fmtLap(opts.record.lapMs))}</b>${opts.record.driver ? ` par ${esc(opts.record.driver)}` : ""}${
      d.bestLapMs != null && d.bestLapMs > opts.record.lapMs ? ` · encore <b>${((d.bestLapMs - opts.record.lapMs) / 1000).toFixed(3)} s</b> à gagner` : ""}</p>` : "",
  ].join("");

  return `<section class="sheet">
    <header>
      ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="">` : ""}
      <div><strong>MEGAKART FÈS</strong><span>${esc(title)} · ${esc(when(race))}</span></div>
    </header>
    <h1>${esc(d.driver)}</h1>
    <dl class="stats">${stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>
    ${lapList}
    <div class="context">${context}</div>
    <footer>Merci et à bientôt sur la piste · megakart.ma</footer>
  </section>`;
}

/** The printable page for these drivers of one race (every driver when none are given). */
export function timingSheetsHtml(race: TimingSavedRace, drivers: TimingSavedRacer[], opts: SheetOptions = {}): string {
  const field = race.racers.length;
  let raceBest: { driver: string; ms: number } | null = null;
  for (const r of race.racers) {
    if (typeof r.bestLapMs === "number" && Number.isFinite(r.bestLapMs) && (!raceBest || r.bestLapMs < raceBest.ms)) {
      raceBest = { driver: r.driver, ms: r.bestLapMs };
    }
  }
  const title = drivers.length === 1 ? `Temps · ${drivers[0].driver}` : `Temps · ${race.name?.trim() || race.raceId}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 10mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { padding: 4mm 0; }
  .sheet + .sheet { break-before: page; page-break-before: always; }
  header { display: flex; align-items: center; gap: 10px; padding-bottom: 6px; border-bottom: 2px solid #000; }
  header img { height: 34px; filter: grayscale(1) contrast(1.4); }
  header strong { display: block; font-size: 11px; letter-spacing: .18em; }
  header span { display: block; margin-top: 2px; font-size: 11px; text-transform: capitalize; }
  h1 { margin: 10px 0 8px; font-size: 24px; line-height: 1.1; text-transform: uppercase; overflow-wrap: anywhere; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(28mm, 1fr)); gap: 0; margin: 0 0 10px; border: 1.5px solid #000; }
  .stats div { padding: 5px 7px; border-right: 1px solid #000; }
  .stats div:last-child { border-right: 0; }
  dt { font-size: 9px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  dd { margin: 2px 0 0; font-size: 18px; font-weight: 800; font-variant-numeric: tabular-nums; }
  dd small { font-size: 10px; font-weight: 600; }
  .laps { margin: 0; padding: 0; list-style: none; column-width: 44mm; column-gap: 6mm; column-rule: 1px solid #000; }
  .laps li { display: grid; grid-template-columns: 9mm 1fr auto; gap: 4px; align-items: baseline; padding: 2px 3px;
    border-bottom: 1px dotted #000; break-inside: avoid; font-variant-numeric: tabular-nums; }
  .laps span { font-size: 10px; }
  .laps b { font-size: 13px; }
  .laps em { font-style: normal; font-size: 10px; text-align: right; }
  .laps li.best { border: 2px solid #000; font-weight: 800; }
  .laps li.best em { font-weight: 800; }
  .note { margin: 6px 0; font-style: italic; }
  .context { margin-top: 10px; }
  .context p { margin: 3px 0; }
  footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #000; font-size: 10px; text-align: center; }
</style></head><body>
${drivers.map((d) => sheet(race, d, field, raceBest, opts)).join("\n")}
</body></html>`;
}

/** Opens the sheets in a small window and asks to print them. False when the browser blocked it. */
export function printTimings(race: TimingSavedRace, drivers: TimingSavedRacer[], opts: SheetOptions = {}): boolean {
  const win = window.open("", "megakart-temps", "width=820,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(timingSheetsHtml(race, drivers, { logoUrl: `${window.location.origin}/megakart-loader-logo.png`, ...opts }));
  win.document.close();
  win.focus();
  // Wait for the logo, so it is on the paper; print anyway if it never loads.
  const go = () => { try { win.print(); } catch { /* window closed meanwhile */ } };
  const img = win.document.querySelector("img");
  if (img && !img.complete) {
    img.addEventListener("load", go, { once: true });
    img.addEventListener("error", go, { once: true });
  } else {
    window.setTimeout(go, 300);
  }
  return true;
}
