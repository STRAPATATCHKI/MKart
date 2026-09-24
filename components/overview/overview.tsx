"use client";

// VUE GÉNÉRALE — the day at a glance, from what the venue actually recorded.
//
//   money     the desk's till (Liste d'attente): every reservation cashed, how, and for how much;
//   people    reservations and QR sign-ups made today;
//   track     MegaKart Timing Control: the race on track, else today's fastest laps.
//
// Each source can be offline on its own, and the page says which one rather than showing a
// zero that looks like a bad day. Nothing on this page is a placeholder figure.

import { useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, Banknote, ChevronRight, CircleDollarSign, Clock3, CreditCard,
  Flag, ListOrdered, PackageCheck, QrCode, Search, TicketCheck, Trophy, UsersRound,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LiveTrack, PILOT_HEX, type TrackDriver } from "@/components/track/live-track";
import { useQueue } from "@/hooks/use-queue";
import { useSignups } from "@/hooks/use-signups";
import { useSavedRaces } from "@/hooks/use-saved-races";
import { useTiming } from "@/hooks/use-timing";
import { useTrackRoute } from "@/hooks/use-track";
import { useCatalog } from "@/hooks/use-catalog";
import { TRACK_HEIGHT, TRACK_WIDTH } from "@/lib/track";
import {
  bestLapsToday, changeVs, dayKey, lastDays, monthDays, niceCeil, packSales, pilotsByDay,
  revenueSeries, shortDh, todayBookings, todaySummary, type Booking, type BookingStatus, type RevenueDay,
} from "@/lib/overview-stats";

