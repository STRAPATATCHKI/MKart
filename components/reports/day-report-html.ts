// The Rapport du jour in a print window: « Enregistrer au format PDF » gives the PDF. The page
// itself is built by lib/day-report-html.mjs, shared with the MegaKart API.

import * as page from "@/lib/day-report-html.mjs";
import type { Coverage, DayReport } from "@/lib/day-report";

export const COVERAGE_FR: Record<Coverage, { label: string; mark: string }> = page.COVERAGE_FR;
export const dayReportHtml = (report: DayReport, opts: { logoUrl?: string; generatedAt?: Date } = {}): string => page.dayReportHtml(report, opts);
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * The report window, opened at the click itself - a browser blocks a window opened after the
 * data has been gathered, the click being too long ago by then. Null when blocked anyway.
 */
export function openReportWindow(day: string): Window | null {
  const win = window.open("", `megakart-rapport-${day}`, "width=900,height=1100");
  if (!win) return null;
  win.document.open();
  win.document.write(`<!doctype html><meta charset="utf-8"><title>Rapport des courses</title>
    <body style="font:14px Segoe UI,Arial,sans-serif;padding:40px;color:#333">Préparation du rapport du ${esc(day)}…</body>`);
  win.document.close();
  return win;
}

/** Writes the report into its window and asks to print (« Enregistrer au format PDF »). */
export function showDayReport(win: Window, report: DayReport): void {
  win.document.open();
  win.document.write(dayReportHtml(report, { logoUrl: `${window.location.origin}/megakart-loader-logo.png` }));
  win.document.close();
  win.focus();
  const go = () => { try { win.print(); } catch { /* closed meanwhile */ } };
  const img = win.document.querySelector("img");
  if (img && !img.complete) {
    img.addEventListener("load", go, { once: true });
    img.addEventListener("error", go, { once: true });
  } else {
    window.setTimeout(go, 300);
  }
}

/** Shows why the report could not be made, in its own window. */
export function showReportError(win: Window, message: string): void {
  win.document.open();
  win.document.write(`<!doctype html><meta charset="utf-8"><title>Rapport des courses</title>
    <body style="font:14px Segoe UI,Arial,sans-serif;padding:40px;color:#b3261e">${esc(message)}</body>`);
  win.document.close();
}
