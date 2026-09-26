// The Rapport du jour as a real PDF file, for the MegaKart API (GET /v1/reports/day.pdf) - so the
// manager's app downloads a document, not a web page. Written here with no library: A4 pages,
// the PDF's built-in Helvetica and Courier fonts (nothing to embed, nothing to install on the
// server), and the same sections as the printed page (lib/day-report-html.mjs): the summary, what
// to check, the payments against the races, then every race with its laps. Node only (zlib).

import { deflateSync } from "node:zlib";
import { COVERAGE_FR, dayLabel, fmtLap } from "./day-report-html.mjs";
import { VENUE_TZ } from "./day-report-rules.mjs";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 34;                    // page margin
const RIGHT = PAGE_W - M;
const BOTTOM = PAGE_H - M - 16;  // room for the footer

const BLACK = [0, 0, 0];
const GREY = [0.35, 0.35, 0.35];
const RED = [0.7, 0.15, 0.12];
const GREEN = [0.1, 0.42, 0.21];
const AMBER = [0.54, 0.35, 0];
const COVER_COLOR = { paid: GREEN, extra: RED, booked: RED, none: RED, check: AMBER };

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for ASCII 32-126, from the standard AFM.
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELVB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const FONT = { R: "F1", B: "F2", C: "F3" };

// ----------------------------------------------------------------------------- text encoding

/** Our text as WinAnsi (the built-in fonts' encoding): French accents kept, the rest spelled out. */
function winAnsi(s) {
  const text = String(s ?? "")
    .replace(/→/g, "->").replace(/≈/g, "~").replace(/[✓✔]/g, "").replace(/[✗✘]/g, "")
    .replace(/[   ]/g, " ").replace(/−/g, "-").replace(/★/g, "*");
  const SPECIAL = { "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "–": 0x96, "—": 0x97, "…": 0x85, "•": 0x95, "€": 0x80, "œ": 0x9c, "Œ": 0x8c };
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (SPECIAL[ch] != null) out += String.fromCharCode(SPECIAL[ch]);
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 0xa0 && code <= 0xff) out += ch;
    else if (code === 10 || code === 9) out += " ";
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base.length === 1 && base.codePointAt(0) < 127 ? base : "?";
    }
  }
  return out;
}

function charWidth(code, font) {
  if (font === "C") return 600;
  const table = font === "B" ? HELVB : HELV;
  if (code >= 32 && code <= 126) return table[code - 32];
  if (code === 0x92 || code === 0x91) return font === "B" ? 278 : 222;
  if (code === 0x97 || code === 0x85) return 1000;
  if (code === 0xb7 || code === 0xa0) return 278;
  // An accented letter is as wide as its letter.
  const base = String.fromCharCode(code).normalize("NFD")[0].charCodeAt(0);
  return base >= 32 && base <= 126 ? table[base - 32] : 556;
}

function width(enc, size, font) {
  let w = 0;
  for (let i = 0; i < enc.length; i++) w += charWidth(enc.charCodeAt(i), font);
  return (w / 1000) * size;
}

/** Cut to fit, with an ellipsis. */
function fit(enc, size, font, max) {
  if (width(enc, size, font) <= max) return enc;
  const dots = String.fromCharCode(0x85);
  let s = enc;
  while (s.length > 1 && width(s + dots, size, font) > max) s = s.slice(0, -1);
  return s + dots;
}

