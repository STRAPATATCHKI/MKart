"use client";

// One offer, drawn the same way on Packs & ventes, Pass & fidélité, and in the editor's preview.
// The pack's own colour carries the card: its edge, its price, its badge.

import type { CSSProperties, ReactNode } from "react";
import { ArrowDownRight, CheckCircle2, Clock, UsersRound } from "lucide-react";
import {
  audienceOnForm, bonusLabel, KIND_LABELS, priceSuffix, pricePerPerson, savingLabel, totalUnits, unitWord, type Offer,
} from "@/lib/catalog";

export function OfferCard({ offer, actions, dimmed }: { offer: Offer; actions?: ReactNode; dimmed?: boolean }) {
  const total = totalUnits(offer);
  const bonus = bonusLabel(offer);
  const saving = savingLabel(offer);
  const perPerson = offer.basis === "groupe" && offer.people ? pricePerPerson(offer) : null;
  return (
    <article className={"cat-card" + (dimmed ? " is-off" : "")} style={{ "--pack": offer.color } as CSSProperties}>
      <div className="cat-card-top">
        <span className="cat-badge">{KIND_LABELS[offer.kind].badge}</span>
        {!offer.enabled ? <span className="cat-off">HORS VENTE</span>
          : <span className="cat-form-for" title="À qui le formulaire d’inscription propose cette offre">{audienceOnForm(offer)}</span>}
      </div>
      <div className="cat-card-head">
        <h3>{offer.name || "Sans nom"}</h3>
        <div className="cat-price">
          <b>{offer.price.toLocaleString("fr-FR")} DH</b>
          <small>/ {priceSuffix(offer)}</small>
        </div>
      </div>
      {offer.originalPrice != null && offer.originalPrice > offer.price && (
        <small className="cat-was">au lieu de {offer.originalPrice.toLocaleString("fr-FR")} DH</small>
      )}
      {offer.description && <p className="cat-desc">{offer.description}</p>}

      <div className="cat-volume">
        <strong>{total}</strong>
        <span>
          {unitWord(offer.unit, total).toUpperCase()}{offer.period === "mois" ? " / MOIS" : offer.period === "semaine" ? " / SEMAINE" : " AU TOTAL"}
          <small>
            {bonus ?? `${offer.quantity} ${unitWord(offer.unit, offer.quantity)} inclus${offer.unit === "sessions" ? "es" : ""}`}
            {offer.unit === "sessions" && offer.sessionMinutes ? ` · ${offer.sessionMinutes} min chacune` : ""}
          </small>
        </span>
      </div>

      {offer.basis === "groupe" && (
        <p className="cat-group">
          <UsersRound size={14} />
          <span>{offer.capacity || `${offer.people ?? "?"} personnes`}</span>
          {perPerson != null && <em>{perPerson.toLocaleString("fr-FR")} DH / pers.</em>}
        </p>
      )}

      {offer.extras.length > 0 && (
        <ul className="cat-extras">
          {offer.extras.map((extra, i) => <li key={i}><CheckCircle2 size={13} />{extra}</li>)}
        </ul>
      )}

      {saving && <div className="cat-saving"><ArrowDownRight size={14} />{saving}</div>}
      {offer.period !== "unique" && !saving && <div className="cat-saving"><Clock size={14} />Renouvelé chaque {offer.period === "mois" ? "mois" : "semaine"}</div>}

      {offer.audience && <p className="cat-audience"><b>PUBLIC</b>{offer.audience}</p>}
      {actions && <div className="cat-actions">{actions}</div>}
    </article>
  );
}
