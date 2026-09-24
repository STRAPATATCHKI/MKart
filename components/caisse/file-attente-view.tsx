"use client";

// LISTE D'ATTENTE — the caisse screen.
//
// Designed backwards from what a cashier does on a busy Saturday: find a booking fast, fix the
// pack if the client chose the wrong one, take the money in one tap and put the pilots in
// karts. Races are timed by MegaKart Timing Control, so nothing is handed to GoKarts any more.
// Every destructive-looking action is reversible: deleting goes to "Supprimées".
//
// Two honesty rules shaped it, the same ones as the chrono:
//   - a dead desk server must never look like an empty queue
//   - nothing claims money was taken unless the server said so

import { useEffect, useMemo, useState } from "react";
import { useQueue, QUEUE_STATUS_LABELS, type Reservation, type QueueStatus } from "@/hooks/use-queue";
import { useKartMap } from "@/hooks/use-kart-map";
import { useTimingKarts } from "@/hooks/use-timing-karts";
import { useSignups } from "@/hooks/use-signups";
import { signupPlayers, type Signup } from "@/lib/bridge-client";
import { PackPicker, type ClientChoice } from "@/components/caisse/pack-picker";
import { codesFrom, DELETE_PRESSES, findByCode, nextPress, PRESS_WINDOW_MS, type PressState } from "@/lib/queue-delete";

const KART_COLOR_LABEL: Record<string, string> = { blue: "Bleu", black: "Noir", green: "Vert" };

