"use client";

// CLIENTS — everyone who has registered, and their results on track.
//
// One row per person (merged by phone number across sign-ups, and including the pilots a
// registrant added, not just the registrant). Opening a row shows their sign-ups and every
// race they drove: position, kart, laps, best lap and the full lap list.

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Flag, Timer, Trophy, UsersRound } from "lucide-react";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { useSignups } from "@/hooks/use-signups";
import { useSavedRaces } from "@/hooks/use-saved-races";
import { buildDirectory, filterClients, type ClientFilter, type ClientRecord } from "@/lib/client-directory";

const fmtLap = (ms: number | null | undefined) => {
  if (ms == null || !(ms > 0)) return "—";
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
};
const fmtDay = (iso: string | number | null) => {
  if (iso == null) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
};
const fmtTime = (iso: string | number | null) => {
  if (iso == null) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
};

export function ClientsPage({ search }: { search: string }) {
  const { signups, state: signupState } = useSignups();
  const { races, state: raceState } = useSavedRaces();
  const [filter, setFilter] = useState<ClientFilter>("tous");
  const [open, setOpen] = useState<string | null>(null);

  const clients = useMemo(() => buildDirectory(signups, races), [signups, races]);
  const shown = useMemo(() => filterClients(clients, filter, search), [clients, filter, search]);

  const raced = clients.filter((c) => c.races.length > 0);
  const totalLaps = clients.reduce((n, c) => n + c.totalLaps, 0);
  const record = raced.reduce<ClientRecord | null>((best, c) =>
    c.bestLapMs != null && (best?.bestLapMs == null || c.bestLapMs < best.bestLapMs) ? c : best, null);

  return (
    <div className="clients-history-page">
      <header className="clients-history-hero">
        <div>
          <span className="eyebrow"><i /> CLIENTS</span>
          <h1>Clients inscrits</h1>
          <p>Toutes les personnes passées par l’inscription — celles qui ont rempli le formulaire et les pilotes qu’elles ont ajoutés — avec leurs résultats en piste.</p>
        </div>
        <span className="history-only-badge">
          {signupState === "offline" ? "Pont d’inscription injoignable"
            : raceState === "offline" ? "Chrono hors ligne — résultats indisponibles"
            : raceState === "loading" ? "Chargement des résultats…"
            : `${races.length} course${races.length > 1 ? "s" : ""} enregistrée${races.length > 1 ? "s" : ""}`}
        </span>
      </header>

      <section className="client-history-kpis">
        <article><UsersRound size={18} /><span><small>CLIENTS INSCRITS</small><strong>{clients.length}</strong><b>{signups.length} inscription{signups.length > 1 ? "s" : ""}</b></span></article>
        <article><Flag size={18} /><span><small>ONT ROULÉ</small><strong>{raced.length}</strong><b>{clients.length - raced.length} pas encore</b></span></article>
        <article><Timer size={18} /><span><small>TOURS AU TOTAL</small><strong>{totalLaps.toLocaleString("fr-FR")}</strong><b>tous clients confondus</b></span></article>
        <article><Trophy size={18} /><span><small>RECORD CLIENT</small><strong>{fmtLap(record?.bestLapMs)}</strong><b>{record?.name ?? "—"}</b></span></article>
      </section>

      <div className="cl-filters" role="tablist">
        {([["tous", "Tous"], ["roule", "Ont roulé"], ["attente", "Pas encore roulé"]] as [ClientFilter, string][]).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filter === key}
            className={filter === key ? "is-on" : ""} onClick={() => setFilter(key)}>{label}</button>
        ))}
        {search.trim() && <span className="cl-search-note">Recherche : « {search.trim()} » · {shown.length} résultat{shown.length > 1 ? "s" : ""}</span>}
      </div>

      <section className="cl-list" aria-label="Clients">
        <header className="cl-row cl-head">
          <span /><span>CLIENT</span><span>CONTACT</span><span>INSCRIT</span><span>COURSES</span><span>TOURS</span><span>MEILLEUR TOUR</span>
        </header>
        {shown.length === 0 && (
          <p className="cl-empty">
            {signupState === "loading" ? "Chargement des inscriptions…"
              : clients.length === 0 ? "Aucune inscription pour l’instant."
              : "Aucun client ne correspond."}
          </p>
        )}
        {shown.map((c) => {
          const isOpen = open === c.key;
          return (
            <Fragment key={c.key}>
              <button type="button" className={"cl-row" + (isOpen ? " is-open" : "")} onClick={() => setOpen(isOpen ? null : c.key)} aria-expanded={isOpen}>
                <span className="cl-chev">{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
                <span className="cl-who">
                  {c.color ? <DriverAvatar pilot={c.color} seed={c.name} size="30px" /> : <i className="cl-initial">{c.name.slice(0, 1).toUpperCase()}</i>}
                  <span><strong>{c.name}</strong><small>{c.age != null ? `${c.age} ans` : ""}{c.sameName > 0 ? ` · même nom que ${c.sameName} autre${c.sameName > 1 ? "s" : ""}` : ""}</small></span>
                </span>
                <span className="cl-contact"><strong>{c.phone ?? "—"}</strong><small>{c.email ?? ""}</small></span>
                <span><strong>{fmtDay(c.lastSeen)}</strong><small>{c.signups.length} inscription{c.signups.length > 1 ? "s" : ""}</small></span>
                <span><strong>{c.races.length}</strong><small>{c.races[0] ? `dernière ${fmtDay(c.races[0].at)}` : "pas encore"}</small></span>
                <span><strong>{c.totalLaps}</strong></span>
                <span className="cl-best"><strong>{fmtLap(c.bestLapMs)}</strong></span>
              </button>

              {isOpen && (
                <div className="cl-detail">
                  {c.sameName > 0 && (
                    <p className="cl-warn">
                      {c.sameName + 1} clients s’appellent « {c.name} ». Le chrono ne connaît que le nom du pilote,
                      donc leurs courses ne peuvent pas être séparées : elles apparaissent chez chacun.
                    </p>
                  )}

                  <div className="cl-block">
                    <h4>Courses</h4>
                    {c.races.length === 0 ? (
                      <p className="cl-empty">
                        {raceState === "offline" ? "Chrono hors ligne : résultats indisponibles pour l’instant." : "Pas encore de course enregistrée à ce nom."}
                      </p>
                    ) : (
                      <table className="cl-races">
                        <thead><tr><th>DATE</th><th>COURSE</th><th>PLACE</th><th>KART</th><th>TOURS</th><th>MEILLEUR</th><th>TOUS LES TOURS</th></tr></thead>
                        <tbody>
                          {c.races.map((r) => {
                            const best = r.lapTimesMs.length ? Math.min(...r.lapTimesMs) : null;
                            return (
                              <tr key={`${r.raceId}-${r.kart}`}>
                                <td>{fmtDay(r.at)}<small>{fmtTime(r.at)}</small></td>
                                <td>{r.raceName}{!r.finished && <em className="cl-partial">INCOMPLÈTE</em>}</td>
                                <td className={r.position === 1 ? "cl-p1" : ""}>{r.position != null ? `${r.position}/${r.field}` : "—"}</td>
                                <td>{r.kart}</td>
                                <td>{r.laps}</td>
                                <td className="cl-best">{fmtLap(r.bestLapMs)}</td>
                                <td className="cl-laps">
                                  {r.lapTimesMs.length === 0 ? <small>—</small> : r.lapTimesMs.map((ms, i) => (
                                    <span key={i} className={ms === best ? "is-best" : ""} title={`Tour ${i + 1}`}>{fmtLap(ms)}</span>
                                  ))}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="cl-block">
                    <h4>Inscriptions</h4>
                    <ul className="cl-signups">
                      {c.signups.map((s) => (
                        <li key={s.id}>
                          <b>{s.code}</b>
                          <span>{fmtDay(s.createdAt)} · {fmtTime(s.createdAt)}</span>
                          <span>{s.registrant ? `a rempli le formulaire · ${s.pilots} pilote${s.pilots > 1 ? "s" : ""}` : `ajouté par ${s.by}`}</span>
                          {s.packLabel && <span>{s.packLabel}{s.packTotalMad != null ? ` · ${s.packTotalMad} DH` : ""}</span>}
                          {s.queueCode && <span className="cl-queue">{s.queueCode}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Fragment>
          );
        })}
      </section>
    </div>
  );
}