/** Split into lines that fit, on spaces. */
function wrap(enc, size, font, max) {
  const lines = [];
  let line = "";
  for (const word of enc.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (width(next, size, font) <= max || !line) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.map((l) => fit(l, size, font, max));
}

const pdfString = (enc) => {
  let s = "(";
  for (let i = 0; i < enc.length; i++) {
    const c = enc.charCodeAt(i);
    if (c === 40 || c === 41 || c === 92) s += "\\" + enc[i];
    else if (c < 32 || c > 126) s += "\\" + c.toString(8).padStart(3, "0");
    else s += enc[i];
  }
  return s + ")";
};

const n2 = (v) => (Math.round(v * 100) / 100).toString();

// ----------------------------------------------------------------------------- page drawing

class Pages {
  constructor() { this.pages = []; this.newPage(); }
  newPage() { this.ops = []; this.pages.push(this.ops); this.y = M; }
  /** Room for h points below the cursor, or a new page. */
  ensure(h) { if (this.y + h > BOTTOM) { this.newPage(); return true; } return false; }
  text(x, y, str, { font = "R", size = 9, color = BLACK, max = null, align = "left", encoded = false } = {}) {
    let enc = encoded ? str : winAnsi(str);
    if (max != null) enc = fit(enc, size, font, max);
    const w = width(enc, size, font);
    const tx = align === "right" ? x - w : x;
    this.ops.push(`${color.map(n2).join(" ")} rg BT /${FONT[font]} ${n2(size)} Tf 1 0 0 1 ${n2(tx)} ${n2(PAGE_H - y)} Tm ${pdfString(enc)} Tj ET`);
    return w;
  }
  rect(x, y, w, h, fill) { this.ops.push(`${fill.map(n2).join(" ")} rg ${n2(x)} ${n2(PAGE_H - y - h)} ${n2(w)} ${n2(h)} re f`); }
  line(x1, y1, x2, y2, { width: lw = 0.6, color = BLACK } = {}) {
    this.ops.push(`${color.map(n2).join(" ")} RG ${n2(lw)} w ${n2(x1)} ${n2(PAGE_H - y1)} m ${n2(x2)} ${n2(PAGE_H - y2)} l S`);
  }
  box(x, y, w, h, { width: lw = 0.8 } = {}) { this.ops.push(`0 0 0 RG ${n2(lw)} w ${n2(x)} ${n2(PAGE_H - y - h)} ${n2(w)} ${n2(h)} re S`); }
}

/**
 * A table: `cols` [{ title, w }] across the page, rows of cells, each cell a list of lines
 * { t, font, size, color }. A row may instead span from column `span.from` to the right edge
 * with wrapped lines (the lap times). The header comes back at the top of every new page.
 */
function table(doc, cols, rows) {
  const xs = [];
  let x = M;
  for (const c of cols) { xs.push(x); x += c.w; }
  const header = () => {
    for (let i = 0; i < cols.length; i++) doc.text(xs[i] + 2, doc.y + 8, cols[i].title.toUpperCase(), { font: "B", size: 6.5, color: GREY, max: cols[i].w - 4 });
    doc.line(M, doc.y + 11, RIGHT, doc.y + 11, { width: 0.8 });
    doc.y += 13;
  };
  header();
  for (const row of rows) {
    let blocks;
    if (row.span) {
      const left = xs[row.span.from];
      const lines = row.span.lines;
      blocks = [{ x: left, w: RIGHT - left, lines }];
    } else {
      blocks = row.cells.map((lines, i) => ({
        x: xs[i], w: cols[i].w,
        // A line marked `wrap` is split to the column's width instead of being cut short.
        lines: (lines || []).flatMap((l) => (l.wrap
          ? wrap(winAnsi(l.t), l.size ?? 8.5, l.font ?? "R", cols[i].w - 4).map((t) => ({ ...l, t, encoded: true, wrap: false }))
          : [l])),
      }));
    }
    const h = Math.max(...blocks.map((b) => b.lines.reduce((n, l) => n + (l.size ?? 8.5) + 2, 0))) + 4;
    if (doc.ensure(h)) header();
    if (row.shade) doc.rect(M, doc.y, RIGHT - M, h, row.shade);
    for (const b of blocks) {
      let ly = doc.y + 2;
      for (const l of b.lines) {
        const size = l.size ?? 8.5;
        ly += size;
        doc.text(b.x + 2, ly, l.t, { font: l.font ?? "R", size, color: l.color ?? BLACK, max: b.w - 4, encoded: !!l.encoded });
        ly += 2;
      }
    }
    doc.y += h;
    if (!row.span || row.rule) doc.line(M, doc.y, RIGHT, doc.y, { width: 0.3, color: [0.8, 0.8, 0.8] });
  }
}

function heading(doc, title, note) {
  doc.ensure(40);
  doc.y += 12;
  const w = doc.text(M, doc.y + 11, title, { font: "B", size: 12 });
  if (note) doc.text(M + w + 8, doc.y + 11, note, { size: 8, color: GREY, max: RIGHT - M - w - 8 });
  doc.line(M, doc.y + 15, RIGHT, doc.y + 15, { width: 0.8 });
  doc.y += 20;
}

function paragraph(doc, str, { size = 7.5, color = GREY } = {}) {
  for (const line of wrap(winAnsi(str), size, "R", RIGHT - M)) {
    doc.ensure(size + 3);
    doc.y += size + 1;
    doc.text(M, doc.y, line, { size, color, encoded: true });
    doc.y += 2;
  }
}

// ----------------------------------------------------------------------------- the report

const hhmm = (ms) => (ms == null ? "—" : new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: VENUE_TZ }));
const dh = (n) => (n == null ? "—" : `${n.toLocaleString("fr-FR")} DH`);
const cov = (e) => [{ t: `${COVERAGE_FR[e.coverage].label}${e.reservation ? ` · ${e.reservation}` : ""}`, font: "B", color: COVER_COLOR[e.coverage] }];