export function FileAttenteView({ search }: { search: string }) {
  const q = useQueue();
  // Two services each hold a kart table: the bridge's older copy and Timing Control's, which
  // is the one the KARTS tab writes and therefore the real fleet. Offer the union, so the
  // cashier can seat a pilot whichever service happens to be running.
  const { karts: bridgeKarts } = useKartMap();
  const { karts: chronoKarts } = useTimingKarts();
  const karts = useMemo(
    () => ({ ...bridgeKarts, ...chronoKarts }),
    [bridgeKarts, chronoKarts],
  );
  // The pack the client chose lives on the sign-up, which carries the queue code the desk gave
  // it - and so does the short code the phone showed the client ("AZSM"), which is what they
  // read out at the counter. A pack corrected at the counter lives on the reservation itself.
  const { signups } = useSignups();
  const signupByQueue = useMemo(() => {
    const map = new Map<string, Signup>();
    for (const signup of signups) if (signup.queueCode) map.set(signup.queueCode, signup);
    return map;
  }, [signups]);
  const [filter, setFilter] = useState<"EN_ATTENTE" | "PAYEE" | "TOUS" | "SUPPRIMEES">("EN_ATTENTE");
  // Quick delete: the row under the mouse (or the one open) takes the D presses.
  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [press, setPress] = useState<PressState>(null);
  const [undo, setUndo] = useState<string[] | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeMsg, setCodeMsg] = useState<string | null>(null);
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
        if (filter === "SUPPRIMEES") return r.status === "SUPPRIMEE";
        return r.status !== "SUPPRIMEE";
      })
      .filter((r) => {
        if (!qq) return true;
        if (qd && digits(r.phone).includes(qd)) return true;
        return (
          r.code.toLowerCase().includes(qq) ||
          (signupByQueue.get(r.code)?.code ?? "").toLowerCase().includes(qq) ||
          r.contactName.toLowerCase().includes(qq) ||
          r.pilots.some((p) => p.fullName.toLowerCase().includes(qq))
        );
      })
      .sort((a, b) =>
        filter === "SUPPRIMEES"
          ? (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "")   // the bin: last deleted first
          : a.status === "EN_ATTENTE" && b.status === "EN_ATTENTE"
          ? a.createdAt.localeCompare(b.createdAt)      // a queue: first in, first served
          : b.createdAt.localeCompare(a.createdAt));
  }, [q.reservations, filter, search, signupByQueue]);

  const waiting = q.reservations.filter((r) => r.status === "EN_ATTENTE" || r.status === "AU_GUICHET");
  const pilotsWaiting = waiting.reduce((n, r) => n + r.pilots.length, 0);
  const unpaid = waiting.length;

  const deletedCount = q.reservations.filter((r) => r.status === "SUPPRIMEE").length;
  const activeCount = q.reservations.length - deletedCount;
  const by = operator || "CAISSE";

  const deleteCodes = async (codes: string[]) => {
    for (const code of codes) await q.remove(code, by);
    if (openCode && codes.includes(openCode)) setOpenCode(null);
    setUndo(codes);
  };
  const undoDelete = async () => {
    const codes = undo ?? [];
    setUndo(null);
    for (const code of codes) await q.restore(code);
  };

  const submitCodes = (e: React.FormEvent) => {
    e.preventDefault();
    const found: string[] = [];
    const missing: string[] = [];
    for (const token of codesFrom(codeInput)) {
      const r = findByCode(q.reservations, (code) => signupByQueue.get(code)?.code, token);
      if (r) { if (!found.includes(r.code)) found.push(r.code); } else missing.push(token);
    }
    if (found.length) void deleteCodes(found);
    setCodeMsg(missing.length ? `Introuvable : ${missing.join(", ")}` : null);
    setCodeInput("");
  };

  // D pressed five times on a row sends it to Supprimées. Never while typing in a field (a
  // name with a "d" in the search box must not count), never on a held-down key.
  const target = hoverCode ?? openCode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "d" && e.key !== "D") return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const r = target ? q.reservations.find((x) => x.code === target) : null;
      if (!r || r.status === "SUPPRIMEE") return;
      const next = nextPress(press, r.code, Date.now());
      if (next.count >= DELETE_PRESSES) {
        setPress(null);
        void deleteCodes([r.code]);
        return;
      }
      setPress(next);
      window.setTimeout(() => setPress((cur) => (cur && cur.at === next.at ? null : cur)), PRESS_WINDOW_MS + 100);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // The undo offer stays a few seconds, then the bin is the way back.
  useEffect(() => {
    if (!undo) return;
    const t = window.setTimeout(() => setUndo(null), 8000);
    return () => window.clearTimeout(t);
  }, [undo]);

  return (
    <div className="fa">
      <div className="page-heading">
        <div>
          <span className="eyebrow"><i /> FILE D’ATTENTE · ACCUEIL</span>
          <h1>Liste d’attente</h1>
          <p>Réservations reçues des téléphones et créations au guichet. Vérifiez la formule, encaissez, puis attribuez les karts.</p>
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
        <div><span>TOTAL DU JOUR</span><strong>{activeCount}</strong><b>réservations{deletedCount ? ` · ${deletedCount} supprimée${deletedCount > 1 ? "s" : ""}` : ""}</b></div>
      </div>

      <div className="fa-toolbar">
        <div className="fa-filters" role="tablist">
          {([["EN_ATTENTE", "En attente"], ["PAYEE", "Payées"], ["TOUS", "Toutes"],
             ["SUPPRIMEES", deletedCount ? `Supprimées (${deletedCount})` : "Supprimées"]] as const).map(([v, label]) => (
            <button key={v} type="button" className={filter === v ? "is-on" : ""} onClick={() => setFilter(v)}>
              {label}
            </button>
          ))}
        </div>
        <div className="fa-toolbar-right">
          <form className="fa-delcode" onSubmit={submitCodes}
            title="Code de la réservation (MK-6149 ou 6149) ou code client (AZSM). Plusieurs codes : séparez-les par un espace. Astuce : survolez une ligne et tapez D cinq fois.">
            <input type="text" value={codeInput} placeholder="Code à supprimer" aria-label="Code à supprimer"
              onChange={(e) => { setCodeInput(e.target.value); setCodeMsg(null); }} />
            <button type="submit" disabled={!codeInput.trim()}>Supprimer</button>
            {codeMsg && <small>{codeMsg}</small>}
          </form>
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
            : filter === "SUPPRIMEES" ? "Aucune réservation supprimée. Survolez une ligne et tapez D ×5, ou entrez son code."
            : "Aucune réservation pour ce filtre."}
        </div>
      ) : (
        <div className="fa-list">
          {filtered.map((r) => (
            <Row
              key={r.id}
              r={r}
              karts={karts}
              pack={packView(r, signupByQueue.get(r.code))}
              clientCode={signupByQueue.get(r.code)?.code ?? null}
              clientChoice={clientChoice(signupByQueue.get(r.code))}
              onSetPack={(offerId) => q.setPack(r.code, offerId, operator || "CAISSE")}
              open={openCode === r.code}
              onToggle={() => setOpenCode(openCode === r.code ? null : r.code)}
              onPay={(mode, amount, split) => void q.pay(r.code, mode, operator || "CAISSE", amount, split)}
              onUnpay={() => void q.unpay(r.code)}
              onStatus={(s) => void q.setStatus(r.code, s)}
              onKarts={(map) => void q.assignKarts(r.code, map)}
              presses={press && press.code === r.code ? press.count : 0}
              onHover={(on) => setHoverCode((cur) => (on ? r.code : cur === r.code ? null : cur))}
              onRemove={() => void deleteCodes([r.code])}
              onRestore={() => void q.restore(r.code)}
              onErase={() => void q.erase(r.code)}
            />
          ))}
        </div>
      )}

      {undo && (
        <div className="fa-toast" role="status">
          <span>{undo.join(", ")} {undo.length > 1 ? "envoyées" : "envoyée"} dans Supprimées</span>
          <button type="button" onClick={() => void undoDelete()}>Annuler</button>
        </div>
      )}
    </div>
  );
}

