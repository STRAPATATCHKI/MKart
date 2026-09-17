"use client";

// The visitor-facing booking page. Opened on a phone from a QR code at the entrance
// (/#reserver), so it stands alone: no sidebar, no dashboard hooks, nothing that reaches
// the timing bridge. Same isolation rule as the souvenir page.
//
// Layout is one scrolling column with a sticky action bar — no wizard. On a phone a
// multi-step wizard hides how much is left and costs a tap per step; a single column lets
// someone thumb through it in one pass and see the whole commitment up front.

import { useEffect, useMemo, useState } from "react";
import {
  KART_COLORS, RACE_TYPES, PAYMENT_METHODS,
  isValidEmail, isValidPhone, formatPhone,
  type KartColor, type PaymentMethod, type RaceType, type Reservation,
} from "@/lib/reservation";
import { detectMode, submitReservation, type StoreMode } from "@/lib/reservation-store";

const MAX_PILOTS = 8;

type Draft = { name: string; color: KartColor };

export function ReservationPage() {
  const [raceType, setRaceType] = useState<RaceType>("practice");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("Espèces");
  const [extraPilots, setExtraPilots] = useState<Draft[]>([]);
  const [myColor, setMyColor] = useState<KartColor>("blue");
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ reservation: Reservation & { code: string | null }; mode: StoreMode } | null>(null);
  const [mode, setMode] = useState<StoreMode | null>(null);
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Probe once on mount so the demo banner is on screen BEFORE anyone starts typing, not
  // sprung on them at the end.
  useEffect(() => { void detectMode().then(setMode); }, []);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!contactName.trim()) e.contactName = "Indiquez votre nom complet.";
    else if (contactName.trim().split(/\s+/).length < 2) e.contactName = "Nom et prénom, s’il vous plaît.";
    if (!phone.trim()) e.phone = "Le numéro de téléphone est obligatoire.";
    else if (!isValidPhone(phone)) e.phone = "Numéro marocain invalide (ex. 06 12 34 56 78).";
    if (!isValidEmail(email)) e.email = "Adresse e-mail invalide.";
    extraPilots.forEach((p, i) => {
      if (!p.name.trim()) e[`pilot-${i}`] = "Nom du pilote requis.";
    });
    return e;
  }, [contactName, phone, email, extraPilots]);

  const valid = Object.keys(errors).length === 0;
  const totalPilots = 1 + extraPilots.length;

  const submit = async () => {
    setTouched(true);
    setSubmitError("");
    if (!valid) {
      // Send the thumb to the first problem instead of leaving them to hunt for it.
      const first = document.querySelector<HTMLElement>("[data-invalid='true']");
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSending(true);
    const result = await submitReservation({
      contactName,
      phone,
      email,
      raceType,
      paymentMethod: payment,
      pilots: [
        { fullName: contactName, kartColor: myColor },
        ...extraPilots.map((p) => ({ fullName: p.name, kartColor: p.color })),
      ],
    });
    setSending(false);

    if ("error" in result) {
      setSubmitError(
        result.error === "duplicate"
          ? `Une réservation existe déjà pour ce numéro : ${result.existingCode}.`
          : `${result.message} Votre réservation n’a pas été enregistrée — réessayez.`,
      );
      return;
    }
    setDone({ reservation: result.reservation as Reservation & { code: string | null }, mode: result.mode });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (done) return <Confirmation reservation={done.reservation} mode={done.mode} onNew={() => { setDone(null); reset(); }} />;

  function reset() {
    setContactName(""); setPhone(""); setEmail("");
    setExtraPilots([]); setMyColor("blue"); setPayment("Espèces"); setTouched(false);
  }

  const showErr = (key: string) => (touched && errors[key] ? errors[key] : "");

  return (
    <div className="rsv">
      {mode === "demo" && <DemoBanner />}

      <header className="rsv-top">
        <div className="rsv-lockup">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/megakart-loader-logo.png" alt="MegaKart Fès" />
        </div>
        <h1>Réservez votre place</h1>
        <p>Remplissez en une minute. Vous réglez à la caisse en arrivant.</p>
      </header>

      <main className="rsv-body">
        <Section step={1} title="Type de course">
          <div className="rsv-races">
            {RACE_TYPES.map((r) => (
              <button
                key={r.value}
                type="button"
                className={`rsv-race${raceType === r.value ? " is-on" : ""}${r.available ? "" : " is-soon"}`}
                onClick={() => r.available && setRaceType(r.value)}
                disabled={!r.available}
                aria-pressed={raceType === r.value}
              >
                <span className="rsv-race-name">{r.label}</span>
                <span className="rsv-race-tag">{r.tagline}</span>
                {!r.available && <span className="rsv-soon">Bientôt</span>}
              </button>
            ))}
          </div>
        </Section>

        <Section step={2} title="Vos coordonnées">
          <Field label="Nom complet" error={showErr("contactName")} required>
            <input
              type="text"
              inputMode="text"
              autoComplete="name"
              placeholder="Ex. Youssef Amrani"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </Field>
          <Field label="Téléphone" error={showErr("phone")} required hint="Pour vous prévenir quand la piste est prête">
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="06 12 34 56 78"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="E-mail" error={showErr("email")} hint="Facultatif — pour recevoir vos temps après la course">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="vous@exemple.ma"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        </Section>

        <Section step={3} title="Couleur de votre kart">
          <KartPicker value={myColor} onChange={setMyColor} name="Vous" />
        </Section>

        <Section
          step={4}
          title="Pilotes"
          aside={`${totalPilots} pilote${totalPilots > 1 ? "s" : ""}`}
        >
          <p className="rsv-note">Vous êtes le pilote 1. Ajoutez vos amis pour rester dans la même course.</p>
          {extraPilots.map((p, i) => (
            <div className="rsv-pilot" key={i}>
              <div className="rsv-pilot-head">
                <strong>Pilote {i + 2}</strong>
                <button type="button" className="rsv-remove" onClick={() => setExtraPilots(extraPilots.filter((_, j) => j !== i))}>
                  Retirer
                </button>
              </div>
              <Field label="Nom complet" error={showErr(`pilot-${i}`)} required>
                <input
                  type="text"
                  placeholder="Nom du pilote"
                  value={p.name}
                  onChange={(e) => setExtraPilots(extraPilots.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
              </Field>
              <KartPicker
                value={p.color}
                onChange={(c) => setExtraPilots(extraPilots.map((x, j) => (j === i ? { ...x, color: c } : x)))}
                name={`Pilote ${i + 2}`}
                compact
              />
            </div>
          ))}
          {totalPilots < MAX_PILOTS && (
            <button type="button" className="rsv-add" onClick={() => setExtraPilots([...extraPilots, { name: "", color: "green" }])}>
              + Ajouter un pilote
            </button>
          )}
        </Section>

        <Section step={5} title="Paiement à la caisse">
          <div className="rsv-pay">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`rsv-paybtn${payment === m.value ? " is-on" : ""}`}
                onClick={() => setPayment(m.value)}
                aria-pressed={payment === m.value}
              >
                <span className="rsv-pay-name">{m.label}</span>
                <span className="rsv-pay-hint">{m.hint}</span>
              </button>
            ))}
          </div>
          <p className="rsv-note rsv-note-strong">
            Aucun paiement en ligne. Votre place est gardée, vous réglez au comptoir à votre arrivée.
          </p>
        </Section>
      </main>

      <div className="rsv-actions">
        {submitError && <p className="rsv-submit-err" role="alert">{submitError}</p>}
        <div className="rsv-actions-inner">
          <div className="rsv-summary">
            <strong>{totalPilots} pilote{totalPilots > 1 ? "s" : ""}</strong>
            <span>Chrono · {payment}</span>
          </div>
          <button type="button" className="rsv-cta" onClick={() => void submit()} disabled={sending}>
            {sending ? "Envoi…" : "Confirmer ma réservation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ step, title, aside, children }: { step: number; title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section className="rsv-section">
      <div className="rsv-section-head">
        <span className="rsv-step">{step}</span>
        <h2>{title}</h2>
        {aside && <span className="rsv-aside">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, error, hint, required, children }: {
  label: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode;
}) {
  return (
    <label className={`rsv-field${error ? " is-bad" : ""}`} data-invalid={error ? "true" : undefined}>
      <span className="rsv-label">
        {label}{required && <i aria-hidden="true">*</i>}
      </span>
      {children}
      {error ? <span className="rsv-err">{error}</span> : hint ? <span className="rsv-hint">{hint}</span> : null}
    </label>
  );
}

/** Big image targets — a colour name alone is a poor choice when the karts are right there. */
function KartPicker({ value, onChange, name, compact }: {
  value: KartColor; onChange: (c: KartColor) => void; name: string; compact?: boolean;
}) {
  return (
    <div className={`rsv-karts${compact ? " is-compact" : ""}`} role="radiogroup" aria-label={`Couleur du kart — ${name}`}>
      {KART_COLORS.map((k) => (
        <button
          key={k.value}
          type="button"
          role="radio"
          aria-checked={value === k.value}
          className={`rsv-kart${value === k.value ? " is-on" : ""}`}
          onClick={() => onChange(k.value)}
          style={{ ["--swatch" as string]: k.swatch }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={k.image} alt="" aria-hidden="true" />
          <span>{k.label}</span>
        </button>
      ))}
    </div>
  );
}

function DemoBanner() {
  return (
    <div className="rsv-demo" role="status">
      <strong>MODE DÉMO</strong>
      <span>Cette réservation reste sur cet appareil et n’arrive pas à l’accueil. Aucun code ne sera créé.</span>
    </div>
  );
}

function Confirmation({ reservation, mode, onNew }: {
  reservation: Reservation & { code: string | null }; mode: StoreMode; onNew: () => void;
}) {
  const demo = mode === "demo" || reservation.code === null;
  return (
    <div className="rsv rsv-done">
      {demo && <DemoBanner />}
      <div className="rsv-done-card">
        <div className={`rsv-check${demo ? " is-demo" : ""}`} aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={demo ? 2 : 3} strokeLinecap="round" strokeLinejoin="round">
            {demo
              ? <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>
              : <path d="m4 12 6 6L20 6" />}
          </svg>
        </div>
        <h1>{demo ? "Réservation non envoyée" : "Place réservée"}</h1>
        <p>
          {demo
            ? "Le poste d’accueil n’est pas joignable, donc aucune place n’a été retenue. Présentez-vous directement à la caisse."
            : "Présentez ce code à la caisse pour régler et récupérer votre kart."}
        </p>

        {/* No code in demo mode. A code the desk cannot look up is worse than no code at all:
            the visitor would walk to the counter holding a number that means nothing. */}
        {demo
          ? <div className="rsv-code is-demo">Aucun code créé</div>
          : <div className="rsv-code">{reservation.code}</div>}

        <dl className="rsv-recap">
          <div><dt>Pilotes</dt><dd>{reservation.pilots.length}</dd></div>
          <div><dt>Course</dt><dd>Chrono</dd></div>
          <div><dt>Paiement</dt><dd>{reservation.paymentMethod}</dd></div>
          <div><dt>Téléphone</dt><dd>{formatPhone(reservation.phone)}</dd></div>
        </dl>

        <ul className="rsv-pilots-recap">
          {reservation.pilots.map((p) => {
            const k = KART_COLORS.find((c) => c.value === p.kartColor)!;
            return (
              <li key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={k.image} alt="" aria-hidden="true" />
                <span>{p.fullName}</span>
                <em>{k.label}</em>
              </li>
            );
          })}
        </ul>

        <div className={`rsv-pending${demo ? " is-demo" : ""}`}>
          {demo ? "Non transmise à l’accueil" : "En attente de paiement à la caisse"}
        </div>
        <button type="button" className="rsv-ghost" onClick={onNew}>Nouvelle réservation</button>
      </div>
    </div>
  );
}