/** The report as PDF bytes (a Buffer). */
export function dayReportPdf(report, { generatedAt = new Date() } = {}) {
  const doc = new Pages();
  const t = report.totals;
  const problems = t.extra + t.booked + t.check + t.none;

  // ---- title
  doc.text(M, doc.y + 18, "Rapport des courses", { font: "B", size: 20 });
  doc.text(M, doc.y + 32, `MegaKart Fès · ${dayLabel(report.day)}`, { size: 10, color: GREY });
  doc.text(RIGHT, doc.y + 14, `Généré le ${generatedAt.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: VENUE_TZ })}`, { size: 7.5, color: GREY, align: "right" });
  doc.text(RIGHT, doc.y + 24, "Courses : MegaKart Timing Control · Paiements : caisse", { size: 7.5, color: GREY, align: "right" });
  doc.line(M, doc.y + 40, RIGHT, doc.y + 40, { width: 1.5 });
  doc.y += 50;

  // ---- the six figures
  const tiles = [
    ["Courses", String(t.races), t.tests ? `+ ${t.tests} test${t.tests > 1 ? "s" : ""}` : ""],
    ["Passages en piste", String(t.driverRaces), `${t.pilots} pilote${t.pilots > 1 ? "s" : ""}`],
    ["Couverts", String(t.covered), t.driverRaces ? `${Math.round((t.covered / t.driverRaces) * 100)} % payés` : ""],
    ["Sans paiement", String(problems), t.missingDh != null && problems ? `≈ ${dh(t.missingDh)}` : ""],
    ["Sous le tarif", String(t.underpaid), t.underpaid ? `− ${dh(t.underpaidDh)}` : "aucun"],
    ["Encaissé", dh(t.revenue), `${report.payments.filter((p) => p.paidOnDay).length} paiement(s)`],
  ];
  const tw = (RIGHT - M) / tiles.length;
  doc.box(M, doc.y, RIGHT - M, 44, { width: 1 });
  tiles.forEach(([label, value, sub], i) => {
    const x = M + i * tw;
    if (i) doc.line(x, doc.y, x, doc.y + 44, { width: 0.6 });
    doc.text(x + 6, doc.y + 10, label.toUpperCase(), { font: "B", size: 6.5, color: GREY, max: tw - 10 });
    doc.text(x + 6, doc.y + 27, value, { font: "B", size: 15, color: i === 3 && problems ? RED : BLACK, max: tw - 10 });
    doc.text(x + 6, doc.y + 38, sub, { size: 6.5, color: GREY, max: tw - 10 });
  });
  doc.y += 50;
  if (t.missingDh != null && problems) paragraph(doc, `≈ ${dh(t.missingDh)} : les passages sans paiement au tarif d’une course (${dh(t.racePrice)}).`);

  // ---- what to check
  heading(doc, "À vérifier : passages en piste sans paiement", `${report.uncovered.length} sur ${t.driverRaces}`);
  if (!report.uncovered.length) {
    paragraph(doc, "Chaque passage en piste de la journée est couvert par un paiement.", { size: 9, color: GREEN });
  } else {
    table(doc, [{ title: "Heure", w: 34 }, { title: "Course", w: 70 }, { title: "Pilote", w: 128 }, { title: "Kart", w: 26 }, { title: "Tours", w: 28 }, { title: "Meilleur", w: 44 }, { title: "Paiement", w: RIGHT - M - 330 }],
      report.uncovered.map((e) => ({ cells: [
        [{ t: hhmm(e.at) }], [{ t: e.raceName }], [{ t: e.driver, font: "B" }], [{ t: String(e.kart ?? "—") }], [{ t: String(e.laps) }], [{ t: fmtLap(e.bestLapMs) }],
        [...cov(e), ...(e.suggestions.length ? [{ t: `proche : ${e.suggestions.join(" / ")}`, size: 6.5, color: GREY, wrap: true }] : [])],
      ] })));
  }
  doc.y += 4;
  paragraph(doc, "« Course en plus » : le pilote a payé, mais moins de courses qu’il n’en a fait. « Réservé, pas encaissé » : réservation du jour jamais encaissée. « À vérifier » : prénom seul ou nom proche d’un client payé — à contrôler à la main. Les courses de test ne sont pas comptées. Les noms sont rapprochés sans tenir compte des accents ni de petites fautes de frappe ; les forfaits achetés un autre jour ne sont pas pris en compte.");

  // ---- payments
  heading(doc, "Paiements du jour et courses faites", `${report.payments.length} paiement(s)${t.underpaid ? ` · ${t.underpaid} sous le tarif de leur formule` : ""}`);
  if (!report.payments.length) {
    paragraph(doc, "Aucun paiement enregistré ce jour.", { size: 9 });
  } else {
    table(doc, [{ title: "Code", w: 52 }, { title: "Encaissé", w: 62 }, { title: "Montant", w: 56 }, { title: "Formule · courses/pilote", w: 104 }, { title: "Pilotes · courses faites", w: 138 }, { title: "Bilan", w: RIGHT - M - 412 }],
      report.payments.map((p) => {
        const allowed = p.perPilot == null ? "?" : Number.isFinite(p.perPilot) ? String(p.perPilot) : "abonnement";
        const short = p.amount != null && p.packPrice != null && p.amount < p.packPrice;
        const verdict = [
          p.racesDone === 0 ? { t: "Aucune course", font: "B" }
            : p.racesExtra > 0 ? { t: `${p.racesExtra} course${p.racesExtra > 1 ? "s" : ""} en plus`, font: "B", color: RED }
            : { t: `${p.racesCovered} couverte${p.racesCovered > 1 ? "s" : ""}`, color: GREEN },
          ...(short ? [{ t: `payé ${dh(p.amount)}`, font: "B", color: RED, size: 7.5 }, { t: `au lieu de ${dh(p.packPrice)}`, font: "B", color: RED, size: 7.5 }] : []),
        ];
        return {
          shade: p.racesExtra > 0 || short ? [0.99, 0.925, 0.918] : null,
          cells: [
            [{ t: p.clientCode ?? p.code, font: "B" }, ...(p.clientCode ? [{ t: p.code, size: 6.5, color: GREY }] : [])],
            [{ t: hhmm(p.paidAt) }, { t: p.method, size: 6.5, color: GREY }],
            [{ t: dh(p.amount), font: "B" }, ...(short ? [{ t: `tarif ${dh(p.packPrice)}`, size: 6.5, color: RED }] : [])],
            [{ t: p.pack ?? "—" }, { t: `${allowed} · ${p.allowanceFrom}`, size: 6.5, color: GREY, wrap: true }],
            p.pilots.map((x) => ({ t: `${x.name}  ×${x.races}`, size: 8 })),
            verdict,
          ],
        };
      }));
  }

  // ---- every race
  heading(doc, "Détail des courses", `${report.races.length} course(s), dans l’ordre de la journée · classement au meilleur tour`);
  const cols = [{ title: "Pos", w: 24 }, { title: "Pilote", w: 150 }, { title: "Kart", w: 28 }, { title: "Tours", w: 30 }, { title: "Meilleur", w: 48 }, { title: "Moyenne", w: 48 }, { title: "Paiement", w: RIGHT - M - 328 }];
  for (const race of report.races) {
    const rows = [];
    for (const e of race.entries) {
      const avg = e.lapTimesMs.length ? Math.round(e.lapTimesMs.reduce((a, b) => a + b, 0) / e.lapTimesMs.length) : null;
      rows.push({ cells: [
        [{ t: e.position != null ? String(e.position) : "—", font: "B" }], [{ t: e.driver, font: "B" }], [{ t: String(e.kart ?? "—") }], [{ t: String(e.laps) }],
        [{ t: fmtLap(e.bestLapMs), font: "B" }], [{ t: fmtLap(avg) }], race.test ? [{ t: "test", color: GREY }] : cov(e),
      ] });
      if (e.lapTimesMs.length) {
        // No-break space inside "T11 26.160", so a line never ends on a lap number without its time.
        const laps = e.lapTimesMs.map((l, i) => `T${i + 1} ${fmtLap(l)}${l === e.bestLapMs ? "*" : ""}`).join("   ");
        const lines = wrap(winAnsi(laps), 6.5, "C", RIGHT - M - cols[0].w - 4).map((l) => ({ t: l, font: "C", size: 6.5, color: GREY, encoded: true }));
        rows.push({ span: { from: 1, lines }, rule: true });
      }
    }
    // A race stays on one page when it can.
    const estimate = 34 + rows.reduce((n, r) => n + (r.span ? r.span.lines.length * 8.5 + 4 : 16), 0);
    if (estimate < BOTTOM - M) doc.ensure(estimate); else doc.ensure(60);
    doc.y += 8;
    const w = doc.text(M, doc.y + 10, `${race.name}${race.test ? " · TEST" : ""}`, { font: "B", size: 10.5, color: race.test ? GREY : BLACK });
    doc.text(M + w + 8, doc.y + 10, `${race.raceId} · ${hhmm(race.startedAt)} -> ${hhmm(race.finishedAt)} · ${race.entries.length} pilote${race.entries.length > 1 ? "s" : ""}`, { size: 7.5, color: GREY });
    doc.y += 14;
    table(doc, cols, rows);
  }
  if (!report.races.length) paragraph(doc, "Aucune course enregistrée ce jour.", { size: 9 });
  paragraph(doc, "* meilleur tour du pilote.", { size: 6.5 });

  // ---- footers, now that the page count is known
  const total = doc.pages.length;
  doc.pages.forEach((ops, i) => {
    doc.ops = ops;
    doc.line(M, PAGE_H - M - 8, RIGHT, PAGE_H - M - 8, { width: 0.4, color: [0.6, 0.6, 0.6] });
    doc.text(M, PAGE_H - M + 2, `MegaKart Fès · Rapport des courses · ${report.day}`, { size: 7, color: GREY });
    doc.text(RIGHT, PAGE_H - M + 2, `page ${i + 1} / ${total}`, { size: 7, color: GREY, align: "right" });
  });

  return assemble(doc.pages, `MegaKart - Rapport des courses - ${report.day}`);
}

// ----------------------------------------------------------------------------- the file

function assemble(pages, title) {
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (buf) => { chunks.push(buf); length += buf.length; };
  const obj = (n, body) => {
    offsets[n] = length;
    push(Buffer.from(`${n} 0 obj\n`, "latin1"));
    push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    push(Buffer.from("\nendobj\n", "latin1"));
  };

  push(Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1"));
  const FIRST_PAGE = 7;
  const kids = pages.map((_, i) => `${FIRST_PAGE + i * 2} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  obj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  obj(6, `<< /Title ${pdfString(winAnsi(title))} /Producer (MegaKart) >>`);
  pages.forEach((ops, i) => {
    const pageN = FIRST_PAGE + i * 2;
    const content = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
    obj(pageN, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${pageN + 1} 0 R >>`);
    obj(pageN + 1, Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream", "latin1")]));
  });

  const count = FIRST_PAGE + pages.length * 2;
  const xrefAt = length;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(Buffer.from(`${xref}trailer\n<< /Size ${count} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
