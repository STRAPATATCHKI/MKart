// STABLE KART ↔ TRANSPONDER MAP.
//
// The feed only ever tells us a transponder id. Humans — in MegaKart and in GoKarts — only
// ever think in kart numbers. The transponder is bolted to the kart and does not move, so the
// mapping is stable equipment data, not per-session data.
//
// Establish it once and the operator never types a transponder again: they pick "Kart 3" in
// both systems and the names line up by themselves. Without it, someone retypes transponder
// numbers every session, and one day they will get it wrong mid-race.
//
// This is deliberately SEPARATE from roster.json, which is per-session (transponder → the
// driver sitting in it right now). Equipment changes rarely; drivers change every session.

import fs from "node:fs";
import path from "node:path";

export function createKartMap({ file, onChange }) {
  /** kart number (string) -> { transponder, label, active, updatedAt } */
  let karts = Object.create(null);

  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      karts = Object.create(null);
      for (const [kart, v] of Object.entries(j.karts || {})) {
        if (!/^\d{1,3}$/.test(String(kart))) continue;
        const transponder = String(v?.transponder ?? "").trim();
        if (!transponder) continue;
        karts[String(kart)] = {
          transponder,
          label: typeof v?.label === "string" ? v.label.slice(0, 40) : "",
          active: v?.active !== false,
          updatedAt: v?.updatedAt ?? null,
        };
      }
      console.log(`[karts] ${Object.keys(karts).length} kart(s) mappés`);
    } catch {
      karts = Object.create(null);
      console.log("[karts] aucun mappage (karts.json absent ou invalide)");
    }
  }

  function save() {
    try {
      fs.writeFileSync(file, JSON.stringify({
        _comment:
          "Mappage STABLE kart -> transpondeur. Le transpondeur est fixé au kart et ne bouge pas. " +
          "À ne pas confondre avec roster.json, qui est le pilote assis dans le kart pour UNE session.",
        karts,
      }, null, 2));
      return true;
    } catch (e) {
      console.log("[karts] écriture impossible:", e.message);
      return false;
    }
  }

  load();
  try { fs.watchFile(file, { interval: 2000 }, () => { load(); onChange?.(); }); } catch {}

  /** transponder -> kart number, the direction the live feed needs. */
  function kartForTransponder(transponder) {
    const t = String(transponder);
    for (const [kart, v] of Object.entries(karts)) if (v.transponder === t) return kart;
    return null;
  }

  function transponderForKart(kart) {
    return karts[String(kart)]?.transponder ?? null;
  }

  /** Replace the whole table. Returns { ok, error } — duplicates are rejected, not merged. */
  function setAll(incoming) {
    if (!incoming || typeof incoming !== "object") return { ok: false, error: "corps invalide" };
    const next = Object.create(null);
    const seen = new Map();
    for (const [kart, v] of Object.entries(incoming)) {
      const k = String(kart).trim();
      if (!/^\d{1,3}$/.test(k)) return { ok: false, error: `numéro de kart invalide: ${kart}` };
      const transponder = String(v?.transponder ?? "").trim();
      if (!transponder) continue; // an empty row just means "not mapped yet"
      if (!/^\d{1,10}$/.test(transponder)) return { ok: false, error: `transpondeur invalide pour le kart ${k}` };
      // One transponder cannot be in two karts. Silently merging would produce a board where
      // two pilots share a row and nobody could tell why.
      if (seen.has(transponder)) return { ok: false, error: `transpondeur ${transponder} déjà attribué au kart ${seen.get(transponder)}` };
      seen.set(transponder, k);
      next[k] = {
        transponder,
        label: typeof v?.label === "string" ? v.label.slice(0, 40) : "",
        active: v?.active !== false,
        updatedAt: new Date().toISOString(),
      };
    }
    karts = next;
    const written = save();
    onChange?.();
    return { ok: written, error: written ? null : "écriture impossible" };
  }

  function all() {
    return JSON.parse(JSON.stringify(karts));
  }

  /** Learn a mapping from live traffic: which transponders have we seen that nobody claims? */
  function unmapped(seenTransponders) {
    const mapped = new Set(Object.values(karts).map((v) => v.transponder));
    return [...new Set(seenTransponders.map(String))].filter((t) => t && t !== "0" && !mapped.has(t));
  }

  return { all, setAll, kartForTransponder, transponderForKart, unmapped, reload: load };
}