const dh = (v: number) => `${Math.round(v).toLocaleString("fr-FR")} DH`;
const fmtLap = (ms: number | null | undefined) => {
  if (ms == null || !(ms > 0)) return "—";
  const s = ms / 1000;
  return s >= 60 ? `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
};

const PERIODS = { "7 jours": () => lastDays(7), "30 jours": () => lastDays(30), "Ce mois": () => monthDays() } as const;
type Period = keyof typeof PERIODS;

function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  const peak = Math.max(...values, 0);
  if (values.length < 2 || peak <= 0) return <svg className="sparkline" viewBox="0 0 110 38" aria-hidden="true" />;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 110},${34 - (v / peak) * 27}`).join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 110 38" aria-hidden="true">
      <polyline points={points} fill="none" stroke={positive ? "#b7ff39" : "#ff7b72"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({ label, value, change, detail, icon: Icon, values }: {
  label: string; value: string; change: string; detail: string; icon: typeof Activity; values: number[];
}) {
  const negative = change.startsWith("-");
  return (
    <article className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-icon"><Icon size={18} /></span>
        <span className={"trend " + (negative ? "negative" : "")} title="Par rapport à hier">
          {negative ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{change}
        </span>
      </div>
      <p>{label}</p>
      <div className="kpi-value-row">
        <div><strong>{value}</strong><small>{detail}</small></div>
        <Sparkline values={values} positive={!negative} />
      </div>
    </article>
  );
}

function RevenueChart({ days, offline }: { days: RevenueDay[]; offline: boolean }) {
  const top = niceCeil(Math.max(...days.map((d) => d.total), 0));
  const anything = days.some((d) => d.count > 0);
  if (!anything) {
    return (
      <div className="revenue-chart empty">
        <div className="empty-state">
          <Activity size={22} />
          <strong>{offline ? "Caisse injoignable" : "Aucun encaissement sur la période"}</strong>
          <span>{offline ? "Le serveur d’accueil ne répond pas : les ventes ne peuvent pas être lues." : "Chaque paiement validé dans la Liste d’attente apparaît ici."}</span>
        </div>
      </div>
    );
  }
  const many = days.length > 10;
  return (
    <div className="revenue-chart">
      <div className="y-axis">{[1, 0.75, 0.5, 0.25, 0].map((f) => <span key={f}>{shortDh(top * f)}</span>)}</div>
      <div className="chart-grid">
        <i /><i /><i /><i />
        <div className="bars" style={{ gridTemplateColumns: `repeat(${days.length}, 1fr)`, gap: many ? 3 : 12 }}>
          {days.map((d, i) => {
            const cashPct = top ? (d.cash / top) * 100 : 0;
            const cardPct = top ? (d.card / top) * 100 : 0;
            const notes = [d.unknown ? `${d.unknown} sans montant` : "", d.estimated ? `${d.estimated} estimé${d.estimated > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
            return (
              <div className="bar-column" key={d.key}>
                <div className="bar-hit ov-bar" style={many ? { width: "80%" } : undefined}>
                  <span className="bar-tip">
                    {dh(d.total)} · {d.count} vente{d.count > 1 ? "s" : ""}<br />
                    Espèces {dh(d.cash)} · Carte {dh(d.card)}{notes ? <><br />{notes}</> : null}
                  </span>
                  <b className="ov-bar-card" style={{ height: `${cardPct}%` }} />
                  <b className="ov-bar-cash" style={{ height: `${cashPct}%` }} />
                </div>
                <small>{!many || i % 5 === 0 || i === days.length - 1 ? d.label : ""}</small>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type BoardRow = { key: string; rank: number; name: string; sub: string; best: string; gap: string; color: number | null };

function Board({ rows, empty }: { rows: BoardRow[]; empty: { title: string; text: string } }) {
  return (
    <div className="leaderboard">
      <div className="leader-head"><span>POS</span><span>PILOTE</span><span>MEILLEUR</span><span>ÉCART</span></div>
      {rows.length === 0 && <div className="empty-state"><Trophy size={22} /><strong>{empty.title}</strong><span>{empty.text}</span></div>}
      {rows.map((r) => (
        <div className="leader-row" key={r.key}>
          <strong className={r.rank === 1 ? "first" : ""}>{String(r.rank).padStart(2, "0")}</strong>
          <div className="driver">
            <span style={{ background: (r.color && PILOT_HEX[r.color]) || "#2b3644" }}>
              {r.name.split(/\s+/).filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
            </span>
            <p><b>{r.name}</b><small>{r.sub}</small></p>
          </div>
          <b className="lap">{r.best}</b>
          <small className={r.rank === 1 ? "leader-badge" : "gap"}>{r.gap}</small>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: BookingStatus }) {
  const cls = status === "À encaisser" || status === "Absent" ? "status-pending" : status === "En piste" ? "status-live" : "status-confirmed";
  return <span className={"status-pill " + cls}><i />{status}</span>;
}

const amountText = (b: Booking) => b.amount == null ? "—" : `${b.estimated ? "≈ " : ""}${dh(b.amount)}`;

export function Overview({ search, onOpenQueue }: { search: string; onOpenQueue: () => void }) {
  const queue = useQueue(8000);
  const { signups, state: signupState } = useSignups();
  const { races, state: raceState } = useSavedRaces();
  const timingView = useTiming(1500);
  const route = useTrackRoute();
  const { catalog } = useCatalog();
  const [period, setPeriod] = useState<Period>("7 jours");
  const [selected, setSelected] = useState<Booking | null>(null);

  const reservations = queue.reservations;
  const today = useMemo(() => todaySummary(reservations, signups, races), [reservations, signups, races]);
  const week = useMemo(() => lastDays(7), []);
  const weekMoney = useMemo(() => revenueSeries(reservations, signups, week), [reservations, signups, week]);
  const periodDays = useMemo(() => PERIODS[period](), [period]);
  const series = useMemo(() => revenueSeries(reservations, signups, periodDays), [reservations, signups, periodDays]);
  const sales = useMemo(() => packSales(reservations, signups, periodDays), [reservations, signups, periodDays]);
  const bookings = useMemo(() => todayBookings(reservations, signups), [reservations, signups]);
  const bestLaps = useMemo(() => bestLapsToday(races), [races]);
  const todayKey = dayKey(new Date());
  const signupsToday = useMemo(
    () => signups.filter((s) => dayKey(s.createdAt) === todayKey).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [signups, todayKey],
  );

  const periodTotal = series.reduce((n, d) => n + d.total, 0);
  const periodCash = series.reduce((n, d) => n + d.cash, 0);
  const periodCard = series.reduce((n, d) => n + d.card, 0);

  // The race: whatever Timing Control holds now, if it has drivers.
  const race = timingView.race;
  const onTrack = !!race && (race.state === "RUNNING" || race.state === "PREPARED") && race.drivers.length > 0;
  const running = !!race && race.state === "RUNNING" && race.clockStarted !== false;
  const showRace = !!race && race.drivers.length > 0 && race.state !== "IDLE";
  const raceBests = showRace ? race!.drivers.map((d) => d.bestLapMs).filter((v): v is number => v != null && v > 0) : [];
  const raceBest = raceBests.length ? Math.min(...raceBests) : null;

  const boardRows: BoardRow[] = useMemo(() => {
    if (showRace && race) {
      const sorted = [...race.drivers].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
      const leader = sorted[0];
      const chronos = race.rankMode === "chronos";
      return sorted.map((d, i) => {
        const rank = d.position ?? i + 1;
        const behind = leader ? leader.laps - d.laps : 0;
        const gap = rank === 1 ? "LEADER"
          : chronos ? (d.bestLapMs && leader?.bestLapMs ? `+${((d.bestLapMs - leader.bestLapMs) / 1000).toFixed(3)}` : "—")
          : behind > 0 ? `-${behind} T` : "=";
        return {
          key: d.transponder || `${d.kart}-${i}`, rank, name: d.driver,
          sub: `Kart ${d.kart} · ${d.laps} tour${d.laps > 1 ? "s" : ""} · dernier ${fmtLap(d.lastLapMs)}`,
          best: fmtLap(d.bestLapMs), gap, color: (d as TrackDriver).color ?? null,
        };
      });
    }
    const record = bestLaps[0]?.bestLapMs ?? null;
    return bestLaps.map((b, i) => ({
      key: `${b.driver}-${i}`, rank: i + 1, name: b.driver, sub: `Kart ${b.kart} · ${b.raceName}`,
      best: fmtLap(b.bestLapMs), gap: i === 0 ? "RECORD" : record ? `+${((b.bestLapMs - record) / 1000).toFixed(3)}` : "—", color: null,
    }));
  }, [showRace, race, bestLaps]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return bookings;
    return bookings.filter((b) => [b.code, b.customer, b.pack, b.phone ?? "", ...b.pilots].join(" ").toLowerCase().includes(q));
  }, [bookings, search]);

  const colorOf = (label: string) =>
    catalog.offers.find((o) => o.name.trim().toLowerCase() === label.trim().toLowerCase())?.color ?? "var(--lime)";

  const money = today.money;
  const cashShare = money.total > 0 ? money.cash / money.total : 0;
  const deskDown = !queue.online && !queue.loading;
  const topSale = Math.max(...sales.map((s) => s.count), 1);

  return (
    <>
      <div className="page-heading dashboard-controls">
        <div className="heading-actions ov-sources" aria-label="Sources de données">
          <span className={queue.online ? "is-on" : queue.loading ? "" : "is-off"}><i />Caisse</span>
          <span className={signupState === "ready" ? "is-on" : signupState === "offline" ? "is-off" : ""}><i />Inscriptions</span>
          <span className={timingView.online ? "is-on" : "is-off"}><i />Chrono</span>
        </div>
      </div>

      <section className="kpi-grid">
        <KpiCard label="Chiffre d’affaires du jour" value={deskDown ? "—" : dh(money.total)}
          change={changeVs(money.total, today.yesterday.total)}
          detail={deskDown ? "Caisse injoignable" : `Espèces ${dh(money.cash)} · Carte ${dh(money.card)}`}
          icon={CircleDollarSign} values={weekMoney.map((d) => d.total)} />
        <KpiCard label="Sessions encaissées" value={deskDown ? "—" : String(today.paidReservations)}
          change={changeVs(today.paidReservations, today.yesterday.count)}
          detail={`${today.paidPilots} pilote${today.paidPilots > 1 ? "s" : ""} payé${today.paidPilots > 1 ? "s" : ""}`}
          icon={TicketCheck} values={weekMoney.map((d) => d.count)} />
        <KpiCard label="Pilotes du jour" value={deskDown ? "—" : String(today.pilotsToday)}
          change={changeVs(today.pilotsToday, today.pilotsYesterday)}
          detail={`${today.signupsToday} inscription${today.signupsToday > 1 ? "s" : ""} QR`}
          icon={UsersRound} values={pilotsByDay(reservations, week)} />
        <KpiCard label="Pilotes en piste" value={onTrack ? String(race!.drivers.length) : timingView.online ? "0" : "—"}
          change={!timingView.online ? "HORS LIGNE" : running ? "LIVE" : onTrack ? "GRILLE" : "—"}
          detail={`${today.racesToday} course${today.racesToday > 1 ? "s" : ""} aujourd’hui`}
          icon={Activity} values={[]} />
      </section>

      <section className="analytics-grid">
        <article className="panel revenue-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">PERFORMANCE</span><h2>Chiffre d’affaires</h2></div>
            <div className="revenue-total">
              <strong>{deskDown ? "—" : dh(periodTotal)}</strong>
              <span><i className="ov-dot cash" />Espèces {shortDh(periodCash)} · <i className="ov-dot card" />Carte {shortDh(periodCard)}</span>
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="period-select"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(PERIODS) as Period[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <RevenueChart days={series} offline={deskDown} />
        </article>

        <article className="panel occupancy-panel">
          <div className="panel-header"><div><span className="panel-kicker">AUJOURD’HUI</span><h2>Caisse du jour</h2></div><Banknote size={19} className="muted-icon" /></div>
          <div className="occupancy-body">
            <div className="radial">
              <svg viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="49" />
                {money.card > 0 && <circle cx="60" cy="60" r="49" className="ov-radial-card" />}
                <circle className="radial-value" cx="60" cy="60" r="49" style={{ strokeDashoffset: 307 * (1 - cashShare) }} />
              </svg>
              <div><strong>{deskDown ? "—" : shortDh(money.total)}</strong><span>DH encaissés</span></div>
            </div>
            <div className="occupancy-stats">
              <div><span><i className="green" /> Espèces</span><b>{dh(money.cash)}</b><u><i style={{ width: `${cashShare * 100}%` }} /></u></div>
              <div><span><i className="blue" /> Carte bancaire</span><b>{dh(money.card)}</b><u><i style={{ width: `${money.total > 0 ? (money.card / money.total) * 100 : 0}%` }} /></u></div>
              <p>
                <Clock3 size={14} />
                {today.waiting > 0
                  ? <>{today.waiting} à encaisser{today.waitingExpected > 0 ? <> · ≈ {dh(today.waitingExpected)}</> : null}</>
                  : `${money.count} encaissement${money.count > 1 ? "s" : ""}`}
                {(money.unknown > 0 || money.estimated > 0) && (
                  <strong title="Encaissés avant que la caisse ne demande le montant">
                    {money.unknown > 0 ? `${money.unknown} sans montant` : `${money.estimated} estimé${money.estimated > 1 ? "s" : ""}`}
                  </strong>
                )}
              </p>
            </div>
          </div>
        </article>
      </section>

      <section className="live-grid">
        <article className="panel race-panel">
          <div className="panel-header">
            <div>
              <span className={"panel-kicker " + (running ? "live" : "")}><i /> {running ? "LIVE · COURSE EN COURS" : onTrack ? "GRILLE · PRÊTE AU DÉPART" : "PISTE · EN ATTENTE"}</span>
              <h2>Suivi de piste</h2>
            </div>
          </div>
          <div className="track-map">
            <div className="track-topline">
              <span><i /> {!timingView.online ? "Chrono hors ligne" : running ? "Course active" : onTrack ? "Sur la grille" : "En attente"}</span>
              <strong>{showRace ? `${race!.drivers.length} kart${race!.drivers.length > 1 ? "s" : ""}` : "—"}</strong>
            </div>
            <LiveTrack
              drivers={(showRace ? race!.drivers : []) as TrackDriver[]}
              points={route.points} start={route.start} width={TRACK_WIDTH} height={TRACK_HEIGHT}
              running={running}
            />
            <div className="track-meta">
              <span><small>Course</small><b>{showRace ? race!.raceName ?? race!.raceId ?? "—" : "—"}</b></span>
              <span><small>Tours</small><b>{showRace ? Math.max(0, ...race!.drivers.map((d) => d.laps)) : "—"}</b></span>
              <span><small>Meilleur tour</small><b className="lime">{fmtLap(showRace ? raceBest : bestLaps[0]?.bestLapMs)}</b></span>
            </div>
          </div>
        </article>
        <article className="panel leaderboard-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">CLASSEMENT</span><h2>{showRace ? "Course en cours" : "Meilleurs tours du jour"}</h2></div>
            <Trophy size={19} className="muted-icon" />
          </div>
          <Board rows={boardRows} empty={
            !timingView.online && raceState === "offline"
              ? { title: "Chrono hors ligne", text: "Lancez MegaKart Timing Control pour voir la piste." }
              : { title: "Aucun tour aujourd’hui", text: "Les meilleurs tours s’afficheront après la première course." }
          } />
        </article>
      </section>

      <section className="sales-grid">
        <article className="panel packs-panel">
          <div className="panel-header"><div><span className="panel-kicker">VENTES · {period.toUpperCase()}</span><h2>Packs les plus vendus</h2></div><PackageCheck size={19} className="muted-icon" /></div>
          {sales.length === 0 ? (
            <div className="empty-state"><PackageCheck size={22} /><strong>Aucune vente sur la période</strong><span>Les packs choisis à l’inscription et encaissés apparaissent ici.</span></div>
          ) : sales.slice(0, 6).map((s) => (
            <div className="pack-row" key={s.label}>
              <span className="pack-icon"><i className="ov-pack-dot" style={{ background: colorOf(s.label) }} /></span>
              <p><b>{s.label}</b><small>{dh(s.amount)}</small></p>
              <u><i style={{ width: `${(s.count / topSale) * 100}%`, background: colorOf(s.label) }} /></u>
              <strong>{s.count}</strong>
            </div>
          ))}
        </article>
        <article className="panel ov-signups-panel">
          <div className="panel-header"><div><span className="panel-kicker">QR · AUJOURD’HUI</span><h2>Inscriptions du jour</h2></div><QrCode size={19} className="muted-icon" /></div>
          {signupsToday.length === 0 ? (
            <div className="empty-state"><QrCode size={22} /><strong>{signupState === "offline" ? "Pont d’inscription injoignable" : "Aucune inscription aujourd’hui"}</strong><span>Chaque formulaire rempli sur téléphone apparaît ici.</span></div>
          ) : (
            <ul className="ov-signups">
              {signupsToday.slice(0, 6).map((s) => {
                const pilots = 1 + (s.team?.length ?? 0);
                return (
                  <li key={s.id}>
                    <span className="ov-avatar" style={{ background: (s.color && PILOT_HEX[s.color]) || "#2b3644" }}>{s.name.trim().slice(0, 1).toUpperCase()}</span>
                    <p><b>{s.name}</b><small>{new Date(s.createdAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · {pilots} pilote{pilots > 1 ? "s" : ""}{s.packLabel ? ` · ${s.packLabel}` : ""}</small></p>
                    <em className={s.queueCode ? "is-ok" : s.queueError ? "is-bad" : ""}>{s.queueCode ?? (s.queueError ? "Erreur file" : "—")}</em>
                  </li>
                );
              })}
              {signupsToday.length > 6 && <li className="ov-more">+ {signupsToday.length - 6} autre{signupsToday.length - 6 > 1 ? "s" : ""}</li>}
            </ul>
          )}
        </article>
      </section>

      <section className="panel bookings-panel">
        <div className="panel-header">
          <div><span className="panel-kicker">AUJOURD’HUI</span><h2>Réservations du jour</h2></div>
          <button className="text-button" onClick={onOpenQueue}>Ouvrir la liste d’attente <ChevronRight size={15} /></button>
        </div>
        <Table>
          <TableHeader><TableRow><TableHead>HEURE</TableHead><TableHead>CLIENT</TableHead><TableHead>PACK</TableHead><TableHead>PILOTES</TableHead><TableHead>MONTANT</TableHead><TableHead>STATUT</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {filtered.map((b) => (
              <TableRow key={b.code} onClick={() => setSelected(b)} className="booking-row">
                <TableCell><strong className="time-cell">{b.time}</strong><small>{b.code}</small></TableCell>
                <TableCell><div className="customer-cell"><span>{b.initials}</span><p><b>{b.customer}</b><small>{b.source}</small></p></div></TableCell>
                <TableCell><b>{b.pack}</b></TableCell>
                <TableCell><UsersRound size={14} /> {b.pilots.length}</TableCell>
                <TableCell><b>{amountText(b)}</b></TableCell>
                <TableCell><StatusPill status={b.status} /></TableCell>
                <TableCell><ChevronRight size={16} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length === 0 && (
          <div className="empty-state">
            {search.trim() ? <Search size={23} /> : <ListOrdered size={23} />}
            <strong>{search.trim() ? "Aucun résultat" : deskDown ? "Caisse injoignable" : "Aucune réservation aujourd’hui"}</strong>
            <span>{search.trim() ? "Essayez un autre nom ou code." : "Les inscriptions QR et les ventes au guichet du jour s’affichent ici."}</span>
          </div>
        )}
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="booking-sheet">
          {selected && <>
            <SheetHeader><SheetDescription>RÉSERVATION {selected.code}</SheetDescription><SheetTitle>{selected.customer}</SheetTitle></SheetHeader>
            <div className="sheet-body">
              <div className="sheet-status"><StatusPill status={selected.status} /><span>{selected.time} · Aujourd’hui</span></div>
              <div className="ticket-visual">
                <span><Flag size={18} /> {selected.pack}</span>
                <strong>{amountText(selected)}</strong>
                <small>{selected.pilots.length} pilote{selected.pilots.length > 1 ? "s" : ""}{selected.estimated && selected.amount != null ? " · montant du pack, pas encore encaissé" : ""}</small>
                {selected.pilots.length > 0 && <div className="ov-pilots">{selected.pilots.map((p, i) => <em key={`${p}-${i}`}>{p}</em>)}</div>}
              </div>
              <div className="detail-list">
                <p><span>Source</span><b>{selected.source}</b></p>
                {selected.phone && <p><span>Téléphone</span><b>{selected.phone}</b></p>}
                <p><span>Paiement</span><b>{selected.payment
                  ? <>{selected.payment === "Espèces" ? <Banknote size={13} /> : <CreditCard size={13} />} {selected.payment}{selected.paidBy ? ` · ${selected.paidBy}` : ""}</>
                  : selected.status === "Absent" ? "Non réglé" : "À régler sur place"}</b></p>
                {selected.note && <p><span>Note</span><b>{selected.note}</b></p>}
              </div>
              <button className="primary-button full" onClick={() => { setSelected(null); onOpenQueue(); }}>
                <ListOrdered size={17} /> Ouvrir dans la liste d’attente
              </button>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </>
  );
}
