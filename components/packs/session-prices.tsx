"use client";

// TARIFS À LA SESSION — the simple prices: one session of 8, 16, 24... minutes, per pilot.
//
// A price board rather than cards: a duration and a price is all there is to say. Edited
// inline as a small table (duration, price, optional note, on sale), saved in the same catalog
// as every other offer, so the sign-up forms offer them too ("À la session").

import { useMemo, useState, type CSSProperties } from "react";
import { Eye, EyeOff, Plus, Timer, Trash2 } from "lucide-react";
import { PACK_COLORS, perMinuteLabel, sessionLength, sessionOffer, type Offer } from "@/lib/catalog";

type Row = { key: string; id: string | null; minutes: string; price: string; note: string; enabled: boolean; color: string };

const toRows = (offers: Offer[]): Row[] =>
  offers.map((o) => ({
    key: o.id, id: o.id, minutes: String(sessionLength(o) || ""), price: String(o.price || ""),
    note: o.description, enabled: o.enabled, color: o.color,
  }));

type RowIssue = { minutes?: string; price?: string };

function rowIssues(rows: Row[]): RowIssue[] {
  const seen = new Map<number, number>();
  return rows.map((r, i) => {
    const issue: RowIssue = {};
    const m = Number(r.minutes);
    if (!Number.isInteger(m) || m < 1 || m > 240) issue.minutes = "1 à 240 min";
    else if (seen.has(m)) issue.minutes = `Déjà une ligne à ${m} min`;
    else seen.set(m, i);
    const p = Number(r.price);
    if (r.price.trim() === "" || !Number.isFinite(p) || p <= 0) issue.price = "Prix requis";
    else if (p > 100_000) issue.price = "Prix trop élevé";
    return issue;
  });
}

export function SessionPrices({ offers, editing, saving, onSave }: {
  offers: Offer[];
  editing: boolean;
  saving: boolean;
  /** Replaces every session price in the catalog with this list. */
  onSave: (next: Offer[]) => Promise<boolean>;
}) {
  const sorted = useMemo(() => [...offers].sort((a, b) => sessionLength(a) - sessionLength(b)), [offers]);
  const [rows, setRows] = useState<Row[] | null>(null);   // null: not being edited
  const draft = rows ?? toRows(sorted);
  const issues = rowIssues(draft);
  const valid = issues.every((i) => !i.minutes && !i.price);
  const dirty = rows != null;

  const set = (key: string, patch: Partial<Row>) => setRows(draft.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = () => {
    // The next duration after the longest one, in steps of 8 minutes: 8, 16, 24...
    const longest = Math.max(0, ...draft.map((r) => Number(r.minutes) || 0));
    const minutes = longest ? Math.ceil((longest + 1) / 8) * 8 : 8;
    setRows([...draft, {
      key: `new-${Date.now()}`, id: null, minutes: String(minutes), price: "", note: "", enabled: true,
      color: PACK_COLORS[draft.length % PACK_COLORS.length],
    }]);
  };
  const save = async () => {
    const next = draft
      .map((r) => ({ r, m: Number(r.minutes) }))
      .sort((a, b) => a.m - b.m)
      .map(({ r, m }) => sessionOffer(m, Math.round(Number(r.price)), r.note, { id: r.id ?? undefined, color: r.color, enabled: r.enabled }));
    if (await onSave(next)) setRows(null);
  };

  if (!editing) {
    const live = sorted.filter((o) => o.enabled);
    const unsaved = dirty ? <p className="cat-err sp-unsaved">Tarifs modifiés non enregistrés : rouvrez « Modifier le catalogue » pour les enregistrer.</p> : null;
    if (!live.length) {
      return <>{unsaved}<p className="cat-empty">Aucun tarif à la session — « Modifier le catalogue » pour ajouter 8 min, 16 min…</p></>;
    }
    return (
      <>
      {unsaved}
      <div className="sp-board">
        {live.map((o) => (
          <article key={o.id} className="sp-tile" style={{ "--pack": o.color } as CSSProperties}>
            <span className="sp-min"><b>{sessionLength(o)}</b><small>MIN</small></span>
            <span className="sp-price"><b>{o.price.toLocaleString("fr-FR")} DH</b><small>par pilote</small></span>
            {perMinuteLabel(o) && <em>{perMinuteLabel(o)}</em>}
            {o.description && <p>{o.description}</p>}
          </article>
        ))}
      </div>
      </>
    );
  }

  return (
    <div className="sp-edit">
      <div className="sp-row sp-head"><span>DURÉE</span><span>PRIX / PILOTE</span><span>NOTE <em>(facultatif)</em></span><span /></div>
      {draft.length === 0 && <p className="cat-empty">Aucun tarif pour l’instant : ajoutez 8 min, puis 16 min…</p>}
      {draft.map((r, i) => (
        <div key={r.key} className={"sp-row" + (r.enabled ? "" : " is-off")}>
          <label className="sp-cell">
            <span className="sp-unit">
              <input className={"cat-in" + (issues[i].minutes ? " is-bad" : "")} type="number" min={1} max={240} inputMode="numeric"
                value={r.minutes} onChange={(e) => set(r.key, { minutes: e.target.value })} aria-label="Durée en minutes" />
              <i>min</i>
            </span>
            {issues[i].minutes && <small className="cat-err">{issues[i].minutes}</small>}
          </label>
          <label className="sp-cell">
            <span className="sp-unit">
              <input className={"cat-in" + (issues[i].price ? " is-bad" : "")} type="number" min={1} inputMode="numeric" placeholder="0"
                value={r.price} onChange={(e) => set(r.key, { price: e.target.value })} aria-label="Prix en dirhams" />
              <i>DH</i>
            </span>
            {issues[i].price && <small className="cat-err">{issues[i].price}</small>}
          </label>
          <input className="cat-in" maxLength={120} value={r.note} placeholder="Tour de chauffe inclus"
            onChange={(e) => set(r.key, { note: e.target.value })} aria-label="Note" />
          <span className="sp-actions">
            <button type="button" onClick={() => set(r.key, { enabled: !r.enabled })} title={r.enabled ? "Retirer de la vente" : "Remettre en vente"}>
              {r.enabled ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button type="button" className="is-danger" onClick={() => setRows(draft.filter((x) => x.key !== r.key))} title="Supprimer"><Trash2 size={14} /></button>
          </span>
        </div>
      ))}
      <div className="sp-foot">
        <button type="button" className="cat-ghost" onClick={add}><Plus size={14} /> Ajouter une durée</button>
        <span />
        {dirty && <button type="button" className="secondary-button" onClick={() => setRows(null)}>Annuler</button>}
        {dirty && (
          <button type="button" className="primary-button" disabled={!valid || saving} onClick={() => void save()}>
            <Timer size={15} /> {saving ? "Enregistrement…" : "Enregistrer les tarifs"}
          </button>
        )}
      </div>
    </div>
  );
}
