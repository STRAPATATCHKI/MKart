"use client";

// Change a reservation's pack at the counter: the client tapped the wrong one, or a walk-in
// picks one now. Every offer on sale is listed - the ones meant for this many pilots first,
// then the rest, still selectable, because the cashier decides. The price shown is the
// catalog's for this group, and it is the desk that records it, never a number typed here.

import type { CSSProperties } from "react";
import { useCatalog } from "@/hooks/use-catalog";
import { groupRange, KIND_LABELS, KIND_ORDER, offerFits, offerTotal, priceSuffix, type Offer } from "@/lib/catalog";

export type ClientChoice = { id: string | null; label: string; total: number | null } | null;

function whyNot(o: Offer, pilots: number): string {
  const range = groupRange(o);
  if (range) return range.min === range.max ? `Prévu pour ${range.max} pilotes` : `Prévu pour ${range.min} à ${range.max} pilotes`;
  if (o.period !== "unique") return "Abonnement : pilote seul";
  return `Non prévu pour ${pilots} pilotes`;
}

export function PackPicker({ pilots, currentId, clientChoice, corrected, busy, onPick, onClose }: {
  pilots: number;
  currentId: string | null;
  clientChoice: ClientChoice;
  corrected: boolean;
  busy: boolean;
  onPick: (offerId: string | null) => void;
  onClose: () => void;
}) {
  const { catalog } = useCatalog();
  const rank = (o: Offer) => KIND_ORDER.indexOf(o.kind);
  const onSale = catalog.offers.filter((o) => o.enabled).sort((a, b) => rank(a) - rank(b));
  const fitting = onSale.filter((o) => offerFits(o, pilots));
  const others = onSale.filter((o) => !offerFits(o, pilots));

  const option = (o: Offer, fits: boolean) => {
    const total = offerTotal(o, pilots);
    return (
      <button key={o.id} type="button" disabled={busy}
        className={"fa-pack-opt" + (o.id === currentId ? " is-on" : "") + (fits ? "" : " is-other")}
        style={{ "--pack": o.color } as CSSProperties}
        onClick={() => onPick(o.id)}>
        <span>
          <b>{o.name}</b>
          <small>{KIND_LABELS[o.kind].badge} · {o.price.toLocaleString("fr-FR")} DH / {priceSuffix(o)}</small>
          {!fits && <em>{whyNot(o, pilots)}</em>}
        </span>
        <strong>{total != null ? `${total.toLocaleString("fr-FR")} DH` : "—"}</strong>
      </button>
    );
  };

  return (
    <div className="fa-detail fa-packpick" onClick={(e) => e.stopPropagation()}>
      <h4>Changer la formule · {pilots} pilote{pilots > 1 ? "s" : ""}</h4>
      {clientChoice && (
        <p className="fa-hint">
          Choix du client sur le téléphone : <b>{clientChoice.label}</b>
          {clientChoice.total != null ? ` · ${clientChoice.total} DH` : ""}
        </p>
      )}
      {onSale.length === 0 && <p className="fa-hint">Aucune formule en vente : ajoutez-en dans Packs &amp; ventes.</p>}
      {fitting.length > 0 && <div className="fa-packs">{fitting.map((o) => option(o, true))}</div>}
      {others.length > 0 && (
        <>
          <h5 className="fa-packs-title">Autres formules — pas prévues pour {pilots} pilote{pilots > 1 ? "s" : ""}</h5>
          <div className="fa-packs">{others.map((o) => option(o, false))}</div>
        </>
      )}
      <div className="fa-packpick-foot">
        {corrected && (
          <button type="button" className="fa-undo" disabled={busy} onClick={() => onPick(null)}>
            {clientChoice ? `Revenir au choix du client (${clientChoice.label})` : "Retirer la formule"}
          </button>
        )}
        <button type="button" className="fa-undo" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
