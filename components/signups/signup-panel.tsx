"use client";

// Sessions page: the QR poster clients scan to register, and the sign-ups that came in from it.
// "Ajouter" drops a client straight into the session being created.
import { Archive, Check, Printer, Timer, UserPlus, Wallet } from "lucide-react";
import { QrCode } from "@/components/qr-code";
import { qrSvgMarkup } from "@/lib/qr-svg";
import { isTallEnough, kartCategory, signupPlayers, MIN_HEIGHT_CM, PUBLIC_SIGNUP_URL, type Signup } from "@/lib/bridge-client";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { useQueue } from "@/hooks/use-queue";

const printPoster = (url: string) => {
  const win = window.open("", "megakart-affiche", "width=820,height=1100");
  if (!win) return;
  win.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Inscription pilote · MegaKart Fès</title>
    <style>
      @page { margin: 14mm; }
      body { margin:0; font-family:"Segoe UI",system-ui,sans-serif; color:#0b0e05; text-align:center;
        display:grid; justify-items:center; align-content:center; gap:18px; min-height:96vh; }
      img { width:180px; }
      h1 { margin:0; font-size:40px; letter-spacing:-.01em; }
      p { margin:0; font-size:20px; color:#39422f; max-width:30ch; line-height:1.4; }
      .qr { padding:16px; border:6px solid #d8ff35; border-radius:18px; line-height:0; }
      small { color:#6a7360; font-size:13px; }
    </style></head><body>
    <img src="/megakart-loader-logo.png" alt="MegaKart">
    <h1>Inscrivez-vous en 30 secondes</h1>
    <p>Scannez ce code avec votre téléphone et remplissez le formulaire.</p>
    <div class="qr">${qrSvgMarkup(url, "320")}</div>
    <p>Puis présentez votre code à l'accueil pour recevoir votre kart.</p>
    <small>${url}</small>
    </body></html>`);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 400);
};

type SignupPanelProps = {
  signups: Signup[];
  formUrl: string | null;
  state: "loading" | "ready" | "offline";
  onAdd: (signup: Signup) => void;
  onArchive: (signup: Signup) => void;
};

export function SignupPanel({ signups, formUrl, state, onAdd, onArchive }: SignupPanelProps) {
  const queue = useQueue();
  const waiting = signups.filter((s) => s.status === "new");
  const time = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

  // Payment lives in the caisse queue, never here: this panel only reads what the desk decided.
  const paymentOf = (signup: Signup) => {
    if (!signup.queueCode) return { state: "absent" as const, label: signup.queueError ? "Hors file" : "—", paid: false };
    const reservation = queue.reservations.find((r) => r.code === signup.queueCode);
    if (!reservation) return { state: "absent" as const, label: queue.online ? "Introuvable" : "Borne injoignable", paid: false };
    const paid = ["PAYEE", "EN_PISTE", "TERMINEE"].includes(reservation.status);
    return {
      state: paid ? ("paid" as const) : ("unpaid" as const),
      label: paid ? `Payée · ${reservation.paymentMethod === "Espèces" ? "ESP" : "CB"}` : "À encaisser",
      paid,
    };
  };

  return (
    <section className="panel signup-panel" style={{ marginTop: 18 }}>
      <div className="panel-header">
        <div><span className="panel-kicker">INSCRIPTIONS CLIENTS</span><h2>Ils se sont inscrits sur leur téléphone</h2></div>
        <span className="signup-count">{waiting.length} en attente</span>
      </div>

      <div className="signup-body">
        <aside className="signup-qr-card">
          <div className="signup-qr"><QrCode value={PUBLIC_SIGNUP_URL} label="QR code d’inscription" /></div>
          <strong>Affichez ou imprimez ce QR</strong>
          <span className="invite-countdown"><Timer size={12} /> lien unique à chaque scan</span>
          <small>{PUBLIC_SIGNUP_URL}</small>
          <button type="button" className="secondary-button full" onClick={() => printPoster(PUBLIC_SIGNUP_URL)}><Printer size={14} /> Imprimer l’affiche</button>
          <p>Ce QR ne change jamais : chaque client qui le scanne reçoit sa propre inscription, valable une seule fois. Pas besoin du Wi-Fi.</p>
          {formUrl ? <small className="invite-note">Sans internet, sur le Wi-Fi de la piste : {formUrl}</small> : null}
        </aside>

        <div className="signup-list">
          {waiting.length === 0 ? (
            <div className="empty-state" style={{ padding: "26px 18px" }}>
              <UserPlus size={22} />
              <strong>{state === "ready" ? "Aucune inscription en attente" : state === "offline" ? "Pont de chronométrage hors ligne" : "Chargement…"}</strong>
              <span>Les clients qui scannent le QR apparaissent ici, prêts à être ajoutés à une session.</span>
            </div>
          ) : (
            waiting.map((signup) => {
              const players = signupPlayers(signup);
              const payment = paymentOf(signup);
              return (
                <article key={signup.id} className={"signup-row is-" + payment.state}>
                  <span className="signup-code">{signup.code}</span>
                  <div className="signup-identity">
                    <strong>{signup.name}{players.length > 1 ? ` + ${players.length - 1}` : ""}</strong>
                    <small>{signup.age} ans · {signup.phone}{signup.email ? ` · ${signup.email}` : ""}</small>
                    <ul className="signup-players">
                      {players.map((player, index) => {
                        const category = kartCategory(player);
                        const minimum = MIN_HEIGHT_CM[category];
                        return (
                          <li
                            key={`${signup.id}-${index}`}
                            className={category === "JUNIOR" ? "is-cadet" : ""}
                            title={`${player.name} · ${player.age} ans${player.height ? ` · ${player.height} cm` : ""}${player.phone ? ` · ${player.phone}` : ""}${player.email ? ` · ${player.email}` : ""}`}
                          >
                            <DriverAvatar pilot={player.color} seed={player.name} size="26px" />
                            <span>{player.name}</span>
                            <em>{category} · {player.age} ans{player.height ? ` · ${player.height} cm` : ""}</em>
                            {!isTallEnough(player) && (
                              <b className="signup-flag" title={`Kart ${category} : ${minimum} cm minimum`}>&lt; {minimum} cm</b>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <span className="signup-time">
                    <b className={"signup-pay is-" + payment.state} title={signup.queueError ?? (signup.queueCode ? `Réservation ${signup.queueCode}` : undefined)}>
                      {payment.state === "paid" ? <Check size={11} /> : payment.state === "unpaid" ? <Wallet size={11} /> : null}
                      {payment.label}
                    </b>
                    {time(signup.createdAt)}
                  </span>
                  <div className="signup-actions">
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => onAdd(signup)}
                      disabled={payment.state === "unpaid"}
                      title={payment.state === "unpaid" ? "Encaissez d’abord dans la Liste d’attente" : undefined}
                    >
                      <UserPlus size={14} /> Ajouter {players.length > 1 ? `les ${players.length}` : ""}
                    </button>
                    <button type="button" className="secondary-button" aria-label="Archiver" title="Archiver" onClick={() => onArchive(signup)}><Archive size={14} /></button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
