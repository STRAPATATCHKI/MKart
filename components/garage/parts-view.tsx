"use client";

// Garage → Pièces de rechange: what is on the shelf, what to reorder, and which kart each part
// went on. Every change is saved on the desk at once (garage.json).

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Package, Pencil, Plus, Search, Trash2, Wrench, X } from "lucide-react";
import { useGarage } from "@/hooks/use-garage";
import {
  applyMove, blankPart, CATEGORY_LABELS, CATEGORY_ORDER, FIT_LABELS, isLow, partIssues, stockValue, toReorder,
  type Part, type PartCategory, type PartFit,
} from "@/lib/garage-parts";

type MoveDraft = { partId: string; dir: 1 | -1; qty: string; kart: string; note: string };

export function PartsView({ operator }: { operator?: string }) {
  const { garage, source, saving, error, save } = useGarage();
  const [filter, setFilter] = useState<PartCategory | "all" | "low">("all");
  const [query, setQuery] = useState("");
  const [move, setMove] = useState<MoveDraft | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ part: Part; isNew: boolean } | null>(null);
  const [kartFilter, setKartFilter] = useState("");

  // "Now" for the 30-day count, taken once after the page opens rather than while it draws.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const t = window.setTimeout(() => setNow(Date.now()), 0);
    return () => window.clearTimeout(t);
  }, []);
  const low = toReorder(garage.parts);
  const value = stockValue(garage.parts);
  const outs30 = garage.moves.filter((m) => m.qty < 0 && now - Date.parse(m.at) < 30 * 86_400_000)
    .reduce((n, m) => n - m.qty, 0);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return garage.parts
      .filter((p) => (filter === "all" ? true : filter === "low" ? isLow(p) : p.category === filter))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.supplier.toLowerCase().includes(q))
      .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.name.localeCompare(b.name));
  }, [garage.parts, filter, query]);

  const moves = useMemo(() => {
    const kart = Number(kartFilter);
    return (Number.isInteger(kart) && kart > 0 ? garage.moves.filter((m) => m.kart === kart) : garage.moves).slice(0, 25);
  }, [garage.moves, kartFilter]);

  const confirmMove = async () => {
    if (!move) return;
    const qty = Number(move.qty);
    const kart = Number(move.kart);
    if (!Number.isInteger(qty) || qty <= 0) { setMoveError("Indiquez une quantité."); return; }
    const next = applyMove(garage, {
      partId: move.partId, qty: move.dir * qty,
      kart: move.dir < 0 && Number.isInteger(kart) && kart > 0 ? kart : null,
      note: move.note.trim().slice(0, 120), by: operator || null,
    });
    if (typeof next === "string") { setMoveError(next); return; }
    if (await save(next)) { setMove(null); setMoveError(null); }
  };

  const savePart = async (part: Part, isNew: boolean) => {
    const parts = isNew ? [...garage.parts, part] : garage.parts.map((p) => (p.id === part.id ? part : p));
    if (await save({ ...garage, parts })) setEditing(null);
  };

  const removePart = async (part: Part) => {
    if (!window.confirm(`Supprimer « ${part.name} » de l’inventaire ? Son historique de mouvements est conservé.`)) return;
    await save({ ...garage, parts: garage.parts.filter((p) => p.id !== part.id) });
  };

  const when = (iso: string) => new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="parts">
      <section className="fuel-kpis">
        <article>
          <Package size={18} />
          <span><small>RÉFÉRENCES</small><strong>{garage.parts.length}</strong><b>{garage.parts.reduce((n, p) => n + p.stock, 0)} pièces en stock</b></span>
        </article>
        <article className={low.length ? "is-low" : ""}>
          <AlertTriangle size={18} />
          <span><small>À COMMANDER</small><strong>{low.length}</strong><b>{low.length ? low.slice(0, 2).map((p) => p.name).join(", ") + (low.length > 2 ? "…" : "") : "Stock suffisant"}</b></span>
        </article>
        <article>
          <Wrench size={18} />
          <span><small>SORTIES · 30 JOURS</small><strong>{outs30}</strong><b>pièces montées ou remplacées</b></span>
        </article>
        <article>
          <ArrowDownToLine size={18} />
          <span><small>VALEUR DU STOCK</small><strong>{value.value.toLocaleString("fr-FR")}<em>DH</em></strong><b>{value.unpriced ? `${value.unpriced} pièce${value.unpriced > 1 ? "s" : ""} sans prix` : "toutes pièces chiffrées"}</b></span>
        </article>
      </section>

      <div className="parts-toolbar">
        <div className="fa-filters" role="tablist">
          <button type="button" className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>Toutes</button>
          <button type="button" className={filter === "low" ? "is-on" : ""} onClick={() => setFilter("low")}>À commander{low.length ? ` (${low.length})` : ""}</button>
          {CATEGORY_ORDER.filter((c) => garage.parts.some((p) => p.category === c)).map((c) => (
            <button key={c} type="button" className={filter === c ? "is-on" : ""} onClick={() => setFilter(c)}>{CATEGORY_LABELS[c]}</button>
          ))}
        </div>
        <label className="parts-search"><Search size={14} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Chercher une pièce" /></label>
        <button type="button" className="primary-button" onClick={() => setEditing({ part: blankPart(), isNew: true })}><Plus size={15} /> Nouvelle pièce</button>
      </div>

      <p className={"parts-status" + (error ? " is-bad" : source === "readonly" ? " is-warn" : "")}>
        {error ?? (saving ? "Enregistrement…"
          : source === "readonly" ? "Lecture seule : appuyez sur Synchroniser pour pouvoir enregistrer sur le poste d’accueil."
          : source === "seed" ? "Liste de départ : indiquez vos stocks réels, la première modification l’enregistre sur le poste d’accueil."
          : source === "desk" ? `Enregistré sur le poste d’accueil${garage.savedAt ? ` · ${when(garage.savedAt)}` : ""}` : "Chargement…")}
      </p>

      <section className="panel parts-list">
        <div className="parts-row parts-head"><span>PIÈCE</span><span>STOCK</span><span>MINIMUM</span><span>PRIX</span><span /></div>
        {shown.length === 0 && <div className="empty-state" style={{ padding: 22 }}><Package size={20} /><strong>Aucune pièce</strong><span>Ajoutez vos pièces avec « Nouvelle pièce ».</span></div>}
        {shown.map((p) => (
          <div key={p.id} className="parts-item">
            <div className={"parts-row" + (isLow(p) ? " is-low" : "")}>
              <span className="parts-name">
                <b>{p.name}</b>
                <small>{CATEGORY_LABELS[p.category]} · {FIT_LABELS[p.fits]}{p.supplier ? ` · ${p.supplier}` : ""}</small>
              </span>
              <span className="parts-stock"><strong>{p.stock}</strong><small>{p.unit}</small>{isLow(p) && <em>À commander</em>}</span>
              <span>{p.minStock} {p.unit}</span>
              <span>{p.unitPrice != null ? `${p.unitPrice} DH` : "—"}</span>
              <span className="parts-actions">
                <button type="button" onClick={() => { setMove({ partId: p.id, dir: 1, qty: "", kart: "", note: "" }); setMoveError(null); }} title="Entrée : livraison, achat"><ArrowDownToLine size={14} /> Entrée</button>
                <button type="button" onClick={() => { setMove({ partId: p.id, dir: -1, qty: "1", kart: "", note: "" }); setMoveError(null); }} disabled={p.stock === 0} title="Sortie : montée sur un kart"><ArrowUpFromLine size={14} /> Sortie</button>
                <button type="button" onClick={() => setEditing({ part: { ...p }, isNew: false })} title="Modifier"><Pencil size={14} /></button>
                <button type="button" className="is-danger" onClick={() => void removePart(p)} title="Supprimer"><Trash2 size={14} /></button>
              </span>
            </div>
            {move?.partId === p.id && (
              <div className="parts-move">
                <b>{move.dir > 0 ? "Entrée en stock" : "Sortie du stock"} · {p.name}</b>
                <label><span>Quantité ({p.unit})</span>
                  <input autoFocus inputMode="numeric" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value.replace(/\D/g, "") })} /></label>
                {move.dir < 0 && (
                  <label><span>Kart n°</span>
                    <input inputMode="numeric" value={move.kart} placeholder="ex. 7" onChange={(e) => setMove({ ...move, kart: e.target.value.replace(/\D/g, "") })} /></label>
                )}
                <label className="parts-move-note"><span>Note {move.dir > 0 ? "(fournisseur, facture…)" : "(panne, remplacement…)"}</span>
                  <input value={move.note} maxLength={120} onChange={(e) => setMove({ ...move, note: e.target.value })} /></label>
                <div className="parts-move-actions">
                  <button type="button" className="primary-button" disabled={saving} onClick={() => void confirmMove()}>
                    {move.dir > 0 ? `Ajouter ${move.qty || 0} ${p.unit}` : `Retirer ${move.qty || 0} ${p.unit}`}
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setMove(null)}>Annuler</button>
                </div>
                {moveError && <small className="cat-err">{moveError}</small>}
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="panel parts-log">
        <div className="panel-header">
          <div><span className="panel-kicker">HISTORIQUE</span><h2>Mouvements</h2></div>
          <label className="parts-search"><Wrench size={14} /><input value={kartFilter} inputMode="numeric" onChange={(e) => setKartFilter(e.target.value.replace(/\D/g, ""))} placeholder="Kart n°" /></label>
        </div>
        {moves.length === 0 ? (
          <p className="parts-empty">{kartFilter ? `Aucune pièce montée sur le kart ${kartFilter}.` : "Aucun mouvement pour l’instant."}</p>
        ) : (
          <ul>
            {moves.map((m) => (
              <li key={m.id} className={m.qty > 0 ? "is-in" : "is-out"}>
                <time>{when(m.at)}</time>
                <b>{m.qty > 0 ? `+${m.qty}` : m.qty}</b>
                <span>{m.partName}</span>
                <span>{m.kart ? `Kart ${m.kart}` : m.qty > 0 ? "Entrée" : "—"}</span>
                <small>{m.note}{m.by ? ` · ${m.by}` : ""}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <PartEditor initial={editing.part} isNew={editing.isNew} saving={saving} onCancel={() => setEditing(null)} onSave={(p) => void savePart(p, editing.isNew)} />}
    </div>
  );
}

function PartEditor({ initial, isNew, saving, onCancel, onSave }: {
  initial: Part; isNew: boolean; saving: boolean; onCancel: () => void; onSave: (p: Part) => void;
}) {
  const [p, setP] = useState<Part>(initial);
  const [touched, setTouched] = useState(false);
  const issues = partIssues(p);
  const err = (f: keyof Part) => (touched ? issues.find((i) => i.field === f)?.message : undefined);
  const set = <K extends keyof Part>(k: K, v: Part[K]) => setP((prev) => ({ ...prev, [k]: v }));
  const num = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(/\D/g, "")));

  return (
    <div className="cat-modal" role="dialog" aria-modal="true" aria-label={isNew ? "Nouvelle pièce" : "Modifier la pièce"}>
      <div className="cat-modal-box parts-editor">
        <header className="cat-modal-head">
          <div><span>{isNew ? "NOUVELLE PIÈCE" : "MODIFIER LA PIÈCE"}</span><h2>{p.name || "Sans nom"}</h2></div>
          <button type="button" className="cat-icon" onClick={onCancel} aria-label="Fermer"><X size={18} /></button>
        </header>
        <form className="cat-form" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!issues.length) onSave(p); }}>
          <div className="cat-row">
            <label><span>Nom</span><input className={"cat-in" + (err("name") ? " is-bad" : "")} maxLength={60} value={p.name} autoFocus placeholder="Plaquettes de frein" onChange={(e) => set("name", e.target.value)} />
              {err("name") && <small className="cat-err">{err("name")}</small>}</label>
            <label><span>Catégorie</span>
              <select className="cat-in" value={p.category} onChange={(e) => set("category", e.target.value as PartCategory)}>
                {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
              </select></label>
          </div>
          <div className="cat-row cat-row-4">
            <label><span>Pour</span>
              <select className="cat-in" value={p.fits} onChange={(e) => set("fits", e.target.value as PartFit)}>
                {(Object.keys(FIT_LABELS) as PartFit[]).map((f) => <option key={f} value={f}>{FIT_LABELS[f]}</option>)}
              </select></label>
            <label><span>Unité</span><input className="cat-in" maxLength={12} value={p.unit} onChange={(e) => set("unit", e.target.value)} placeholder="pièce, jeu, L" /></label>
            <label><span>{isNew ? "Stock initial" : "Stock"}</span><input className="cat-in" inputMode="numeric" value={String(p.stock)} onChange={(e) => set("stock", num(e.target.value))} /></label>
            <label><span>Minimum</span><input className="cat-in" inputMode="numeric" value={String(p.minStock)} onChange={(e) => set("minStock", num(e.target.value))} /></label>
          </div>
          <div className="cat-row">
            <label><span>Prix unitaire (DH) <em>(facultatif)</em></span><input className="cat-in" inputMode="numeric" value={p.unitPrice ?? ""} onChange={(e) => set("unitPrice", e.target.value.trim() === "" ? null : num(e.target.value))} /></label>
            <label><span>Fournisseur <em>(facultatif)</em></span><input className="cat-in" maxLength={60} value={p.supplier} onChange={(e) => set("supplier", e.target.value)} /></label>
          </div>
          <label className="cat-field"><span>Note <em>(facultatif)</em></span><input className="cat-in" maxLength={160} value={p.note} onChange={(e) => set("note", e.target.value)} /></label>
          <footer className="cat-modal-foot">
            <button type="button" className="secondary-button" onClick={onCancel}>Annuler</button>
            <button type="submit" className="primary-button" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
