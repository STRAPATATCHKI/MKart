"use client";

// The form for one offer, with the card it will produce beside it. Nothing is saved until
// "Enregistrer", and "Enregistrer" does not exist until the offer is complete.

import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  audienceOnForm, groupRange, KIND_LABELS, KIND_ORDER, offerIssues, PACK_COLORS, UNIT_LABELS,
  type Offer, type OfferKind, type OfferUnit,
} from "@/lib/catalog";
import { OfferCard } from "./offer-card";

type Props = {
  initial: Offer;
  isNew: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (offer: Offer) => void;
};

/** An empty number field is null, not zero: "no old price" and "old price 0" are different. */
const num = (v: string): number | null => (v.trim() === "" ? null : Number(v));

export function OfferEditor({ initial, isNew, saving, onCancel, onSave }: Props) {
  const [o, setO] = useState<Offer>(initial);
  const [touched, setTouched] = useState(!isNew);
  const set = <K extends keyof Offer>(key: K, value: Offer[K]) => { setTouched(true); setO((prev) => ({ ...prev, [key]: value })); };

  const issues = offerIssues(o);
  const shown = touched ? issues : [];
  const err = (field: keyof Offer | "extras") => shown.find((i) => i.field === field)?.message ?? null;
  const cls = (field: keyof Offer | "extras") => (err(field) ? "cat-in is-bad" : "cat-in");
  const note = (field: keyof Offer | "extras") => (err(field) ? <small className="cat-err">{err(field)}</small> : null);

  const setKind = (kind: OfferKind) => {
    // Changing the type moves the sensible defaults with it, without wiping what was typed.
    setTouched(true);
    setO((prev) => ({
      ...prev, kind,
      basis: kind === "famille" || kind === "amis" ? "groupe" : prev.basis,
      people: kind === "famille" || kind === "amis" ? (prev.people ?? (kind === "famille" ? 4 : 5)) : prev.people,
      minPeople: kind === "famille" || kind === "amis" ? (prev.minPeople ?? (kind === "famille" ? 3 : 4)) : prev.minPeople,
      period: kind === "abonnement" ? (prev.period === "unique" ? "mois" : prev.period) : prev.period,
    }));
  };

  return (
    <div className="cat-modal" role="dialog" aria-modal="true" aria-label={isNew ? "Nouvelle offre" : "Modifier l’offre"}>
      <div className="cat-modal-box">
        <header className="cat-modal-head">
          <div><span>{isNew ? "NOUVELLE OFFRE" : "MODIFIER L’OFFRE"}</span><h2>{o.name || "Sans nom"}</h2></div>
          <button type="button" className="cat-icon" onClick={onCancel} aria-label="Fermer"><X size={18} /></button>
        </header>

        <div className="cat-modal-body">
          <form className="cat-form" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!issues.length) onSave(o); }}>
            <div className="cat-row">
              <label><span>Type d’offre</span>
                <select className="cat-in" value={o.kind} onChange={(e) => setKind(e.target.value as OfferKind)}>
                  {/* Session prices are edited in their own table on the page, not as cards. */}
                  {KIND_ORDER.filter((k) => k !== "session").map((k) => <option key={k} value={k}>{KIND_LABELS[k].title}</option>)}
                </select>
              </label>
              <label><span>Nom</span>
                <input className={cls("name")} value={o.name} maxLength={40} placeholder="Pack Gold" onChange={(e) => set("name", e.target.value)} />
                {note("name")}
              </label>
            </div>

            <div className="cat-field">
              <span>Couleur du pack</span>
              <div className="cat-swatches">
                {PACK_COLORS.map((c) => (
                  <button key={c} type="button" className={"cat-swatch" + (o.color.toLowerCase() === c ? " is-on" : "")}
                    style={{ background: c }} onClick={() => set("color", c)} aria-label={`Couleur ${c}`} />
                ))}
                <label className="cat-swatch cat-swatch-custom" title="Autre couleur">
                  <input type="color" value={o.color} onChange={(e) => set("color", e.target.value)} />
                </label>
                <code>{o.color}</code>
              </div>
            </div>

            <label className="cat-field"><span>Description</span>
              <textarea className={cls("description")} rows={2} maxLength={200} value={o.description}
                placeholder="L’offre idéale pour découvrir le karting." onChange={(e) => set("description", e.target.value)} />
              {note("description")}
            </label>

            <div className="cat-row cat-row-3">
              <label><span>Prix (DH)</span>
                <input className={cls("price")} type="number" min={0} value={Number.isFinite(o.price) ? o.price : ""}
                  onChange={(e) => set("price", Number(e.target.value))} />
                {note("price")}
              </label>
              <label><span>Ancien prix <em>(barré, facultatif)</em></span>
                <input className={cls("originalPrice")} type="number" min={0} value={o.originalPrice ?? ""}
                  onChange={(e) => set("originalPrice", num(e.target.value))} />
                {note("originalPrice")}
              </label>
              <label><span>Fréquence</span>
                <select className="cat-in" value={o.period} onChange={(e) => set("period", e.target.value as Offer["period"])}>
                  <option value="unique">Paiement unique</option>
                  <option value="semaine">Abonnement hebdomadaire</option>
                  <option value="mois">Abonnement mensuel</option>
                </select>
              </label>
            </div>

            <div className={"cat-row " + (o.basis === "groupe" ? "cat-row-4" : "cat-row-3")}>
              <label><span>Prix pour</span>
                <select className="cat-in" value={o.basis} onChange={(e) => {
                  const basis = e.target.value as Offer["basis"];
                  setTouched(true);
                  setO((prev) => ({
                    ...prev, basis,
                    people: basis === "groupe" ? (prev.people ?? 4) : null,
                    minPeople: basis === "groupe" ? prev.minPeople : null,
                  }));
                }}>
                  <option value="personne">Une personne</option>
                  <option value="groupe">Tout le groupe</option>
                </select>
              </label>
              {o.basis === "groupe" && (
                <>
                  <label><span>Pilotes min. <em>(formulaire)</em></span>
                    <input className={cls("minPeople")} type="number" min={2} max={o.people ?? undefined}
                      value={o.minPeople ?? ""} placeholder={o.people ? String(Math.max(2, o.people - 1)) : ""}
                      onChange={(e) => set("minPeople", num(e.target.value))} />
                    {note("minPeople")}
                  </label>
                  <label><span>Pilotes inclus <em>(max.)</em></span>
                    <input className={cls("people")} type="number" min={2} value={o.people ?? ""}
                      onChange={(e) => set("people", num(e.target.value))} />
                    {note("people")}
                  </label>
                  <label><span>Composition <em>(facultatif)</em></span>
                    <input className="cat-in" maxLength={60} value={o.capacity} placeholder="2 Juniors + 2 Adultes"
                      onChange={(e) => set("capacity", e.target.value)} />
                  </label>
                </>
              )}
            </div>

            <div className="cat-row cat-row-4">
              <label><span>Compté en</span>
                <select className="cat-in" value={o.unit} onChange={(e) => {
                  const unit = e.target.value as OfferUnit;
                  setTouched(true);
                  setO((prev) => ({ ...prev, unit, sessionMinutes: unit === "sessions" ? (prev.sessionMinutes ?? 8) : null }));
                }}>
                  {(Object.keys(UNIT_LABELS) as OfferUnit[]).map((u) => <option key={u} value={u}>{UNIT_LABELS[u].many}</option>)}
                </select>
              </label>
              <label><span>Quantité payée</span>
                <input className={cls("quantity")} type="number" min={1} value={Number.isFinite(o.quantity) ? o.quantity : ""}
                  onChange={(e) => set("quantity", Number(e.target.value))} />
                {note("quantity")}
              </label>
              <label><span>Offert(s) en plus</span>
                <input className={cls("bonus")} type="number" min={0} value={Number.isFinite(o.bonus) ? o.bonus : ""}
                  onChange={(e) => set("bonus", Number(e.target.value))} />
                {note("bonus")}
              </label>
              {o.unit === "sessions" && (
                <label><span>Minutes / session</span>
                  <input className={cls("sessionMinutes")} type="number" min={1} max={240} value={o.sessionMinutes ?? ""}
                    onChange={(e) => set("sessionMinutes", num(e.target.value))} />
                  {note("sessionMinutes")}
                </label>
              )}
            </div>

            <div className="cat-field">
              <span>Avantages inclus <em>(un par ligne)</em></span>
              <div className="cat-extras-edit">
                {o.extras.map((extra, i) => (
                  <div key={i} className="cat-extra-row">
                    <input className="cat-in" maxLength={80} value={extra} placeholder="Photos souvenirs"
                      onChange={(e) => set("extras", o.extras.map((x, k) => (k === i ? e.target.value : x)))} />
                    <button type="button" className="cat-icon" aria-label="Retirer"
                      onClick={() => set("extras", o.extras.filter((_, k) => k !== i))}><Trash2 size={15} /></button>
                  </div>
                ))}
                {o.extras.length < 12 && (
                  <button type="button" className="cat-ghost" onClick={() => set("extras", [...o.extras, ""])}>
                    <Plus size={14} /> Ajouter un avantage
                  </button>
                )}
              </div>
              {note("extras")}
            </div>

            <label className="cat-field"><span>Public visé <em>(facultatif)</em></span>
              <input className="cat-in" maxLength={120} value={o.audience} placeholder="Familles · Anniversaires · Groupes"
                onChange={(e) => set("audience", e.target.value)} />
            </label>

            <p className="cat-form-note">
              Sur le formulaire d’inscription : <b>{audienceOnForm(o)}</b>.
              {groupRange(o) ? " Le prix couvre tout le groupe."
                : o.period === "unique" ? " Chaque pilote paie ce prix."
                : " Un abonnement n’est proposé qu’à un pilote qui s’inscrit seul."}
            </p>

            <label className="cat-check">
              <input type="checkbox" checked={o.enabled} onChange={(e) => set("enabled", e.target.checked)} />
              <span>En vente — visible sur le dashboard et le formulaire d’inscription</span>
            </label>

            <footer className="cat-modal-foot">
              <button type="button" className="secondary-button" onClick={onCancel}>Annuler</button>
              {issues.length === 0 ? (
                <button type="submit" className="primary-button" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
              ) : touched ? (
                <small className="cat-err">{issues.length} chose{issues.length > 1 ? "s" : ""} à corriger</small>
              ) : null}
            </footer>
          </form>

          <aside className="cat-preview">
            <span>APERÇU</span>
            <OfferCard offer={{ ...o, extras: o.extras.filter((e) => e.trim()) }} />
          </aside>
        </div>
      </div>
    </div>
  );
}