type PackView = {
  id: string | null;
  label: string;
  total: number | null;
  /** Per-pilot price, for "250×2"; null for a group price, which is not multiplied. */
  unit: number | null;
  pilots: number;
  /** Changed at the counter rather than chosen by the client. */
  corrected: boolean;
  /** False when the cashier chose an offer meant for another group size. */
  fits: boolean;
};

function packView(r: Reservation, signup: Signup | undefined): PackView | null {
  const o = r.packOverride;
  if (o) {
    return {
      id: o.id, label: o.basis === "groupe" ? `${o.label} · forfait groupe` : o.label, total: o.total,
      unit: o.basis === "groupe" ? null : o.price, pilots: o.pilots, corrected: true, fits: o.fits,
    };
  }
  if (!signup?.packLabel) return null;
  const group = signup.packBasis === "groupe";
  return {
    id: signup.pack ?? null,
    label: group ? `${signup.packLabel} · forfait groupe` : signup.packLabel,
    total: signup.packTotalMad ?? null,
    unit: group ? null : signup.packPriceMad ?? null,
    pilots: signupPlayers(signup).length,
    corrected: false, fits: true,
  };
}

/** What the phone showed the client: the pack and the amount "à régler à l'accueil". */
function clientChoice(signup: Signup | undefined): ClientChoice {
  if (!signup?.packLabel) return null;
  return { id: signup.pack ?? null, label: signup.packLabel, total: signup.packTotalMad ?? null };
}

