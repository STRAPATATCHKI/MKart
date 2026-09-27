"use client";

// DÉCAISSEMENTS — money taken out of the venue, asked for here and decided in the manager's app.
//
// The desk writes the request (amount, reason, description, who it goes to, how), the bridge
// carries it to the app, the manager approves or refuses it there, and the answer comes back on
// its own within seconds. Only an approved request can be handed out, and every step - created,
// approved or refused (by whom, why), cancelled, handed out - stays in its history.

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, Check, Clock3, History, ImagePlus, Send, X } from "lucide-react";
import { useDisbursements } from "@/hooks/use-disbursements";
import { CATEGORIES, EVENT_FR, formError, MAX_ATTACHMENTS, photoUrl, STATUS_FR, totals, type Disbursement, type NewDisbursement } from "@/lib/disbursements";
import { imagesIn, shrinkImage } from "@/lib/image-shrink";

const OPERATOR_KEY = "megakart-caisse-operateur-v1";
const dh = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} DH`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const label = (list: { id: string; label: string }[], id: string) => list.find((x) => x.id === id)?.label ?? id;
const EMPTY: NewDisbursement = { amount: "", category: "", description: "", beneficiary: "", method: "especes", reference: "", urgent: false, requestedBy: "" };

type Filter = "EN_ATTENTE" | "APPROUVE" | "TRAITES" | "TOUS";

export function DisbursementsView() {
  const d = useDisbursements();
  const [form, setForm] = useState<NewDisbursement>(() => {
    try { return { ...EMPTY, requestedBy: localStorage.getItem(OPERATOR_KEY) || "" }; } catch { return EMPTY; }
  });
  const [touched, setTouched] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("EN_ATTENTE");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Photos for the new request (ticket, invoice, screenshot), shrunk before they are kept.
  const [photos, setPhotos] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const addFiles = async (files: File[]) => {
    const room = MAX_ATTACHMENTS - photos.length;
    if (!files.length) return;
    if (room <= 0) { setMessage({ ok: false, text: `${MAX_ATTACHMENTS} photos au plus par demande.` }); return; }
    try {
      const shrunk = await Promise.all(files.slice(0, room).map((f) => shrinkImage(f)));
      setPhotos((current) => [...current, ...shrunk].slice(0, MAX_ATTACHMENTS));
      setMessage(null);
    } catch {
      setMessage({ ok: false, text: "Cette image n’a pas pu être lue : essayez une photo JPEG ou PNG." });
    }
  };
  // A screenshot pasted anywhere on the page (Ctrl+V) joins the request being written. Text
  // pasted into a field is left alone: only an image is taken.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = imagesIn(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const problem = formError(form);
  const set = (patch: Partial<NewDisbursement>) => { setForm((f) => ({ ...f, ...patch })); setMessage(null); };
  const t = useMemo(() => totals(d.list), [d.list]);
  const shown = d.list.filter((x) => filter === "TOUS" ? true
    : filter === "TRAITES" ? ["REFUSE", "ANNULE", "DECAISSE"].includes(x.status) : x.status === filter);
  const count = (f: Filter) => d.list.filter((x) => f === "TOUS" ? true : f === "TRAITES" ? ["REFUSE", "ANNULE", "DECAISSE"].includes(x.status) : x.status === f).length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem) return;
    setSending(true);
    const result = await d.create({ ...form, attachments: photos });
    setSending(false);
    if (typeof result === "string") { setMessage({ ok: false, text: result }); return; }
    try { localStorage.setItem(OPERATOR_KEY, form.requestedBy.toUpperCase()); } catch { /* ignore */ }
    setMessage({ ok: true, text: `${result.code} envoyé pour validation : ${dh(result.amount)}. La réponse de l’application s’affichera ici.` });
    setForm({ ...EMPTY, requestedBy: form.requestedBy });
    setPhotos([]);
    setTouched(false);
    setFilter("EN_ATTENTE");
  };

  // Photos added to an existing request - the receipt, usually, once the money is out.
  const addPhotosTo = async (x: Disbursement, files: File[]) => {
    const room = MAX_ATTACHMENTS - (x.attachments?.length ?? 0);
    if (!files.length || room <= 0) return;
    setBusyId(x.id);
    try {
      const shrunk = await Promise.all(files.slice(0, room).map((f) => shrinkImage(f)));
      const r = await d.addPhotos(x.id, shrunk, form.requestedBy || "ACCUEIL");
      setMessage(typeof r === "string" ? { ok: false, text: r } : { ok: true, text: `${r.code} : ${shrunk.length} photo${shrunk.length > 1 ? "s" : ""} ajoutée${shrunk.length > 1 ? "s" : ""}.` });
    } catch {
      setMessage({ ok: false, text: "Cette image n’a pas pu être lue : essayez une photo JPEG ou PNG." });
    } finally {
      setBusyId(null);
    }
  };

  const act = async (x: Disbursement, kind: "cancel" | "payout") => {
    const by = form.requestedBy || "ACCUEIL";
    if (kind === "cancel") {
      const reason = window.prompt(`Annuler ${x.code} (${dh(x.amount)}) ? Raison :`, "");
      if (reason === null) return;
      setBusyId(x.id);
      const r = await d.cancel(x.id, by, reason);
      setBusyId(null);
      if (typeof r === "string") setMessage({ ok: false, text: r });
    } else {
      if (!window.confirm(`Remettre ${dh(x.amount)} à ${x.beneficiary} (${x.code}) ?`)) return;
      setBusyId(x.id);
      const r = await d.payOut(x.id, by, "");
      setBusyId(null);
      if (typeof r === "string") setMessage({ ok: false, text: r });
      else setMessage({ ok: true, text: `${r.code} : ${dh(r.amount)} remis à ${r.beneficiary}.` });
    }
  };

  return (
    <div className="dc">
      <div className="page-heading">
        <div>
          <span className="eyebrow"><i /> CAISSE · DÉCAISSEMENTS</span>
          <h1>Décaissements</h1>
          <p>Toute sortie d’argent est demandée ici et validée ou refusée depuis l’application du gérant. La réponse arrive toute seule.</p>
        </div>
        <span className={"dc-online " + (d.online ? "is-ok" : "is-bad")}><i /> {d.online ? "Accueil connecté" : "Accueil injoignable"}</span>
      </div>

      <div className="dc-tiles">
        <div className={t.pending ? "is-wait" : ""}><span>EN ATTENTE DE VALIDATION</span><strong>{t.pending}</strong><b>{dh(t.pendingDh)}</b></div>
        <div><span>APPROUVÉS, À REMETTRE</span><strong>{dh(t.approvedDh)}</strong><b>{count("APPROUVE")} demande(s)</b></div>
        <div><span>DÉCAISSÉ (TOTAL)</span><strong>{dh(t.paidOutDh)}</strong><b>{d.list.filter((x) => x.status === "DECAISSE").length} sortie(s)</b></div>
        <div><span>REFUSÉS / ANNULÉS</span><strong>{d.list.filter((x) => x.status === "REFUSE" || x.status === "ANNULE").length}</strong><b>jamais sortis</b></div>
      </div>

      <div className="dc-grid">
        <form className="panel dc-form" onSubmit={submit} noValidate>
          <div className="panel-header"><div><span className="panel-kicker">NOUVELLE DEMANDE · ESPÈCES</span><h2>Demander un décaissement</h2></div></div>
          <div className="dc-fields">
            <label><span>Montant (DH) *</span>
              <input inputMode="decimal" value={form.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^\d.,]/g, "") })} placeholder="ex. 350" />
            </label>
            <label><span>Motif *</span>
              <select value={form.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">— choisir —</option>
                {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <label className="is-wide"><span>Description *</span>
              <textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })}
                placeholder="Ce qui est acheté ou payé, et pourquoi (ex. 20 L d’essence pour les karts GT)" maxLength={500} />
            </label>
            <label><span>Bénéficiaire *</span>
              <input value={form.beneficiary} onChange={(e) => set({ beneficiary: e.target.value })} placeholder="Personne ou fournisseur" maxLength={80} />
            </label>
            <label><span>N° de facture / référence</span>
              <input value={form.reference ?? ""} onChange={(e) => set({ reference: e.target.value })} placeholder="facultatif" maxLength={60} />
            </label>
            <label><span>Demandé par *</span>
              <input value={form.requestedBy} onChange={(e) => set({ requestedBy: e.target.value })} placeholder="Nom ou initiales" maxLength={40} />
            </label>
            <div className={"dc-photos is-wide" + (dragOver ? " is-over" : "")}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(imagesIn(e.dataTransfer)); }}>
              <span className="dc-photos-title">Photo jointe (ticket, facture, capture)</span>
              <div className="dc-photos-row">
                {photos.map((src, i) => (
                  <figure key={i}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a local data: URL, nothing to optimise */}
                    <img src={src} alt={`Photo ${i + 1}`} />
                    <button type="button" aria-label="Retirer la photo" onClick={() => setPhotos((p) => p.filter((_, k) => k !== i))}><X size={12} /></button>
                  </figure>
                ))}
                {photos.length < MAX_ATTACHMENTS ? (
                  <label className="dc-photo-add">
                    <input type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                    <ImagePlus size={18} />
                    <b>Joindre une photo</b>
                    <small>ou collez une capture (Ctrl+V), ou glissez-la ici</small>
                  </label>
                ) : null}
              </div>
            </div>
            <label className="dc-check is-wide">
              <input type="checkbox" checked={!!form.urgent} onChange={(e) => set({ urgent: e.target.checked })} />
              <span>Urgent (signalé en premier dans l’application)</span>
            </label>
          </div>
          {touched && problem ? <p className="dc-msg is-bad"><AlertTriangle size={14} /> {problem}</p> : null}
          {message ? <p className={"dc-msg " + (message.ok ? "is-ok" : "is-bad")}>{message.ok ? <Check size={14} /> : <AlertTriangle size={14} />} {message.text}</p> : null}
          <button type="submit" className="primary-button dc-submit" disabled={sending}>
            <Send size={15} /> {sending ? "Envoi…" : "Envoyer pour validation"}
          </button>
        </form>

        <section className="panel dc-list">
          <div className="dc-filters" role="tablist">
            {([["EN_ATTENTE", "En attente"], ["APPROUVE", "À remettre"], ["TRAITES", "Traités"], ["TOUS", "Tous"]] as const).map(([f, name]) => (
              <button key={f} type="button" className={filter === f ? "is-on" : ""} onClick={() => setFilter(f)}>{name} <b>{count(f)}</b></button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="empty-state" style={{ padding: "30px 18px" }}>
              <Banknote size={22} />
              <strong>{d.loading ? "Chargement…" : !d.online ? "Accueil injoignable" : filter === "EN_ATTENTE" ? "Aucune demande en attente" : "Rien ici"}</strong>
              <span>Chaque demande attend la réponse de l’application, puis se remet à l’accueil une fois approuvée.</span>
            </div>
          ) : shown.map((x) => (
            <article key={x.id} className={`dc-card is-${x.status.toLowerCase()}${x.urgent ? " is-urgent" : ""}`}>
              <header>
                <div>
                  <b className="dc-code">{x.code}</b>
                  <span className={`dc-status is-${x.status.toLowerCase()}`}>
                    {x.status === "EN_ATTENTE" ? <Clock3 size={12} /> : x.status === "APPROUVE" || x.status === "DECAISSE" ? <Check size={12} /> : <X size={12} />}
                    {x.status === "EN_ATTENTE" ? "En attente de l’application" : STATUS_FR[x.status]}
                  </span>
                  {x.urgent ? <span className="dc-urgent">URGENT</span> : null}
                </div>
                <strong>{dh(x.amount)}</strong>
              </header>
              <p className="dc-desc">{x.description}</p>
              <dl className="dc-facts">
                <div><dt>Motif</dt><dd>{label(CATEGORIES, x.category)}</dd></div>
                <div><dt>Bénéficiaire</dt><dd>{x.beneficiary}</dd></div>
                {x.reference ? <div><dt>Référence</dt><dd>{x.reference}</dd></div> : null}
                <div><dt>Demandé par</dt><dd>{x.requestedBy} · {when(x.createdAt)}</dd></div>
              </dl>
              {x.decision ? (
                <p className={"dc-decision is-" + x.decision.decision}>
                  {x.decision.decision === "approve" ? "Approuvé" : "Refusé"} par <b>{x.decision.by}</b> · {when(x.decision.at)}
                  {x.decision.comment ? <em> — « {x.decision.comment} »</em> : null}
                </p>
              ) : null}
              {x.attachments?.length ? (
                <div className="dc-thumbs">
                  {x.attachments.map((a) => (
                    <a key={a.id} href={photoUrl(x, a)} target="_blank" rel="noreferrer" title="Ouvrir la photo">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the desk on this PC */}
                      <img src={photoUrl(x, a)} alt="Photo jointe" loading="lazy" />
                    </a>
                  ))}
                </div>
              ) : null}
              <details className="dc-history">
                <summary><History size={13} /> Historique ({x.history.length})</summary>
                <ol>
                  {x.history.map((h, i) => (
                    <li key={i}>
                      <time>{when(h.at)}</time>
                      <b>{EVENT_FR[h.event] ?? h.event}</b>
                      <span>{h.by ? `par ${h.by}` : ""}{h.via ? ` · ${h.via === "application" ? "depuis l’application" : "à l’accueil"}` : ""}</span>
                      {h.note ? <em>« {h.note} »</em> : null}
                    </li>
                  ))}
                </ol>
              </details>
              <div className="dc-actions">
                {x.status === "APPROUVE" ? (
                  <button type="button" className="primary-button" disabled={busyId === x.id} onClick={() => void act(x, "payout")}>
                    <Banknote size={15} /> Argent remis · {dh(x.amount)}
                  </button>
                ) : null}
                {(x.attachments?.length ?? 0) < MAX_ATTACHMENTS ? (
                  <label className="secondary-button dc-add-photo" aria-disabled={busyId === x.id}>
                    <input type="file" accept="image/*" multiple hidden onChange={(e) => { void addPhotosTo(x, Array.from(e.target.files ?? [])); e.target.value = ""; }} />
                    <ImagePlus size={14} /> Ajouter une photo
                  </label>
                ) : null}
                {x.status === "EN_ATTENTE" ? (
                  <button type="button" className="secondary-button" disabled={busyId === x.id} onClick={() => void act(x, "cancel")}>
                    <X size={14} /> Annuler la demande
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
