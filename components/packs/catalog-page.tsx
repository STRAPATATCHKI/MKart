"use client";

// PACKS & VENTES — the catalog, and the place it is edited.
//
// Read mode shows what is on sale, grouped by type. "Modifier le catalogue" turns every card
// into something editable: change, duplicate, reorder, take off sale, delete, or add a new one
// to any type. Every change is saved to the desk server at once, so the other pages - and the
// other screens - follow within a moment.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, EyeOff, Eye, Pencil, Plus, Settings2, Trash2 } from "lucide-react";
import { useCatalog } from "@/hooks/use-catalog";
import {
  blankOffer, KIND_LABELS, KIND_ORDER, newOfferId, onSale,
  type Catalog, type Offer, type OfferKind,
} from "@/lib/catalog";
import { OfferCard } from "./offer-card";
import { OfferEditor } from "./offer-editor";
import { SessionPrices } from "./session-prices";

export function CatalogPage() {
  const { catalog, source, saving, error, save, formSync } = useCatalog();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ offer: Offer; isNew: boolean } | null>(null);

  const live = onSale(catalog);
  const metrics = useMemo(() => {
    const prices = live.map((o) => o.price).filter((p) => p > 0);
    const groups = live.filter((o) => o.basis === "groupe");
    const monthly = live.filter((o) => o.period !== "unique");
    return {
      count: live.length,
      from: prices.length ? Math.min(...prices) : null,
      groups: groups.length,
      groupNames: groups.map((o) => o.name).join(" · "),
      monthly: monthly.length,
    };
  }, [live]);

  const commit = async (offers: Offer[]) => save({ ...catalog, offers } as Catalog);

  const saveDraft = async (offer: Offer) => {
    const clean = { ...offer, extras: offer.extras.map((e) => e.trim()).filter(Boolean) };
    const exists = catalog.offers.some((o) => o.id === clean.id);
    const offers = exists ? catalog.offers.map((o) => (o.id === clean.id ? clean : o)) : [...catalog.offers, clean];
    if (await commit(offers)) setDraft(null);
  };

  /** Swap with the neighbouring offer of the same type, so the arrows move a card within its row. */
  const move = (id: string, dir: -1 | 1) => {
    const list = [...catalog.offers];
    const i = list.findIndex((o) => o.id === id);
    if (i < 0) return;
    let j = i + dir;
    while (j >= 0 && j < list.length && list[j].kind !== list[i].kind) j += dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    void commit(list);
  };

  const remove = (offer: Offer) => {
    if (!window.confirm(`Supprimer définitivement « ${offer.name} » du catalogue ?\n\nPour la retirer temporairement, utilisez plutôt « Retirer de la vente ».`)) return;
    void commit(catalog.offers.filter((o) => o.id !== offer.id));
  };

  // Simple session prices always show, even empty: they are the first thing a walk-in asks.
  const kinds = KIND_ORDER.filter((k) => k === "session" || editing || catalog.offers.some((o) => o.kind === k && o.enabled));
  const saveSessions = (next: Offer[]) => commit([...catalog.offers.filter((o) => o.kind !== "session"), ...next]);

  return (
    <div className="commerce-page">
      <header className="commerce-hero packs-hero">
        <div className="commerce-hero-copy">
          <span className="eyebrow"><i /> PACKS & VENTES</span>
          <h1>Plus vous roulez.<br /><em>Plus vous économisez.</em></h1>
          <p>Packs individuels, offres famille et amis, abonnements, tarifs à la session — modifiables ici.</p>
        </div>
        <div className="commerce-hero-metrics">
          <span><small>OFFRES EN VENTE</small><strong>{String(metrics.count).padStart(2, "0")}</strong><b>{metrics.monthly} abonnement{metrics.monthly > 1 ? "s" : ""}</b></span>
          <span><small>À PARTIR DE</small><strong>{metrics.from != null ? `${metrics.from.toLocaleString("fr-FR")} DH` : "—"}</strong><b>tous types confondus</b></span>
          <span><small>OFFRES GROUPE</small><strong>{String(metrics.groups).padStart(2, "0")}</strong><b>{metrics.groupNames || "aucune"}</b></span>
        </div>
      </header>

      <div className="cat-toolbar">
        <button type="button" className={editing ? "primary-button" : "secondary-button"} onClick={() => setEditing((e) => !e)}>
          <Settings2 size={15} /> {editing ? "Terminer les modifications" : "Modifier le catalogue"}
        </button>
        {editing && (
          <button type="button" className="secondary-button" onClick={() => setDraft({ offer: blankOffer("individuel"), isNew: true })}>
            <Plus size={15} /> Nouvelle offre
          </button>
        )}
        <span className={"cat-status" + (error ? " is-bad" : source === "readonly" ? " is-warn" : "")}>
          {error
            ?? (saving ? "Enregistrement…"
              : source === "readonly" ? "Lecture seule : redémarrez le serveur d’accueil (restart-desk.bat) pour pouvoir enregistrer."
              : source === "seed" ? "Catalogue par défaut — votre première modification le crée sur le poste d’accueil."
              : source === "desk" ? `Enregistré sur le poste d’accueil${catalog.savedAt ? ` · ${new Date(catalog.savedAt).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}${formSync ? ` · ${formSync}` : ""}`
              : "Chargement…")}
        </span>
      </div>

      {kinds.map((kind) => {
        if (kind === "session") {
          return (
            <section key={kind} className="commerce-section">
              <div className="commerce-section-head">
                <div><span>{KIND_LABELS[kind].badge}</span><h2>{KIND_LABELS[kind].title}</h2></div>
                <p>{KIND_LABELS[kind].lead}</p>
              </div>
              <SessionPrices offers={catalog.offers.filter((o) => o.kind === "session")} editing={editing} saving={saving} onSave={saveSessions} />
            </section>
          );
        }
        const offers = catalog.offers.filter((o) => o.kind === kind && (editing || o.enabled));
        return (
          <section key={kind} className="commerce-section">
            <div className="commerce-section-head">
              <div><span>{KIND_LABELS[kind].badge}</span><h2>{KIND_LABELS[kind].title}</h2></div>
              <p>{KIND_LABELS[kind].lead}</p>
            </div>
            <div className="cat-grid">
              {offers.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  dimmed={!offer.enabled}
                  actions={editing ? (
                    <>
                      <button type="button" onClick={() => setDraft({ offer: { ...offer, extras: [...offer.extras] }, isNew: false })}><Pencil size={14} /> Modifier</button>
                      <button type="button" onClick={() => setDraft({ offer: { ...offer, id: newOfferId(), name: `${offer.name} (copie)`.slice(0, 40), extras: [...offer.extras] }, isNew: true })} title="Dupliquer"><Copy size={14} /></button>
                      <button type="button" onClick={() => move(offer.id, -1)} title="Monter"><ArrowUp size={14} /></button>
                      <button type="button" onClick={() => move(offer.id, 1)} title="Descendre"><ArrowDown size={14} /></button>
                      <button type="button" onClick={() => void commit(catalog.offers.map((o) => (o.id === offer.id ? { ...o, enabled: !o.enabled } : o)))}
                        title={offer.enabled ? "Retirer de la vente" : "Remettre en vente"}>
                        {offer.enabled ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                      <button type="button" className="is-danger" onClick={() => remove(offer)} title="Supprimer"><Trash2 size={14} /></button>
                    </>
                  ) : undefined}
                />
              ))}
              {editing && (
                <button type="button" className="cat-add" onClick={() => setDraft({ offer: blankOffer(kind as OfferKind), isNew: true })}>
                  <Plus size={22} />
                  <span>Ajouter {kind === "abonnement" ? "un abonnement" : kind === "famille" ? "un pack famille" : kind === "amis" ? "un pack amis" : "une offre"}</span>
                </button>
              )}
              {!editing && offers.length === 0 && <p className="cat-empty">Aucune offre en vente.</p>}
            </div>
          </section>
        );
      })}

      {draft && (
        <OfferEditor
          key={draft.offer.id}
          initial={draft.offer}
          isNew={draft.isNew}
          saving={saving}
          onCancel={() => setDraft(null)}
          onSave={(offer) => void saveDraft(offer)}
        />
      )}
    </div>
  );
}

/** For pages that only show offers: what is on sale, filtered. */
export function useOffersOnSale(filter?: (o: Offer) => boolean): Offer[] {
  const { catalog } = useCatalog();
  return onSale(catalog, filter);
}