function Row({ r, karts, pack, clientCode, clientChoice, onSetPack, open, onToggle, onPay, onUnpay, onStatus, onKarts,
                presses, onHover, onRemove, onRestore, onErase }: {
  r: Reservation;
  karts: Record<string, { transponder: string }>;
  pack: PackView | null;
  clientCode: string | null;
  clientChoice: ClientChoice;
  onSetPack: (offerId: string | null) => Promise<void>;
  open: boolean;
  onToggle: () => void;
  onPay: (mode: Reservation["paymentMethod"], amount: number | null, split?: { cash: number; card: number } | null) => void;
  onUnpay: () => void;
  onStatus: (s: QueueStatus) => void;
  onKarts: (map: Record<string, number>) => void;
  /** D presses so far towards deleting this row (0 when none). */
  presses: number;
  onHover: (on: boolean) => void;
  onRemove: () => void;
  onRestore: () => void;
  onErase: () => void;
}) {
  const [assign, setAssign] = useState<Record<string, string>>(() =>
    Object.fromEntries(r.pilots.map((p) => [p.id, p.kartNumber != null ? String(p.kartNumber) : ""])));
  // Taking money is the one irreversible-feeling step at the counter, so it asks: the amount
  // and the pack in front of the cashier, and the method chosen deliberately rather than
  // inherited from whatever the client tapped on their phone.
  const [cashing, setCashing] = useState(false);
  // The amount collected, prefilled from the pack and editable: a discount given at the counter,
  // or a walk-in with no pack, is still money that has to be counted exactly.
  const [amount, setAmount] = useState<string>("");
  const amountValue = amount.trim() === "" ? null : Number(amount);
  const amountOk = amountValue != null && Number.isFinite(amountValue) && amountValue >= 0 && amountValue <= 100000;
  // Against the pack's price: a discount (or a supplement) is shown, never silent.
  const priceDiff = amountOk && pack?.total != null ? amountValue! - pack.total : 0;
  const openCashing = () => { setAmount(pack?.total != null ? String(pack.total) : ""); setSplitting(false); setPicking(false); setCashing(true); };
  // Paid two ways: the cash part is typed, the card part follows as the rest of the amount
  // (and can be typed too). Both parts must be above zero.
  const [splitting, setSplitting] = useState(false);
  const [splitCash, setSplitCash] = useState("");
  const [splitCard, setSplitCard] = useState("");
  const [cardTyped, setCardTyped] = useState(false);
  const digitsOnly = (v: string) => v.replace(/\D/g, "");
  const startSplit = () => {
    setSplitting(true);
    setSplitCash("");
    setSplitCard(amountOk ? String(amountValue) : "");
    setCardTyped(false);
  };
  const cashPart = Number(splitCash || 0);
  const cardPart = Number(splitCard || 0);
  const splitOk = cashPart > 0 && cardPart > 0 && cashPart + cardPart <= 100000;
  const onSplitCash = (v: string) => {
    const cash = digitsOnly(v);
    setSplitCash(cash);
    if (!cardTyped && amountOk) setSplitCard(String(Math.max(0, amountValue! - Number(cash || 0))));
  };
  const [picking, setPicking] = useState(false);
  const [pickBusy, setPickBusy] = useState(false);
  const pick = async (offerId: string | null) => {
    setPickBusy(true);
    try { await onSetPack(offerId); setPicking(false); } finally { setPickBusy(false); }
  };

  const paid = r.status === "PAYEE" || r.status === "EN_PISTE" || r.status === "TERMINEE";
  const deleted = r.status === "SUPPRIMEE";
  const hhmm = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "");
  const kartNumbers = Object.keys(karts).sort((a, b) => Number(a) - Number(b));
  const waitedMin = Math.max(0, Math.round((Date.now() - Date.parse(r.createdAt)) / 60000));

  // Masked by default: this screen faces the public at a counter.
  const maskedPhone = r.phone ? r.phone.replace(/^(\d{2})\d{4}(\d{4})$/, "$1 •• •• $2") : "—";

  return (
    <article className={`fa-row is-${r.status.toLowerCase()}${presses ? " is-pressing" : ""}`}
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {presses > 0 && (
        <span className="fa-dpress" aria-live="polite">
          Suppression · {Array.from({ length: DELETE_PRESSES }, (_, i) => <i key={i} className={i < presses ? "on" : ""} />)}
          <b>encore D ×{DELETE_PRESSES - presses}</b>
        </span>
      )}
      <div className="fa-main" onClick={onToggle} role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } }}>
        <div className="fa-code">
          {clientCode ? (
            <>
              {/* The code the phone showed after the inscription: what the client reads out. */}
              <strong className="fa-client-code" title="Code affiché au client après l’inscription">{clientCode}</strong>
              <span>{r.code} · {deleted ? `supprimée ${hhmm(r.deletedAt)}` : `il y a ${waitedMin} min`}</span>
            </>
          ) : (
            <>
              <strong>{r.code}</strong>
              <span>{deleted ? `supprimée ${hhmm(r.deletedAt)}` : r.channel === "guichet" ? "guichet" : `il y a ${waitedMin} min`}</span>
            </>
          )}
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

        <div className="fa-pay">
          {paid && typeof r.paidAmount === "number" ? (
            <>
              {/* Once paid, the money that was actually taken - not the pack's price, which a
                  discount at the counter may have changed. */}
              <strong style={{ display: "block", color: "#d8ff35" }}>{r.paidAmount} DH</strong>
              <span style={{ fontSize: 11, opacity: 0.8 }}>
                {r.paidSplit ? `Esp. ${r.paidSplit.cash} + Carte ${r.paidSplit.card}` : r.paymentMethod === "Espèces" ? "Espèces" : "Carte"}
                {pack ? ` · ${pack.label}` : ""}
              </span>
              {pack?.total != null && pack.total !== r.paidAmount && (
                <em className="fa-pack-was" title="Prix de la formule">tarif {pack.total} DH</em>
              )}
            </>
          ) : pack ? (
            <>
              <strong style={{ display: "block", color: "#d8ff35" }}>
                {pack.total != null ? `${pack.total} DH` : "—"}
              </strong>
              <span style={{ fontSize: 11, opacity: 0.8 }}>
                {pack.label}
                {pack.unit != null && pack.pilots > 1 ? ` · ${pack.unit}×${pack.pilots}` : ""}
              </span>
              {pack.corrected && clientChoice && (
                <em className="fa-pack-was" title="Ce que le téléphone a affiché au client">
                  client : {clientChoice.label}{clientChoice.total != null ? ` · ${clientChoice.total} DH` : ""}
                </em>
              )}
              {pack.corrected && !pack.fits && <em className="fa-pack-warn">hors taille du groupe</em>}
            </>
          ) : (
            <span style={{ opacity: 0.7 }}>{r.paymentMethod}<br /><em style={{ fontSize: 11 }}>pas de formule</em></span>
          )}
          {!paid && !deleted && (
            <button type="button" className="fa-pack-edit"
              onClick={(e) => { e.stopPropagation(); setCashing(false); setPicking((v) => !v); }}>
              {pack ? "Changer" : "Choisir une formule"}
            </button>
          )}
        </div>
        <div className={`fa-status is-${r.status.toLowerCase()}`}>{QUEUE_STATUS_LABELS[r.status]}</div>

        <div className="fa-action" onClick={(e) => e.stopPropagation()}>
          {deleted ? (
            <button type="button" className="fa-undo" onClick={onRestore}
              title={r.deletedFrom ? `Revient en « ${QUEUE_STATUS_LABELS[r.deletedFrom]} »` : undefined}>Restaurer</button>
          ) : paid ? (
            <button type="button" className="fa-undo" onClick={onUnpay}>Corriger</button>
          ) : (
            <button type="button" className="fa-cash" onClick={openCashing}>
              Encaisser{pack?.total != null ? ` · ${pack.total} DH` : ` · ${r.paymentMethod === "Espèces" ? "ESP" : "CB"}`}
            </button>
          )}
        </div>
      </div>

      {picking && !paid && (
        <PackPicker
          pilots={Math.max(1, r.pilots.length)}
          currentId={pack?.id ?? null}
          clientChoice={clientChoice}
          corrected={!!pack?.corrected}
          busy={pickBusy}
          onPick={(offerId) => void pick(offerId)}
          onClose={() => setPicking(false)}
        />
      )}

      {cashing && (
        <div className="fa-detail" onClick={(e) => e.stopPropagation()}>
          <h4>Encaisser {r.code} — {r.contactName}</h4>
          <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                          padding: "12px 14px", borderRadius: 10, background: "rgba(216,255,53,.08)",
                          border: "1px solid rgba(216,255,53,.35)" }}>
              <span>
                {pack ? pack.label : "Aucune formule choisie"}
                {pack?.unit != null && (
                  <em style={{ display: "block", fontSize: 12, opacity: 0.75 }}>
                    {pack.unit} DH × {pack.pilots} pilote{pack.pilots > 1 ? "s" : ""}
                  </em>
                )}
              </span>
              <strong style={{ fontSize: 26, color: "#d8ff35", textAlign: "right" }}>
                {amountOk ? `${amountValue} DH` : pack?.total != null ? `${pack.total} DH` : "—"}
                {priceDiff !== 0 && (
                  <em style={{ display: "block", fontSize: 12, fontStyle: "normal", fontWeight: 700, color: "#f5b83d" }}>
                    tarif {pack!.total} DH · {priceDiff < 0 ? `remise ${priceDiff}` : `supplément +${priceDiff}`} DH
                  </em>
                )}
              </strong>
            </div>
            <label style={{ display: "grid", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#8aa0b6" }}>Montant encaissé (DH) :</span>
              {/* Text, not type="number": a focused number field changes value under the mouse
                  wheel, so scrolling down to "Espèces" could turn 250 into 210 unseen. */}
              <input type="text" inputMode="numeric" autoComplete="off" value={amount} autoFocus maxLength={6}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                style={{ padding: "10px 12px", borderRadius: 8, fontSize: 18, fontWeight: 800, background: "#0e1520", color: "#e8eef5",
                         border: `1px solid ${amountOk ? "#26303d" : "#ff6b69"}` }} />
              {!amountOk && <small style={{ color: "#ff9795", fontSize: 11 }}>Indiquez le montant réellement encaissé.</small>}
            </label>
            <span style={{ fontSize: 12, color: "#8aa0b6" }}>Mode de paiement encaissé :</span>
            {!splitting ? (
              <>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" className="fa-cash" style={{ flex: 1 }} disabled={!amountOk}
                    onClick={() => { onPay("Espèces", amountValue); setCashing(false); }}>Espèces{amountOk ? ` · ${amountValue} DH` : ""}</button>
                  <button type="button" className="fa-cash" style={{ flex: 1 }} disabled={!amountOk}
                    onClick={() => { onPay("Carte bancaire", amountValue); setCashing(false); }}>Carte bancaire{amountOk ? ` · ${amountValue} DH` : ""}</button>
                </div>
                <button type="button" className="fa-split-open" onClick={startSplit}>
                  Payé en deux fois : une partie en espèces, le reste par carte
                </button>
              </>
            ) : (
              <div className="fa-split">
                <label>
                  <span>Espèces (DH)</span>
                  <input type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={splitCash} autoFocus
                    onChange={(e) => onSplitCash(e.target.value)} placeholder="0" />
                </label>
                <b>+</b>
                <label>
                  <span>Carte (DH)</span>
                  <input type="text" inputMode="numeric" autoComplete="off" maxLength={6} value={splitCard}
                    onChange={(e) => { setCardTyped(true); setSplitCard(digitsOnly(e.target.value)); }} placeholder="0" />
                </label>
                <b>=</b>
                <strong>{cashPart + cardPart} DH</strong>
                {pack?.total != null && splitOk && cashPart + cardPart !== pack.total && (
                  <small className="fa-split-note">tarif {pack.total} DH · {cashPart + cardPart < pack.total ? `remise ${cashPart + cardPart - pack.total}` : `supplément +${cashPart + cardPart - pack.total}`} DH</small>
                )}
                {!splitOk && <small className="fa-split-err">Les deux parts doivent être supérieures à 0.</small>}
                <div className="fa-split-actions">
                  <button type="button" className="fa-cash" disabled={!splitOk}
                    onClick={() => {
                      onPay(cashPart >= cardPart ? "Espèces" : "Carte bancaire", cashPart + cardPart, { cash: cashPart, card: cardPart });
                      setCashing(false);
                    }}>
                    Valider · {cashPart} DH espèces + {cardPart} DH carte
                  </button>
                  <button type="button" className="fa-undo" onClick={() => setSplitting(false)}>Un seul mode</button>
                </div>
              </div>
            )}
            <button type="button" className="fa-undo" onClick={() => setCashing(false)}>Annuler</button>
          </div>
        </div>
      )}

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
                          pilot chip shows a kart number. */}
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
            <h4>Actions</h4>
            {deleted ? (
              <div className="fa-more">
                <button type="button" onClick={onRestore}>Restaurer{r.deletedFrom ? ` (${QUEUE_STATUS_LABELS[r.deletedFrom]})` : ""}</button>
                <button type="button" className="fa-danger"
                  onClick={() => { if (confirm(`Effacer définitivement ${r.code} (${r.contactName}) ? Impossible à annuler.`)) onErase(); }}>
                  Effacer définitivement
                </button>
                <p className="fa-hint">Supprimée à {hhmm(r.deletedAt)}{r.deletedBy ? ` par ${r.deletedBy}` : ""}.</p>
              </div>
            ) : (
            <div className="fa-more">
              <button type="button" onClick={onRemove}>Supprimer (→ Supprimées)</button>
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
            )}
            {r.paidAt && (
              <p className="fa-hint">
                Encaissé{typeof r.paidAmount === "number" ? ` ${r.paidAmount} DH` : ""}
                {r.paidSplit ? ` (${r.paidSplit.cash} DH en espèces + ${r.paidSplit.card} DH par carte)`
                  : r.paymentMethod === "Espèces" ? " en espèces" : " par carte"} à {new Date(r.paidAt).toLocaleTimeString("fr-FR")}
                {r.paidBy ? ` par ${r.paidBy}` : ""}
              </p>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
