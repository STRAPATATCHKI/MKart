"use client";

// "+ Rejouer": a client who has raced wants another go. Find them by name, keep the whole group
// or tick only the pilots racing again, choose the pack, and they are back in "En attente" as a
// new reservation. The first race and its payment are left exactly as they were.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, RotateCcw, Search, X } from "lucide-react";
import { QUEUE_STATUS_LABELS, type Reservation } from "@/hooks/use-queue";
import { useCatalog } from "@/hooks/use-catalog";
import { offerTotal } from "@/lib/catalog";
import { PackPicker } from "@/components/caisse/pack-picker";
import * as rules from "@/lib/queue-replay.mjs";

const replayMatches = (list: Reservation[], query: string, clientCodeOf: (code: string) => string | null | undefined): Reservation[] =>
  rules.replayMatches(list, query, clientCodeOf);
const alreadyWaiting = (list: Reservation[], fullName: string): Reservation | null => rules.alreadyWaiting(list, fullName);

function when(iso: string): string {
  const d = new Date(iso);
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return `aujourd’hui ${hm}`;
  return `${d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} · ${hm}`;
}

export function ReplayDialog({ reservations, clientCodeOf, packOf, by, onReplay, onDone, onClose }: {
  reservations: Reservation[];
  clientCodeOf: (code: string) => string | null | undefined;
  /** What they took last time, for the result list. */
  packOf: (r: Reservation) => string | null;
  by: string;
  /** The new reservation, or why it was not created. */
  onReplay: (code: string, input: { pilotIds: string[]; offerId: string | null; by: string; clientCode: string | null }) => Promise<Reservation | string>;
  onDone: (created: Reservation) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [racing, setRacing] = useState<Set<string>>(new Set());
  const [offerId, setOfferId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { catalog } = useCatalog();

  const results = useMemo(() => replayMatches(reservations, query, clientCodeOf), [reservations, query, clientCodeOf]);
  const picked = pickedCode ? reservations.find((r) => r.code === pickedCode) ?? null : null;
  const chosen = picked ? picked.pilots.filter((p) => racing.has(p.id)) : [];
  const offer = offerId ? catalog.offers.find((o) => o.id === offerId) ?? null : null;
  const total = offer && chosen.length ? offerTotal(offer, chosen.length) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (r: Reservation) => {
    setPickedCode(r.code);
    setRacing(new Set(r.pilots.map((p) => p.id)));
    setOfferId(null);
    setFailed(null);
  };
  const back = () => {
    setPickedCode(null);
    setFailed(null);
    window.setTimeout(() => searchRef.current?.focus(), 0);
  };
  const toggle = (id: string) => {
    const next = new Set(racing);
    if (next.has(id)) next.delete(id); else next.add(id);
    setRacing(next);
  };
  const whole = picked != null && chosen.length === picked.pilots.length;

  const submit = async () => {
    if (!picked || !chosen.length) return;
    setBusy(true);
    setFailed(null);
    const created = await onReplay(picked.code, {
      pilotIds: whole ? [] : chosen.map((p) => p.id),
      offerId, by, clientCode: clientCodeOf(picked.code) ?? null,
    });
    setBusy(false);
    if (typeof created === "string") setFailed(created);
    else onDone(created);
  };

  return (
    <div className="fa-modal" role="dialog" aria-modal="true" aria-label="Rejouer" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fa-modal-box">
        <header className="fa-modal-head">
          <div>
            <span>NOUVELLE COURSE</span>
            <h2>{picked ? `Rejouer — ${picked.contactName}` : "Un client veut rejouer"}</h2>
          </div>
          <button type="button" className="fa-modal-x" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        </header>

        {!picked ? (
          <div className="fa-modal-body">
            <label className="fa-replay-search">
              <Search size={16} />
              <input ref={searchRef} type="text" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Nom du pilote ou de la réservation, code, téléphone…" aria-label="Rechercher un client" />
            </label>
            <h5 className="fa-packs-title">{query.trim() ? `${results.length} résultat${results.length > 1 ? "s" : ""}` : "Dernières réservations"}</h5>
            {results.length === 0 ? (
              <p className="fa-hint">Personne à ce nom. Essayez le prénom seul, ou le code (ex. KYRW, MK-3108).</p>
            ) : (
              <div className="fa-replay-list">
                {results.map((r) => {
                  const clientCode = clientCodeOf(r.code) ?? r.replayOf?.clientCode ?? null;
                  const pack = packOf(r);
                  return (
                    <button key={r.id} type="button" className="fa-replay-item" onClick={() => pick(r)}>
                      <span className="fa-replay-code">
                        <b>{clientCode ?? r.code}</b>
                        <small>{clientCode ? r.code : r.channel === "guichet" ? "guichet" : "en ligne"}</small>
                      </span>
                      <span className="fa-replay-who">
                        <b>{r.contactName}</b>
                        <small>{when(r.createdAt)} · {QUEUE_STATUS_LABELS[r.status]}{pack ? ` · ${pack}` : ""}{typeof r.paidAmount === "number" ? ` · ${r.paidAmount} DH` : ""}</small>
                      </span>
                      <span className="fa-replay-pilots">
                        {r.pilots.slice(0, 4).map((p) => <span key={p.id} className={`fa-chip is-${p.kartColor}`}>{p.fullName.split(" ")[0]}</span>)}
                        {r.pilots.length > 4 && <span className="fa-chip">+{r.pilots.length - 4}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="fa-modal-body">
            <button type="button" className="fa-replay-back" onClick={back}><ArrowLeft size={14} /> Autre client</button>

            <div className="fa-replay-block">
              <div className="fa-replay-block-head">
                <h4>Qui refait une course ?</h4>
                {picked.pilots.length > 1 && (
                  <button type="button" className={`fa-replay-all${whole ? " is-on" : ""}`}
                    onClick={() => setRacing(new Set(whole ? [] : picked.pilots.map((p) => p.id)))}>
                    {whole ? "Tout le groupe" : `Tout le groupe (${picked.pilots.length})`}
                  </button>
                )}
              </div>
              <div className="fa-replay-pilotlist">
                {picked.pilots.map((p) => {
                  const on = racing.has(p.id);
                  const waiting = alreadyWaiting(reservations, p.fullName);
                  return (
                    <button key={p.id} type="button" className={`fa-replay-pilot${on ? " is-on" : ""}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                      <i>{on && <Check size={13} strokeWidth={3} />}</i>
                      <span>
                        <b>{p.fullName}</b>
                        {waiting && <em>déjà en attente · {waiting.code}</em>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {chosen.length > 0 && (
              <PackPicker
                title="Formule pour cette course"
                pilots={chosen.length}
                currentId={offerId}
                clientChoice={null}
                corrected={false}
                busy={busy}
                onPick={(id) => setOfferId(id === offerId ? null : id)}
              />
            )}

            {failed && <p className="fa-replay-err">{failed}</p>}
            <div className="fa-replay-foot">
              <span>
                {chosen.length === 0 ? "Cochez au moins un pilote."
                  : `${chosen.length} pilote${chosen.length > 1 ? "s" : ""}${offer ? ` · ${offer.name}${total != null ? ` · ${total} DH` : ""}` : " · formule à choisir au guichet"}`}
              </span>
              <button type="button" className="fa-cash" disabled={busy || chosen.length === 0} onClick={() => void submit()}>
                <RotateCcw size={15} /> {busy ? "Enregistrement…" : "Remettre en attente"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
