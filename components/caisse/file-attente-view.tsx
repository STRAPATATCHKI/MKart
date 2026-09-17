"use client";

// LISTE D'ATTENTE — the caisse screen.
//
// Designed backwards from what a cashier does on a busy Saturday: find a booking fast, take
// the money in one tap, put the pilots in karts, and hand the operator a list to type into
// GoKarts. Every destructive-looking action is reversible; the only confirmation is on
// cancelling a reservation outright.
//
// Two honesty rules shaped it, the same ones as the chrono:
//   - a dead desk server must never look like an empty queue
//   - nothing claims money was taken unless the server said so

import { useMemo, useState } from "react";
import { useQueue, QUEUE_STATUS_LABELS, type Reservation, type QueueStatus } from "@/hooks/use-queue";
import { useKartMap } from "@/hooks/use-kart-map";
import { CopyButton } from "@/components/caisse/copy-button";
import { namesOnly, namesWithKarts, readableList } from "@/lib/clipboard";
import { TypistButton } from "@/components/caisse/typist-button";

const KART_COLOR_LABEL: Record<string, string> = { blue: "Bleu", black: "Noir", green: "Vert" };

export function FileAttenteView({ search }: { search: string }) {
  const q = useQueue();
  const { karts } = useKartMap();
  const [filter, setFilter] = useState<"EN_ATTENTE" | "PAYEE" | "TOUS">("EN_ATTENTE");
  const [operator, setOperator] = useState<string>(() => {
    try { return localStorage.getItem("megakart-caisse-operateur-v1") || ""; } catch { return ""; }
  });
  const [openCode, setOpenCode] = useState<string | null>(null);

  const saveOperator = (v: string) => {
    setOperator(v);
    try { localStorage.setItem("megakart-caisse-operateur-v1", v); } catch { /* ignore */ }
  };

  // Search normalises BOTH sides: typing 0612, 06 12 34 or +212 6 12 finds the same row.
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^(?:00)?212/, "0");
  const filtered = useMemo(() => {
    const qq = search.trim().toLowerCase();
    const qd = digits(search);
    return q.reservations
      .filter((r) => {
        if (filter === "EN_ATTENTE") return r.status === "EN_ATTENTE" || r.status === "AU_GUICHET";
        if (filter === "PAYEE") return r.status === "PAYEE" || r.status === "EN_PISTE";
        return true;
      })
      .filter((r) => {
        if (!qq) return true;
        if (qd && digits(r.phone).includes(qd)) return true;
        return (
          r.code.toLowerCase().includes(qq) ||
          r.contactName.toLowerCase().includes(qq) ||
          r.pilots.some((p) => p.fullName.toLowerCase().includes(qq))
        );
      })
      .sort((a, b) =>
        a.status === "EN_ATTENTE" && b.status === "EN_ATTENTE"
          ? a.createdAt.localeCompare(b.createdAt)      // a queue: first in, first served
          : b.createdAt.localeCompare(a.createdAt));
  }, [q.reservations, filter, search]);

  const waiting = q.reservations.filter((r) => r.status === "EN_ATTENTE" || r.status === "AU_GUICHET");
  const pilotsWaiting = waiting.reduce((n, r) => n + r.pilots.length, 0);
  const unpaid = waiting.length;

  // A session is usually several bookings put together, so the copy that matters most is
  // "every pilot who has paid and has a kart" — not one booking at a time.
  const readyPilots = q.reservations
    .filter((r) => r.status === "PAYEE")
    .flatMap((r) => r.pilots)
    .filter((p) => p.kartNumber != null);

  return (
    <div className="fa">
      <div className="page-heading">
        <div>
          <span className="eyebrow"><i /> FILE D’ATTENTE · ACCUEIL</span>
          <h1>Liste d’attente</h1>
          <p>Réservations reçues des téléphones et créations au guichet. Encaissez, attribuez les karts, puis saisissez la session dans GoKarts.</p>
        </div>
        <div className="fa-headline">
          <span className={`fa-sync is-${q.online ? "ok" : "bad"}`}>
            <i /> {q.online ? "Borne connectée" : "Borne injoignable"}
          </span>
        </div>
      </div>

      {!q.online && !q.loading && (
        <div className="fa-banner is-bad">
          La borne de réservation ne répond pas. Les lignes ci-dessous datent de la dernière
          synchronisation et les nouvelles réservations n’arrivent plus.
          <code>node tools/reservations/desk.mjs</code>
        </div>
      )}
      {q.error && q.online && <div className="fa-banner is-warn">{q.error}</div>}

      <div className="fa-tiles">
        <div><span>EN ATTENTE</span><strong>{unpaid}</strong><b>{pilotsWaiting} pilote{pilotsWaiting > 1 ? "s" : ""}</b></div>
        <div><span>PAYÉES</span><strong>{q.reservations.filter((r) => r.status === "PAYEE").length}</strong><b>prêtes à rouler</b></div>
        <div><span>ABSENTS</span><strong>{q.reservations.filter((r) => r.status === "ABSENT").length}</strong><b>non présentés</b></div>
        <div><span>TOTAL DU JOUR</span><strong>{q.reservations.length}</strong><b>réservations</b></div>
      </div>

      <div className="fa-toolbar">
        <div className="fa-filters" role="tablist">
          {([["EN_ATTENTE", "En attente"], ["PAYEE", "Payées"], ["TOUS", "Toutes"]] as const).map(([v, label]) => (
            <button key={v} type="button" className={filter === v ? "is-on" : ""} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="fa-toolbar-right">
          {readyPilots.length > 0 && (
            <div className="fa-session-copy">
              <span>{readyPilots.length} pilote{readyPilots.length > 1 ? "s" : ""} prêt{readyPilots.length > 1 ? "s" : ""}</span>
              <CopyButton
                label="Copier pour GoKarts"
                title="Tous les pilotes payés avec un kart, dans l’ordre des karts"
                text={namesOnly(readyPilots)}
              />
              <CopyButton
                label="+ karts"
                title="Nom + numéro de kart, séparés par une tabulation"
                text={namesWithKarts(readyPilots)}
              />
              <TypistButton pilots={readyPilots} />
            </div>
          )}
          <label className="fa-operator">
            Qui encaisse&nbsp;?
            <input
              type="text"
              maxLength={4}
              placeholder="YB"
              value={operator}
              onChange={(e) => saveOperator(e.target.value.toUpperCase())}
            />
          </label>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="fa-empty">
          {q.loading ? "Chargement…"
            : !q.online ? "Aucune donnée — la borne est injoignable."
            : filter === "EN_ATTENTE" ? "Personne en attente."
            : "Aucune réservation pour ce filtre."}
        </div>
      ) : (
        <div className="fa-list">
          {filtered.map((r) => (
            <Row
              key={r.id}
              r={r}
              karts={karts}
              operator={operator}
              open={openCode === r.code}
              onToggle={() => setOpenCode(openCode === r.code ? null : r.code)}
              onPay={(mode) => void q.pay(r.code, mode, operator || "CAISSE")}
              onUnpay={() => void q.unpay(r.code)}
              onStatus={(s) => void q.setStatus(r.code, s)}
              onKarts={(map) => void q.assignKarts(r.code, map)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ r, karts, operator, open, onToggle, onPay, onUnpay, onStatus, onKarts }: {
  r: Reservation;
  karts: Record<string, { transponder: string }>;
  operator: string;
  open: boolean;
  onToggle: () => void;
  onPay: (mode: Reservation["paymentMethod"]) => void;
  onUnpay: () => void;
  onStatus: (s: QueueStatus) => void;
  onKarts: (map: Record<string, number>) => void;
}) {
  const [assign, setAssign] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.pilots.map((p) => [p.id, p.kartNumber != null ? String(p.kartNumber) : ""])));

  const paid = r.status === "PAYEE" || r.status === "EN_PISTE" || r.status === "TERMINEE";
  const kartNumbers = Object.keys(karts).sort((a, b) => Number(a) - Number(b));
  const waitedMin = Math.max(0, Math.round((Date.now() - Date.parse(r.createdAt)) / 60000));

  // Masked by default: this screen faces the public at a counter.
  const maskedPhone = r.phone ? r.phone.replace(/^(\d{2})\d{4}(\d{4})$/, "$1 •• •• $2") : "—";

  return (
    <article className={`fa-row is-${r.status.toLowerCase()}`}>
      <div className="fa-main" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <div className="fa-code">
          <strong>{r.code}</strong>
          <span>{r.channel === "guichet" ? "guichet" : `il y a ${waitedMin} min`}</span>
        </div>

        <div className="fa-who">
          <strong>{r.contactName}</strong>
          <span>
            <a href={`tel:${r.phone}`} onClick={(e) => e.stopPropagation()}>{maskedPhone}</a>
            {r.email && <em> · {r.email}</em>}
          </span>
        </div>

        <div className="fa-pilots">
          {r.pilots.slice(0, 4).map((p) => (
            <span key={p.id} className={`fa-chip is-${p.kartColor}`}>
              {p.fullName.split(" ")[0]}
              {p.kartNumber != null && <b>K{p.kartNumber}</b>}
            </span>
          ))}
          {r.pilots.length > 4 && <span className="fa-chip">+{r.pilots.length - 4}</span>}
        </div>

        <div className="fa-pay">{r.paymentMethod}</div>
        <div className={`fa-status is-${r.status.toLowerCase()}`}>{QUEUE_STATUS_LABELS[r.status]}</div>

        <div className="fa-action" onClick={(e) => e.stopPropagation()}>
          {paid ? (
            <button type="button" className="fa-undo" onClick={onUnpay}>Corriger</button>
          ) : (
            <button type="button" className="fa-cash" onClick={() => onPay(r.paymentMethod)}>
              Encaisser · {r.paymentMethod === "Espèces" ? "ESP" : "CB"}
            </button>
          )}
        </div>
      </div>

      {open && (
        <div className="fa-detail">
          <div className="fa-detail-karts">
            <h4>Attribution des karts</h4>
            {kartNumbers.length === 0 ? (
              <p className="fa-hint">
                Aucun kart mappé. Renseignez d’abord le tableau kart ↔ transpondeur
                dans <strong>Sessions</strong>, sinon les noms ne s’afficheront pas en course.
              </p>
            ) : (
              <>
                {r.pilots.map((p) => (
                  <label key={p.id} className="fa-assign">
                    <span>{p.fullName}<em>{KART_COLOR_LABEL[p.kartColor] ?? p.kartColor}</em></span>
                    <select
                      value={assign[p.id] ?? ""}
                      onChange={(e) => setAssign({ ...assign, [p.id]: e.target.value })}
                    >
                      <option value="">— kart —</option>
                      {/* A kart already assigned but not yet in the equipment map must still
                          appear, otherwise the row silently reads as unassigned while the
                          GoKarts hand-off list shows a kart number. */}
                      {Array.from(new Set([...kartNumbers, assign[p.id]].filter(Boolean)))
                        .sort((a, b) => Number(a) - Number(b))
                        .map((k) => (
                          <option key={k} value={k}>
                            Kart {k}{kartNumbers.includes(k as string) ? "" : " (non mappé)"}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <button
                  type="button"
                  className="fa-primary"
                  onClick={() => {
                    const map: Record<string, number> = {};
                    for (const [id, v] of Object.entries(assign)) if (v) map[id] = Number(v);
                    onKarts(map);
                  }}
                >
                  Enregistrer les karts
                </button>
              </>
            )}
          </div>

          <div className="fa-detail-side">
            <h4>À saisir dans GoKarts</h4>
            {/* The operator types this into GoKarts by hand — the one step Apex still owns.
                Copy is offered in three shapes because we cannot know which one GoKarts'
                Delphi grid will accept until it is tried against the real window. */}
            <pre className="fa-gokarts">
              {r.pilots.every((p) => p.kartNumber == null)
                ? "Attribuez d’abord les karts."
                : readableList(r.pilots)}
            </pre>
            <div className="fa-copybar">
              <CopyButton
                label="Copier les noms"
                title="Un nom par ligne, dans l’ordre des karts — à coller dans la colonne Pilote"
                text={namesOnly(r.pilots)}
              />
              <CopyButton
                label="Noms + karts"
                title="Nom puis numéro de kart, séparés par une tabulation (deux colonnes)"
                text={namesWithKarts(r.pilots)}
              />
              <CopyButton
                label="Liste lisible"
                title="Kart → Nom, pour une note ou une impression"
                text={readableList(r.pilots)}
              />
            </div>

            <h4>Actions</h4>
            <div className="fa-more">
              <button type="button" onClick={() => onStatus("AU_GUICHET")}>Appeler au guichet</button>
              <button type="button" onClick={() => onStatus("ABSENT")}>Marquer absent</button>
              <button type="button" onClick={() => onStatus("EN_ATTENTE")}>Remettre en file</button>
              <button
                type="button"
                className="fa-danger"
                onClick={() => { if (confirm(`Annuler définitivement la réservation ${r.code} ?`)) onStatus("ANNULEE"); }}
              >
                Annuler la réservation
              </button>
            </div>
            {r.paidAt && (
              <p className="fa-hint">
                Encaissé à {new Date(r.paidAt).toLocaleTimeString("fr-FR")}
                {r.paidBy ? ` par ${r.paidBy}` : ""}{operator && r.paidBy !== operator ? "" : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
