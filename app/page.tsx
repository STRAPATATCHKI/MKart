"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveRace, type LiveDriver } from "@/hooks/use-live-race";
import { useSessions, useActiveRoster } from "@/hooks/use-sessions";
import { useHistory, type HistorySession } from "@/hooks/use-history";
import { useGokartsSessions } from "@/hooks/use-gokarts-sessions";
import { useTrackRoute } from "@/hooks/use-track";
import { TRACK_WIDTH, TRACK_HEIGHT, LEGACY_TRACK_WIDTH, TRACK_LAYOUT_VERSION, defaultRoutePoints, makeSmoothRoute, notifyTrackChanged, type RoutePoint } from "@/lib/track";
import { SESSION_TYPE_LABELS, STATE_LABELS, type SessionType, type SessionState } from "@/lib/megakart-session";
import { apexController } from "@/lib/apex-session-controller";
import { BigScreen } from "@/components/big-screen/big-screen";
import { SouvenirPage } from "@/components/souvenir/souvenir-page";
import { ReservationPage } from "@/components/reservation/reservation-page";
import { ChronoPanel } from "@/components/chrono/chrono-panel";
import { FileAttenteView } from "@/components/caisse/file-attente-view";
import { ResultSheet } from "@/components/results/result-sheet";
import { useBridgeSessionSync, type BridgeSync } from "@/hooks/use-bridge-sync";
import { useSignups } from "@/hooks/use-signups";
import { SignupPanel } from "@/components/signups/signup-panel";
import { FuelView } from "@/components/fuel/fuel-view";
import { signupPlayers, type Signup } from "@/lib/bridge-client";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";

type DriverRow = { name: string; kart: string; transponder: string; color?: number };
import { SOUVENIR_HASH_PREFIX } from "@/lib/race-souvenir";
import {
  Activity, ArrowDownRight, ArrowUpRight, Banknote, Bell, CalendarDays, CheckCircle2,
  ChevronRight, CircleDollarSign, Clock3, CreditCard, Crosshair, Flag, Fuel, LayoutDashboard, Menu, MonitorPlay, MoreHorizontal,
  PackageCheck, Pencil, PlusCircle, QrCode, Radio, RotateCcw, Save, Search, ShieldCheck, Smartphone,
  TicketCheck, Trash2, Trophy, Undo2, UsersRound, WalletCards, X, Zap,
} from "lucide-react";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const navItems = [
  { label: "Vue générale", icon: LayoutDashboard },
  { label: "Course en direct", icon: Flag, live: true },
  { label: "Liste d’attente", icon: CalendarDays },
  { label: "Sessions", icon: PlusCircle },
  { label: "Statistiques", icon: Trophy },
  { label: "Réservations", icon: CalendarDays },
  { label: "Clients", icon: UsersRound },
  { label: "Pass & fidélité", icon: WalletCards },
  { label: "Packs & ventes", icon: PackageCheck },
  { label: "Carburant", icon: Fuel },
  { label: "Rapports", icon: Activity },
];

type NotificationType = "qr" | "race" | "payment" | "delay";
const operationalNotifications: { id: string; type: NotificationType; title: string; detail: string; time: string }[] = [];

type Booking = { id: string; time: string; customer: string; initials: string; pack: string; racers: number; amount: string; status: "Confirmée" | "En piste" | "À encaisser"; source: string };
const bookings: Booking[] = [];

type QrReservation = { id: string; time: string; organizer: string; initials: string; friends: string[]; pack: string; amount: string; payment: "Carte bancaire" | "Espèces"; scannedAt: string };
const qrReservations: QrReservation[] = [];

type ClientHistoryEntry = { date: string; offer: string; amount: string; result: string };
type PastClient = { id: string; name: string; initials: string; phone: string; email: string; since: string; lastVisit: string; visits: number; sessions: number; spend: number; average: number; favorite: string; payment: "Carte bancaire" | "Espèces"; points: number; profile: string; history: ClientHistoryEntry[] };
const pastClients: PastClient[] = [];

const chartData: Record<string, number[]> = {
  "7 jours": [],
  "30 jours": [],
  "Ce mois": [],
};

const kartingPacks = [
  { name: "Bronze", price: 250, originalPrice: 300, sessions: 3, bonus: 0, saving: "50 DH économisés · 16,7 %", summary: "L’offre idéale pour découvrir le karting.", benefits: ["3 sessions de karting", "Sensations garanties"], audience: "Nouveaux clients · Débutants · Clients occasionnels" },
  { name: "Silver", price: 450, sessions: 5, bonus: 1, saving: "1 session offerte · 6 au total", summary: "Plus de sessions, plus de vitesse et d’adrénaline.", benefits: ["5 sessions de karting", "Inscription anticipée"], audience: "Clients réguliers · Passionnés · Groupes" },
  { name: "Gold", price: 700, originalPrice: 900, sessions: 7, bonus: 2, saving: "150 DH économisés · 9 au total", summary: "L’expérience la plus intense de la gamme packs.", benefits: ["7 sessions de karting", "2 sessions supplémentaires gratuites", "Inscription anticipée"], audience: "Passionnés · Clients réguliers · Groupes" },
];

const monthlyPasses = [
  { name: "Starter", price: 450, sessions: 5, bonus: "Bonus au renouvellement", benefits: ["Tarif préférentiel", "Inscription anticipée à la session"], audience: "Débutants · Clients réguliers · Budget mensuel maîtrisé" },
  { name: "Pro", price: 850, sessions: 10, bonus: "1 session gratuite chaque mois", benefits: ["Sessions supplémentaires à tarif réduit", "Inscription anticipée à la session"], audience: "Passionnés · Clients fréquents · Pilotes amateurs" },
  { name: "VIP Racing", price: 1600, sessions: 20, bonus: "2 sessions gratuites chaque mois", benefits: ["Tarifs exclusifs", "Invitations à des événements privés", "Inscription anticipée à la session"], audience: "Passionnés confirmés · Pratique intensive · Événements privés" },
];

const groupPacks = [
  { name: "Pack Famille", price: 300, capacity: "2 Juniors + 2 Adultes", benefits: ["Karts adaptés", "Briefing de sécurité", "Photos souvenirs"], audience: "Familles · Parents avec enfants · Sorties familiales" },
  { name: "Pack Amis", price: 400, capacity: "4 personnes · 5e gratuite", benefits: ["Tarif préférentiel", "Session privatisée", "Ambiance garantie"], audience: "Groupes d’amis · Collègues · Anniversaires · Événements privés" },
];

const loyaltyRewards = [
  { card: "Carte 1", reward: "20 % de réduction" },
  { card: "Carte 2", reward: "50 % de réduction" },
  { card: "Carte 3", reward: "Sessions gratuites" },
  { card: "Carte 4", reward: "Boisson gratuite" },
];

const catalogReport = [
  ...kartingPacks.map((offer) => ({ category: "Pack karting", name: offer.name, price: offer.price, volume: `${offer.sessions + offer.bonus} sessions`, advantage: offer.saving })),
  ...monthlyPasses.map((offer) => ({ category: "Abonnement", name: offer.name, price: offer.price, volume: `${offer.sessions} sessions / mois`, advantage: offer.bonus })),
  ...groupPacks.map((offer) => ({ category: "Offre groupe", name: offer.name, price: offer.price, volume: offer.capacity, advantage: offer.benefits[0] })),
];

function LogoMark() {
  return (
    <div className="brand-mark" aria-label="MegaKart">
      <span className="brand-flag"><i /><i /><i /><i /></span>
      <span className="brand-copy"><strong>MEGA</strong><em>KART</em></span>
    </div>
  );
}

function StatusPill({ status }: { status: Booking["status"] }) {
  const cls = status === "Confirmée" ? "status-confirmed" : status === "En piste" ? "status-live" : "status-pending";
  return <span className={"status-pill " + cls}><i />{status}</span>;
}

function Sparkline({ values, positive = true }: { values: number[]; positive?: boolean }) {
  if (!values || values.length < 2) return <svg className="sparkline" viewBox="0 0 110 38" aria-hidden="true" />;
  const points = values.map((value, i) => {
    const x = (i / (values.length - 1)) * 110;
    const y = 34 - (value / Math.max(...values)) * 27;
    return x + "," + y;
  }).join(" ");
  return (
    <svg className="sparkline" viewBox="0 0 110 38" aria-hidden="true">
      <polyline points={points} fill="none" stroke={positive ? "#b7ff39" : "#ff7b72"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiCard({
  label, value, change, detail, icon: Icon, values, negative,
}: {
  label: string; value: string; change: string; detail: string;
  icon: typeof Activity; values: number[]; negative?: boolean;
}) {
  return (
    <article className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-icon"><Icon size={18} /></span>
        <span className={"trend " + (negative ? "negative" : "")}>
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

function RevenueChart({ period }: { period: string }) {
  const data = chartData[period] ?? [];
  const labels = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  if (data.length === 0) {
    return <div className="revenue-chart empty"><div className="empty-state"><Activity size={22} /><strong>Aucune donnée</strong><span>Le chiffre d’affaires s’affichera une fois les ventes connectées.</span></div></div>;
  }
  const peak = Math.max(...data, 1);
  return (
    <div className="revenue-chart">
      <div className="y-axis"><span>15k</span><span>10k</span><span>5k</span><span>0</span></div>
      <div className="chart-grid">
        <i /><i /><i /><i />
        <div className="bars">
          {data.map((value, index) => (
            <div className="bar-column" key={labels[index]}>
              <div className="bar-hit"><span className="bar-tip">{Math.round(value * 155)} DH</span><b style={{ height: (value / peak) * 100 + "%" }} /></div>
              <small>{labels[index]}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TrackMap({ drivers = [], live = false }: { drivers?: LiveDriver[]; live?: boolean }) {
  const { points, start } = useTrackRoute(); // same adjustable track as the live circuit editor
  const path = makeSmoothRoute(points);
  const startPt = points[Math.min(start, points.length - 1)] ?? points[0];
  const laps = drivers.reduce((max, d) => Math.max(max, d.laps), 0);
  const best = drivers.map((d) => d.best).filter((b) => b && b !== "—").sort()[0] ?? "—";
  return (
    <div className="track-map">
      <div className="track-topline"><span><i /> {live ? "Course active" : "En attente"}</span><strong>{live ? `${drivers.length} karts` : "—"}</strong></div>
      <svg viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Carte de la piste MegaKart">
        <defs><filter id="glow"><feGaussianBlur stdDeviation="5" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <path className="track-shadow" d={path} />
        <path className="track-line" d={path} />
        {startPt && <g className="route-marker start-marker" transform={`translate(${startPt.x} ${startPt.y})`}><circle r="11" /><text textAnchor="middle" y="4">D</text></g>}
        {drivers.map((driver, index) => {
          const pt = points[Math.floor((index * points.length) / Math.max(drivers.length, 1))] ?? points[0];
          return <g key={driver.kart} className="driver-dot" transform={`translate(${pt.x} ${pt.y})`}><circle r="14" style={{ fill: driver.color }} /><text textAnchor="middle" y="4">{driver.kart}</text></g>;
        })}
      </svg>
      <div className="track-meta">
        <span><small>Piste</small><b>Indoor A</b></span>
        <span><small>Tour</small><b>{live ? laps : "—"}</b></span>
        <span><small>Meilleur tour</small><b className="lime">{best}{best !== "—" ? "s" : ""}</b></span>
      </div>
    </div>
  );
}

function Leaderboard({ drivers = [], expanded = false }: { drivers?: LiveDriver[]; expanded?: boolean }) {
  return (
    <div className={"leaderboard " + (expanded ? "expanded" : "")}>
      <div className="leader-head"><span>POS</span><span>PILOTE</span><span>MEILLEUR</span><span>ÉCART</span></div>
      {drivers.length === 0 && <div className="empty-state"><Trophy size={22} /><strong>Aucun pilote en piste</strong><span>Le classement s’affichera au départ de la course.</span></div>}
      {drivers.map((driver) => (
        <div className="leader-row" key={driver.kart}>
          <strong className={driver.rank === 1 ? "first" : ""}>{String(driver.rank).padStart(2, "0")}</strong>
          <div className="driver">
            <span style={{ background: driver.color }}>{driver.name.split(" ").map((n) => n[0]).join("")}</span>
            <p><b>{driver.name}</b><small>{driver.kart} · Dernier {driver.last}</small></p>
          </div>
          <b className="lap">{driver.best}</b>
          <small className={driver.rank === 1 ? "leader-badge" : "gap"}>{driver.gap}</small>
        </div>
      ))}
    </div>
  );
}

function Sidebar({
  active, onSelect, mobileOpen, closeMobile,
}: {
  active: string; onSelect: (label: string) => void; mobileOpen: boolean; closeMobile: () => void;
}) {
  return (
    <>
      {mobileOpen && <button className="mobile-overlay" onClick={closeMobile} aria-label="Fermer le menu" />}
      <aside className={"sidebar " + (mobileOpen ? "mobile-open" : "")}>
        <div className="sidebar-brand"><LogoMark /><button className="mobile-close" onClick={closeMobile}><X size={18} /></button></div>
        <div className="venue-card">
          <div className="venue-icon"><Flag size={17} /></div>
          <div><strong>MegaKart Fès</strong><span>Centre opérationnel</span></div>
          <ChevronRight size={16} />
        </div>
        <p className="nav-label">ESPACE DE TRAVAIL</p>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} className={active === item.label ? "active" : ""} onClick={() => { onSelect(item.label); closeMobile(); }}>
                <Icon size={18} /><span>{item.label}</span>{item.live && <i className="live-dot" />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-status"><span><i /> Systèmes opérationnels</span><small>Dernière synchro · maintenant</small></div>
          <button className="profile"><span className="avatar">MK</span><span><strong>Manager Fès</strong><small>Administrateur</small></span><MoreHorizontal size={18} /></button>
        </div>
      </aside>
    </>
  );
}

function Topbar({ openMenu, search, setSearch }: { openMenu: () => void; search: string; setSearch: (value: string) => void }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const notificationRef = useRef<HTMLDivElement>(null);
  const unreadCount = operationalNotifications.length - readNotifications.length;

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotificationsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  const markAsRead = (id: string) => setReadNotifications((current) => current.includes(id) ? current : [...current, id]);

  return (
    <header className="topbar">
      <button className="menu-button" onClick={openMenu} aria-label="Ouvrir le menu"><Menu size={20} /></button>
      <div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher client, réservation..." /><kbd>⌘ K</kbd></div>
      <div className="top-actions">
        <div className="notification-center" ref={notificationRef}>
          <button className={"icon-button notification-trigger " + (notificationsOpen ? "active" : "")} aria-label={`${unreadCount} notifications non lues`} aria-expanded={notificationsOpen} aria-haspopup="dialog" onClick={() => setNotificationsOpen((open) => !open)}>
            <Bell size={18} />{unreadCount > 0 && <span className="notification-count" aria-live="polite">{unreadCount}</span>}
          </button>
          {notificationsOpen && <div className="notification-panel" role="dialog" aria-label="Notifications opérationnelles">
            <div className="notification-panel-head"><div><span>CENTRE D’ALERTES</span><h2>Notifications</h2></div><button disabled={unreadCount === 0} onClick={() => setReadNotifications(operationalNotifications.map((notification) => notification.id))}>Tout marquer comme lu</button></div>
            <div className="notification-list">
              {operationalNotifications.map((notification) => {
                const isRead = readNotifications.includes(notification.id);
                const NotificationIcon = notification.type === "qr" ? QrCode : notification.type === "race" ? Flag : notification.type === "payment" ? CreditCard : Clock3;
                return <button key={notification.id} className={isRead ? "read" : "unread"} onClick={() => markAsRead(notification.id)}>
                  <span className={`notification-type ${notification.type}`}><NotificationIcon size={16} /></span>
                  <span className="notification-copy"><strong>{notification.title}</strong><small>{notification.detail}</small><em>{notification.time}</em></span>
                  {!isRead && <i aria-label="Non lue" />}
                </button>;
              })}
            </div>
            <div className="notification-panel-foot"><span><i /> Synchronisation en direct</span><small>{unreadCount === 0 ? "Vous êtes à jour" : `${unreadCount} alerte${unreadCount > 1 ? "s" : ""} à consulter`}</small></div>
          </div>}
        </div>
        <button className="primary-button"><CalendarDays size={17} /><span>Nouvelle réservation</span></button>
      </div>
    </header>
  );
}

function Overview({
  search, selectedBooking, setSelectedBooking,
}: {
  search: string; selectedBooking: Booking | null; setSelectedBooking: (booking: Booking | null) => void;
}) {
  const [period, setPeriod] = useState("7 jours");
  const [track, setTrack] = useState("Toutes les pistes");
  const [liveSync, setLiveSync] = useState(true);
  const live = useLiveRace();
  const filteredBookings = useMemo(() => {
    const query = search.toLowerCase().trim();
    if (!query) return bookings;
    return bookings.filter((booking) => Object.values(booking).join(" ").toLowerCase().includes(query));
  }, [search]);

  return (
    <>
      <div className="page-heading dashboard-controls">
        <div className="heading-actions">
          <label className="sync-toggle"><input type="checkbox" checked={liveSync} onChange={() => setLiveSync(!liveSync)} /><span /><small>{liveSync ? "Données en direct" : "Synchro en pause"}</small></label>
          <Select value={track} onValueChange={setTrack}>
            <SelectTrigger className="dash-select"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="Toutes les pistes">Toutes les pistes</SelectItem><SelectItem value="Indoor A">Indoor A</SelectItem><SelectItem value="Junior B">Junior B</SelectItem></SelectContent>
          </Select>
        </div>
      </div>

      <section className="kpi-grid">
        <KpiCard label="Chiffre d’affaires" value="—" change="—" detail="En attente des ventes" icon={CircleDollarSign} values={[]} />
        <KpiCard label="Sessions vendues" value="—" change="—" detail="En attente des ventes" icon={TicketCheck} values={[]} />
        <KpiCard label="Clients actifs" value="—" change="—" detail="En attente des clients" icon={UsersRound} values={[]} />
        <KpiCard label="Pilotes en piste" value={live.drivers.length ? String(live.drivers.length) : "—"} change="LIVE" detail={live.sessionActive ? "Session en cours" : "Aucune session"} icon={Activity} values={[]} />
      </section>

      <section className="analytics-grid">
        <article className="panel revenue-panel">
          <div className="panel-header">
            <div><span className="panel-kicker">PERFORMANCE</span><h2>Chiffre d’affaires</h2></div>
            <div className="revenue-total"><strong>—</strong><span>En attente</span></div>
            <Select value={period} onValueChange={setPeriod}><SelectTrigger className="period-select"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7 jours">7 jours</SelectItem><SelectItem value="30 jours">30 jours</SelectItem><SelectItem value="Ce mois">Ce mois</SelectItem></SelectContent></Select>
          </div>
          <RevenueChart period={period} />
        </article>
        <article className="panel occupancy-panel">
          <div className="panel-header"><div><span className="panel-kicker">AUJOURD’HUI</span><h2>Occupation des pistes</h2></div><button className="ghost-icon"><MoreHorizontal size={19} /></button></div>
          <div className="occupancy-body">
            <div className="radial"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="49" /><circle className="radial-value" cx="60" cy="60" r="49" style={{ strokeDashoffset: 308 }} /></svg><div><strong>—</strong><span>occupation</span></div></div>
            <div className="occupancy-stats">
              <div><span><i className="green" /> Indoor A</span><b>—</b><u><i style={{ width: "0%" }} /></u></div>
              <div><span><i className="blue" /> Junior B</span><b>—</b><u><i style={{ width: "0%" }} /></u></div>
              <p><Clock3 size={14} /> En attente des réservations</p>
            </div>
          </div>
        </article>
      </section>

      <section className="live-grid">
        <article className="panel race-panel">
          <div className="panel-header"><div><span className={"panel-kicker " + (live.sessionActive ? "live" : "")}><i /> {live.sessionActive ? "LIVE · COURSE EN COURS" : "PISTE · EN ATTENTE"}</span><h2>Suivi de piste</h2></div></div>
          <TrackMap drivers={live.drivers} live={live.sessionActive} />
        </article>
        <article className="panel leaderboard-panel">
          <div className="panel-header"><div><span className="panel-kicker">CLASSEMENT</span><h2>Top pilotes</h2></div><Trophy size={19} className="muted-icon" /></div>
          <Leaderboard drivers={live.drivers} />
        </article>
      </section>

      <section className="sales-grid">
        <article className="panel packs-panel">
          <div className="panel-header"><div><span className="panel-kicker">VENTES</span><h2>Packs les plus vendus</h2></div></div>
          <div className="empty-state"><PackageCheck size={22} /><strong>Aucune vente enregistrée</strong><span>Le classement des packs s’affichera une fois les ventes connectées.</span></div>
        </article>
        <article className="panel wallet-panel">
          <div className="panel-header"><div><span className="panel-kicker">PASS MOBILE</span><h2>Apple & Google Wallet</h2></div><Smartphone size={19} className="muted-icon" /></div>
          <div className="wallet-hero"><div className="wallet-card"><div><LogoMark /><QrCode size={42} /></div><span>MEGAKART PASS</span><strong>— points</strong></div><div className="wallet-copy"><strong>—</strong><span>Pass actifs</span><p>En attente</p></div></div>
          <div className="wallet-stats"><span><b>—</b><small>Ajouts ce mois</small></span><span><b>—</b><small>Taux d’usage</small></span><span><b>—</b><small>Scans entrée</small></span></div>
        </article>
      </section>

      <section className="panel bookings-panel">
        <div className="panel-header"><div><span className="panel-kicker">PLANNING</span><h2>Prochaines réservations</h2></div><button className="text-button">Voir le planning <ChevronRight size={15} /></button></div>
        <Table>
          <TableHeader><TableRow><TableHead>HEURE</TableHead><TableHead>CLIENT</TableHead><TableHead>PACK</TableHead><TableHead>PILOTES</TableHead><TableHead>MONTANT</TableHead><TableHead>STATUT</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {filteredBookings.map((booking) => (
              <TableRow key={booking.id} onClick={() => setSelectedBooking(booking)} className="booking-row">
                <TableCell><strong className="time-cell">{booking.time}</strong><small>{booking.id}</small></TableCell>
                <TableCell><div className="customer-cell"><span>{booking.initials}</span><p><b>{booking.customer}</b><small>{booking.source}</small></p></div></TableCell>
                <TableCell><b>{booking.pack}</b></TableCell>
                <TableCell><UsersRound size={14} /> {booking.racers}</TableCell>
                <TableCell><b>{booking.amount}</b></TableCell>
                <TableCell><StatusPill status={booking.status} /></TableCell>
                <TableCell><ChevronRight size={16} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filteredBookings.length === 0 && <div className="empty-state"><Search size={23} /><strong>Aucun résultat</strong><span>Essayez un autre nom ou numéro de réservation.</span></div>}
      </section>

      <Sheet open={Boolean(selectedBooking)} onOpenChange={(open) => !open && setSelectedBooking(null)}>
        <SheetContent className="booking-sheet">
          {selectedBooking && <>
            <SheetHeader><SheetDescription>RÉSERVATION {selectedBooking.id}</SheetDescription><SheetTitle>{selectedBooking.customer}</SheetTitle></SheetHeader>
            <div className="sheet-body">
              <div className="sheet-status"><StatusPill status={selectedBooking.status} /><span>{selectedBooking.time} · Aujourd’hui</span></div>
              <div className="ticket-visual">
                <span><Flag size={18} /> {selectedBooking.pack}</span><strong>{selectedBooking.amount}</strong><small>{selectedBooking.racers} pilotes · Piste Indoor A</small>
                <div><QrCode size={72} /><p>Scannez à l’accueil<small>Code sécurisé {selectedBooking.id}</small></p></div>
              </div>
              <div className="detail-list">
                <p><span>Source</span><b>{selectedBooking.source}</b></p>
                <p><span>Paiement</span><b>{selectedBooking.status === "À encaisser" ? "À régler sur place" : "Validé"}</b></p>
                <p><span>Créneau</span><b>{selectedBooking.time} – {Number(selectedBooking.time.slice(0, 2)) + 1}:00</b></p>
              </div>
              <button className="primary-button full"><QrCode size={17} /> Ouvrir le ticket</button>
              <button className="secondary-button full">Modifier la réservation</button>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </>
  );
}

type RouteSnapshot = { points: RoutePoint[]; start: number; finish: number };
type TrackAccuracy = 1 | 2 | 3;

const trackAccuracyOptions: Record<TrackAccuracy, { label: string; tolerance: number; spacing: number }> = {
  1: { label: "Simple", tolerance: 9, spacing: 22 },
  2: { label: "Équilibrée", tolerance: 5, spacing: 14 },
  3: { label: "Précise", tolerance: 2.5, spacing: 9 },
};

function distanceToSegment(point: RoutePoint, start: RoutePoint, end: RoutePoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
}

function simplifyStroke(points: RoutePoint[], tolerance: number, minimumSpacing: number): RoutePoint[] {
  if (points.length <= 3) return points;
  let stroke = points;
  if (Math.hypot(points[0].x - points[points.length - 1].x, points[0].y - points[points.length - 1].y) < minimumSpacing) {
    stroke = points.slice(0, -1);
  }

  const simplifySection = (section: RoutePoint[]): RoutePoint[] => {
    if (section.length <= 2) return section;
    let furthestIndex = 0;
    let furthestDistance = 0;
    for (let index = 1; index < section.length - 1; index += 1) {
      const distance = distanceToSegment(section[index], section[0], section[section.length - 1]);
      if (distance > furthestDistance) { furthestDistance = distance; furthestIndex = index; }
    }
    if (furthestDistance <= tolerance) return [section[0], section[section.length - 1]];
    const before = simplifySection(section.slice(0, furthestIndex + 1));
    const after = simplifySection(section.slice(furthestIndex));
    return [...before.slice(0, -1), ...after];
  };

  const simplified = simplifySection(stroke);
  const spaced = [simplified[0]];
  for (let index = 1; index < simplified.length; index += 1) {
    const point = simplified[index];
    const previous = spaced[spaced.length - 1];
    const isEndpoint = index === simplified.length - 1;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumSpacing) spaced.push(point);
    else if (isEndpoint && spaced.length > 1) spaced[spaced.length - 1] = point;
  }
  return spaced.length >= 3 ? spaced : simplified;
}

function RaceCircuitMap({ selectedKart, drivers = [] }: { selectedKart: string; drivers?: LiveDriver[] }) {
  const [routePoints, setRoutePoints] = useState<RoutePoint[]>(defaultRoutePoints);
  const [editing, setEditing] = useState(false);
  const [markerMode, setMarkerMode] = useState<"start" | "finish" | null>(null);
  const [startIndex, setStartIndex] = useState(13);
  const [finishIndex, setFinishIndex] = useState(13);
  const [history, setHistory] = useState<RouteSnapshot[]>([]);
  const [editorTool, setEditorTool] = useState<"adjust" | "draw">("adjust");
  const [isDrawing, setIsDrawing] = useState(false);
  const [trackAccuracy, setTrackAccuracy] = useState<TrackAccuracy>(2);
  const drawingRef = useRef(false);
  const draggingIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem("megakart-track-layout");
        if (!saved) return;
        const parsed = JSON.parse(saved) as { version?: number; points?: RoutePoint[]; start?: number; finish?: number };
        if (Array.isArray(parsed.points) && parsed.points.length >= 3) {
          const balanced = trackAccuracyOptions[2];
          const restoredPoints = parsed.version === TRACK_LAYOUT_VERSION
            ? parsed.points
            : parsed.points.map((point) => ({ ...point, x: point.x * (TRACK_WIDTH / LEGACY_TRACK_WIDTH) }));
          setRoutePoints(simplifyStroke(restoredPoints, balanced.tolerance, balanced.spacing));
        }
        if (typeof parsed.start === "number") setStartIndex(parsed.start);
        if (typeof parsed.finish === "number") setFinishIndex(parsed.finish);
      } catch {
        // Keep the safe default route when local data is malformed.
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  const saveRoute = () => {
    window.localStorage.setItem("megakart-track-layout", JSON.stringify({ version: TRACK_LAYOUT_VERSION, points: routePoints, start: startIndex, finish: finishIndex }));
    notifyTrackChanged();
    setEditing(false);
    setMarkerMode(null);
    setEditorTool("adjust");
    setHistory([]);
  };

  const recordHistory = () => setHistory((current) => [...current.slice(-29), {
    points: routePoints.map((point) => ({ ...point })), start: startIndex, finish: finishIndex,
  }]);

  const undoRoute = () => {
    const previous = history[history.length - 1];
    if (!previous) return;
    setRoutePoints(previous.points);
    setStartIndex(previous.start);
    setFinishIndex(previous.finish);
    setHistory((current) => current.slice(0, -1));
    setMarkerMode(null);
  };

  const resetRoute = () => {
    recordHistory();
    setRoutePoints(defaultRoutePoints);
    setStartIndex(13);
    setFinishIndex(13);
    window.localStorage.removeItem("megakart-track-layout");
    notifyTrackChanged();
  };

  const pointFromClient = (clientX: number, clientY: number, svg: SVGSVGElement): RoutePoint => {
    const screenMatrix = svg.getScreenCTM();
    if (screenMatrix) {
      const svgPoint = new DOMPoint(clientX, clientY).matrixTransform(screenMatrix.inverse());
      return {
        x: Math.max(4, Math.min(TRACK_WIDTH - 4, svgPoint.x)),
        y: Math.max(4, Math.min(TRACK_HEIGHT - 4, svgPoint.y)),
      };
    }
    const rect = svg.getBoundingClientRect();
    return {
      x: Math.max(4, Math.min(TRACK_WIDTH - 4, ((clientX - rect.left) / rect.width) * TRACK_WIDTH)),
      y: Math.max(4, Math.min(TRACK_HEIGHT - 4, ((clientY - rect.top) / rect.height) * TRACK_HEIGHT)),
    };
  };

  const nearestPointIndex = (point: RoutePoint) => routePoints.reduce((nearest, candidate, index) => {
    const currentDistance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    const nearestDistance = Math.hypot(routePoints[nearest].x - point.x, routePoints[nearest].y - point.y);
    return currentDistance < nearestDistance ? index : nearest;
  }, 0);

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!editing || event.button !== 0) return;
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget);
    if (editorTool === "draw") {
      recordHistory();
      drawingRef.current = true;
      setIsDrawing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      setRoutePoints([point]);
      setStartIndex(0);
      setFinishIndex(0);
      return;
    }
    if (!markerMode) {
      const index = nearestPointIndex(point);
      const candidate = routePoints[index];
      if (Math.hypot(candidate.x - point.x, candidate.y - point.y) <= 26) {
        recordHistory();
        draggingIndexRef.current = index;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      return;
    }
    recordHistory();
    const index = nearestPointIndex(point);
    if (markerMode === "start") setStartIndex(index); else setFinishIndex(index);
    setMarkerMode(null);
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!editing) return;
    event.preventDefault();
    if (editorTool === "draw") return;
    recordHistory();
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget);
    let bestSegment = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    routePoints.forEach((start, index) => {
      const end = routePoints[(index + 1) % routePoints.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const lengthSquared = dx * dx + dy * dy;
      const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
      const projectedX = start.x + ratio * dx;
      const projectedY = start.y + ratio * dy;
      const distance = Math.hypot(point.x - projectedX, point.y - projectedY);
      if (distance < bestDistance) { bestDistance = distance; bestSegment = index; }
    });
    setRoutePoints((current) => {
      const updated = [...current];
      updated.splice(bestSegment + 1, 0, point);
      return updated;
    });
    if (bestSegment < startIndex) setStartIndex((current) => current + 1);
    if (bestSegment < finishIndex) setFinishIndex((current) => current + 1);
  };

  const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (drawingRef.current) {
      const point = pointFromClient(event.clientX, event.clientY, event.currentTarget);
      setRoutePoints((current) => {
        const previous = current[current.length - 1];
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 3) return current;
        return [...current, point];
      });
      return;
    }
    const draggingIndex = draggingIndexRef.current;
    if (draggingIndex === null) return;
    const point = pointFromClient(event.clientX, event.clientY, event.currentTarget);
    setRoutePoints((current) => current.map((item, index) => index === draggingIndex ? point : item));
  };

  const finishDrawing = () => {
    if (!drawingRef.current) { draggingIndexRef.current = null; return; }
    drawingRef.current = false;
    const accuracy = trackAccuracyOptions[trackAccuracy];
    setRoutePoints((current) => simplifyStroke(current, accuracy.tolerance, accuracy.spacing));
    setIsDrawing(false);
    setEditorTool("adjust");
    draggingIndexRef.current = null;
  };

  const routePath = isDrawing
    ? routePoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")
    : makeSmoothRoute(routePoints);
  const startPoint = routePoints[Math.min(startIndex, routePoints.length - 1)];
  const finishPoint = routePoints[Math.min(finishIndex, routePoints.length - 1)];

  return (
    <div className={"race-circuit " + (editing ? "editing " : "") + (editorTool === "draw" ? "drawing" : "")} aria-label="Position en direct des huit karts sur le circuit Indoor A">
      <div className="track-editor-toolbar">
        {!editing ? <button onClick={() => { setEditing(true); setHistory([]); }}><Pencil size={12} /> AJUSTER LA PISTE</button> : <>
          <button disabled={history.length === 0} onClick={undoRoute}><Undo2 size={12} /> ANNULER</button>
          <button className={editorTool === "draw" ? "active" : ""} onClick={() => { setEditorTool("draw"); setMarkerMode(null); }}><Pencil size={12} /> DESSINER</button>
          <button className={markerMode === "start" ? "active" : ""} onClick={() => { setEditorTool("adjust"); setMarkerMode("start"); }}><Crosshair size={12} /> DÉPART</button>
          <button className={markerMode === "finish" ? "active" : ""} onClick={() => { setEditorTool("adjust"); setMarkerMode("finish"); }}><Flag size={12} /> ARRIVÉE</button>
          <button onClick={resetRoute}><RotateCcw size={12} /> RÉINITIALISER</button>
          <label className="track-accuracy"><span>PRÉCISION</span><input type="range" min="1" max="3" step="1" value={trackAccuracy} onChange={(event) => { const value = Number(event.target.value) as TrackAccuracy; const accuracy = trackAccuracyOptions[value]; recordHistory(); setTrackAccuracy(value); setRoutePoints((current) => simplifyStroke(current, accuracy.tolerance, accuracy.spacing)); }} /><b>{trackAccuracyOptions[trackAccuracy].label}</b></label>
          <button className="save" onClick={saveRoute}><Save size={12} /> ENREGISTRER</button>
        </>}
      </div>
      <div className="circuit-grid" />
      <svg viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`} preserveAspectRatio="none" role="img" aria-hidden="true" onContextMenu={handleContextMenu} onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={finishDrawing} onPointerCancel={finishDrawing} onLostPointerCapture={finishDrawing}>
        <path className="circuit-bed" d={routePath} />
        <path className="circuit-line" d={routePath} />
        {!isDrawing && drivers.map((driver, index) => (
          <g key={driver.kart} className={"circuit-kart " + (selectedKart === driver.kart ? "selected" : "")} transform={`translate(${routePoints[Math.floor(index * routePoints.length / Math.max(drivers.length, 1))].x} ${routePoints[Math.floor(index * routePoints.length / Math.max(drivers.length, 1))].y})`}>
            <circle r={selectedKart === driver.kart ? 13 : 10} style={{ fill: driver.color }} />
            <text textAnchor="middle" y="3.5">{driver.kart}</text>
          </g>
        ))}
        {!isDrawing && <><g className="route-marker start-marker" transform={`translate(${startPoint.x} ${startPoint.y})`}><circle r="12" /><text textAnchor="middle" y="3.5">D</text></g>
        <g className="route-marker finish-marker" transform={`translate(${finishPoint.x} ${finishPoint.y})`}><circle r="12" /><text textAnchor="middle" y="3.5">A</text></g></>}
        {editing && editorTool === "adjust" && routePoints.map((point, index) => <g key={index} data-handle="true" className="route-handle-group" transform={`translate(${point.x} ${point.y})`} onDoubleClick={(event) => { event.stopPropagation(); if (routePoints.length > 3) { setRoutePoints((current) => current.filter((_, pointIndex) => pointIndex !== index)); if (index < startIndex) setStartIndex((current) => current - 1); if (index < finishIndex) setFinishIndex((current) => current - 1); } }}><circle className="route-handle-hit" r="18" /><circle className="route-handle" r="5.5" /></g>)}
      </svg>
      <div className="map-compass"><span>N</span><i /></div>
      <div className="circuit-label"><span>{editing ? editorTool === "draw" ? "MAINTENEZ LE CLIC GAUCHE ET DESSINEZ LA PISTE" : markerMode ? `CLIQUEZ POUR PLACER ${markerMode === "start" ? "LE DÉPART" : "L’ARRIVÉE"}` : "GLISSEZ LES POINTS · CLIC DROIT POUR AJOUTER · DOUBLE-CLIC POUR SUPPRIMER" : "SECTEUR 3"}</span><b>Indoor A · 620 m</b></div>
    </div>
  );
}

function LiveRaceView() {
  const roster = useActiveRoster(); // active MegaKart session → transponder→name/kart overlay
  const live = useLiveRace(roster);
  const drivers = live.drivers;
  const [selectedKart, setSelectedKart] = useState<string | null>(null);
  const selectedDriver = drivers.find((driver) => driver.kart === selectedKart) ?? drivers[0] ?? null;
  const bestDriver = drivers.filter((d) => d.best && d.best !== "—").sort((a, b) => a.best.localeCompare(b.best))[0] ?? null;
  const laps = drivers.reduce((max, d) => Math.max(max, d.laps), 0);
  const statusBadge = {
    running: { cls: "live", label: "● EN DIRECT" },
    finished: { cls: "wait", label: "SESSION TERMINÉE" },
    waiting: { cls: "wait", label: "EN ATTENTE DE DÉPART" },
    // deriveStatus() returns "idle" when the bridge is NOT attached to a feed socket, so the
    // old "FEED CONNECTÉ" label asserted the exact opposite of the truth.
    idle: { cls: "demo", label: "AUCUN FLUX" },
    offline: { cls: "demo", label: "PONT HORS LIGNE" },
  }[live.status];
  return (
    <div className="race-console">
      <header className="race-console-header">
        <div><span className="race-live"><i /> COURSE EN DIRECT</span><h1>RACE CONTROL</h1><p>Flux temps réel Apex GoKarts · {drivers.length} pilote{drivers.length > 1 ? "s" : ""}</p></div>
        <div className="race-session-actions">
          <span className={"race-network race-feed-" + (live.bridgeConnected ? (live.feedConnected ? "live" : "wait") : "demo")}><i /> APEX {live.bridgeConnected ? (live.feedConnected ? "CONNECTÉ" : "PONT OK") : "HORS LIGNE"}</span>
          <span className={"race-network race-feed-" + statusBadge.cls}><Zap size={13} /> {statusBadge.label}</span>
          <button type="button" className="race-network race-bigscreen-button" onClick={() => window.open("/#ecran", "megakart-ecran")}><MonitorPlay size={13} /> ÉCRAN GÉANT</button>
        </div>
      </header>

      {/* MegaKart's own race window, counted from raw crossings — independent of GoKarts'
          session boundaries and of its lap arithmetic. */}
      <ChronoPanel sessionId={live.megakartSession?.id ?? null} sessionName={live.megakartSession?.name ?? null} />

      <section className="race-summary-strip" aria-label="Résumé de la course">
        <div className="summary-primary"><span>MEILLEUR TOUR</span><strong>{bestDriver ? bestDriver.best : "—"}</strong><b>{bestDriver ? `${bestDriver.name} · ${bestDriver.kart}` : "—"}</b></div>
        <div><span>PILOTES</span><strong>{drivers.length || "—"}</strong><b>EN PISTE</b></div>
        <div><span>TOUR MAX</span><strong>{laps || "—"}</strong><b>TOURS BOUCLÉS</b></div>
        <div className="summary-status"><span>STATUT</span><strong><i /> {live.sessionActive ? "EN COURSE" : "EN ATTENTE"}</strong><b>{live.feedConnected ? "FEED OK" : "FEED HORS LIGNE"}</b></div>
      </section>

      {drivers.length === 0 ? (
        <section className="race-monitor-grid">
          <article className="race-module timing-module" style={{ gridColumn: "1 / -1" }}>
            <div className="race-module-head"><div><span>CHRONOMÉTRAGE</span><h2>CLASSEMENT LIVE</h2></div><b>0</b></div>
            <div className="empty-state" style={{ padding: "48px 20px" }}>
              <Flag size={26} />
              <strong>{live.feedConnected ? "En attente du départ de la course" : "En attente du flux de chronométrage"}</strong>
              <span>{live.feedConnected
                ? "Session détectée. Les pilotes, karts et temps au tour s’afficheront dès le drapeau vert."
                : "Démarrez une session sur le système de chronométrage GoKarts pour voir l’activité en direct."}</span>
            </div>
          </article>
        </section>
      ) : (
        <section className="race-monitor-grid">
          <article className="race-module circuit-module">
            <div className="race-module-head"><div><span>POSITION LIVE</span><h2>CARTE DU CIRCUIT</h2></div><b><i /> {live.sessionActive ? "EN COURSE" : "EN ATTENTE"}</b></div>
            <RaceCircuitMap selectedKart={selectedKart ?? ""} drivers={drivers} />
            <div className="circuit-stats"><span><small>PILOTES</small><b>{drivers.length}</b></span><span><small>TOUR MAX</small><b>{laps}</b></span><span><small>MEILLEUR</small><b className="lime">{bestDriver ? bestDriver.best : "—"}</b></span><span><small>STATUT</small><b>{live.sessionActive ? "VERT" : "—"}</b></span></div>
          </article>

          <article className="race-module timing-module">
            <div className="race-module-head"><div><span>CHRONOMÉTRAGE</span><h2>CLASSEMENT LIVE</h2></div><b>{drivers.length}</b></div>
            <div className="timing-head"><span>POS</span><span>PILOTE</span><span>DERNIER</span><span>ÉCART</span></div>
            <div className="timing-list">
              {drivers.map((driver) => (
                <button key={driver.kart} onClick={() => setSelectedKart(driver.kart)} className={selectedKart === driver.kart ? "selected" : ""} style={{ "--driver": driver.color } as React.CSSProperties}>
                  <strong>{String(driver.rank).padStart(2, "0")}</strong>
                  <span className="timing-driver"><i>{driver.name.split(" ").map((part) => part[0]).join("")}</i><span><b>{driver.name}</b><small>KART {driver.kart} · {driver.laps} tours · best {driver.best}</small></span></span>
                  <b>{driver.last}</b><em>{driver.gap}</em>
                </button>
              ))}
            </div>
          </article>
        </section>
      )}

      {selectedDriver && (
        <section className="race-driver-summary">
          <article className="race-module driver-focus" style={{ "--driver": selectedDriver.color } as React.CSSProperties}>
            <div className="race-module-head"><div><span>PILOTE SÉLECTIONNÉ</span><h2>{selectedDriver.name.toUpperCase()}</h2></div><strong>KART {selectedDriver.kart}</strong></div>
            <div className="driver-focus-body"><div className="driver-position"><span>P{selectedDriver.rank}</span><small>POSITION</small></div><div><span>MEILLEUR</span><strong>{selectedDriver.best}</strong><span>DERNIER TOUR</span><strong>{selectedDriver.last}</strong></div><div><span>TOURS</span><strong className="lime">{selectedDriver.laps}</strong><span>ÉCART</span><strong>{selectedDriver.gap}</strong></div></div>
          </article>
        </section>
      )}
    </div>
  );
}

function SessionsView({ bridgeSync }: { bridgeSync: BridgeSync }) {
  const { sessions, activeId, create, remove, setActive, setState } = useSessions();
  const gokarts = useGokartsSessions(); // live GoKarts session plan (from GoServer export)
  const { sessions: history } = useHistory();
  const { signups, formUrl, state: signupState, update: updateSignup } = useSignups();
  const [result, setResult] = useState<HistorySession | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<SessionType>("practice");
  const [durationMin, setDurationMin] = useState(8);
  const emptyRows = (): DriverRow[] => [
    { name: "", kart: "", transponder: "" },
    { name: "", kart: "", transponder: "" },
  ];
  const [rows, setRows] = useState(emptyRows());
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);

  const inp: React.CSSProperties = { background: "#0e1520", color: "#e8eef5", border: "1px solid #26303d", borderRadius: 8, padding: "9px 11px", fontSize: 14, width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
  const lab: React.CSSProperties = { fontSize: 11, letterSpacing: ".04em", color: "#8aa0b6", textTransform: "uppercase", marginBottom: 6, display: "block" };

  const setRow = (i: number, field: "name" | "kart" | "transponder", val: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [field]: val } : row)));

  // A group that registered on their phones: drop every player into a free driver row, keeping the
  // pilot each of them picked. The operator only has to add karts and transponders.
  const addSignupToSession = (signup: Signup) => {
    const players = signupPlayers(signup);
    setRows((current) => {
      const next = [...current];
      for (const player of players) {
        const row: DriverRow = { name: player.name, kart: "", transponder: "", color: player.color };
        const index = next.findIndex((r) => !r.name.trim());
        if (index < 0) next.push(row);
        else next[index] = { ...next[index], ...row };
      }
      return next;
    });
    void updateSignup(signup.id, "assigned");
    setNotice({
      tone: "ok",
      text: players.length > 1
        ? `${players.length} pilotes ajoutés à la session. Renseignez leurs karts et transpondeurs.`
        : `${signup.name} ajouté(e) à la session. Renseignez son kart et son transpondeur.`,
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const drivers = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name.trim(), kartNumber: Number(r.kart) || 0, transponder: r.transponder.trim() || undefined, color: r.color }));
    if (!name.trim() || drivers.length === 0) {
      setNotice({ tone: "warn", text: "Un nom de session et au moins un pilote sont requis." });
      return;
    }
    create({ name, type, durationSec: durationMin * 60, drivers });
    setNotice({ tone: "ok", text: `Session « ${name.trim()} » créée côté MegaKart et activée. Les noms s’afficheront en direct dès que le transpondeur passe.` });
    setName("");
    setDurationMin(8);
    setType("practice");
    setRows(emptyRows());
  };

  const sendToApex = async (id: string) => {
    const s = sessions.find((x) => x.id === id);
    if (!s) return;
    const res = await apexController.createSession(s);
    if (res.ok) {
      setState(id, "APEX_CREATED");
      setNotice({ tone: "ok", text: `Session créée dans Apex (id ${res.apexSessionId}).` });
    } else {
      setNotice({
        tone: "warn",
        text:
          res.reason === "NOT_CONFIGURED"
            ? "Écriture Apex non configurée : la session reste côté MegaKart (« En attente Apex »). La création automatique dans GoKarts s’activera avec l’API Sessions (9122)."
            : `Apex : ${res.reason}`,
      });
    }
  };

  const stateTone = (st: SessionState) => (st === "RUNNING" ? "live" : st === "FINISHED" ? "confirmed" : "pending");

  return (
    <div className="reservations-page">
      <div className="page-heading reservations-heading">
        <div>
          <span className="eyebrow"><i /> POSTE DE COMMANDE</span>
          <h1>Sessions MegaKart</h1>
          <p>Créez une session côté MegaKart, assignez pilotes et karts. GoKarts reste le moteur de chronométrage.</p>
          <span className={"bridge-sync is-" + bridgeSync.status} role="status">
            <i />
            {bridgeSync.status === "synced"
              ? bridgeSync.sessionName
                ? `Chronométrage : noms de « ${bridgeSync.sessionName} » en direct`
                : "Chronométrage connecté · aucune session active"
              : bridgeSync.status === "idle"
                ? "Connexion au chronométrage…"
                : bridgeSync.message}
          </span>
        </div>
      </div>

      {notice && (
        <div className="empty-state" style={{ padding: "14px 18px", flexDirection: "row", gap: 10, borderColor: notice.tone === "ok" ? "#2f6d3a" : "#6d5a24", color: notice.tone === "ok" ? "#38e07b" : "#f5a524" }}>
          {notice.tone === "ok" ? <CheckCircle2 size={18} /> : <Zap size={18} />}
          <span style={{ textAlign: "left" }}>{notice.text}</span>
        </div>
      )}

      <SignupPanel
        signups={signups}
        formUrl={formUrl}
        state={signupState}
        onAdd={addSignupToSession}
        onArchive={(signup) => void updateSignup(signup.id, "archived")}
      />

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><div><span className="panel-kicker">NOUVELLE SESSION</span><h2>Créer une session</h2></div></div>
        <form onSubmit={submit} style={{ display: "grid", gap: 16, padding: "4px 2px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
            <label><span style={lab}>Nom de la session</span><input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Course #28" /></label>
            <label><span style={lab}>Type</span>
              <select style={inp} value={type} onChange={(e) => setType(e.target.value as SessionType)}>
                {SESSION_TYPE_LABELS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label><span style={lab}>Durée (min)</span><input style={inp} type="number" min={1} max={240} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value) || 0)} /></label>
          </div>

          <div>
            <span style={lab}>Pilotes &amp; karts</span>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "30px 2fr 1fr 1fr 36px", gap: 10, fontSize: 11, color: "#8aa0b6", textTransform: "uppercase", letterSpacing: ".04em" }}>
                <span /><span>Pilote</span><span>Kart n°</span><span>Transpondeur</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "30px 2fr 1fr 1fr 36px", gap: 10, alignItems: "center" }}>
                  <span title={r.color ? `Pilote choisi à l’inscription` : undefined} style={{ display: "grid", placeItems: "center" }}>
                    {r.color ? <DriverAvatar pilot={r.color} seed={r.name} size="28px" /> : null}
                  </span>
                  <input style={inp} value={r.name} onChange={(e) => setRow(i, "name", e.target.value)} placeholder={`Pilote ${i + 1}`} />
                  <input style={inp} value={r.kart} onChange={(e) => setRow(i, "kart", e.target.value)} placeholder="6" inputMode="numeric" />
                  <input style={inp} value={r.transponder} onChange={(e) => setRow(i, "transponder", e.target.value)} placeholder="23 (optionnel)" />
                  <button type="button" aria-label="Retirer le pilote" onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))} style={{ ...inp, width: 36, height: 38, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}><X size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" className="secondary-button" style={{ marginTop: 10 }} onClick={() => setRows((r) => [...r, { name: "", kart: "", transponder: "" }])}><PlusCircle size={15} /> Ajouter un pilote</button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="primary-button"><Flag size={16} /> Créer la session</button>
            <small style={{ color: "#8aa0b6" }}>La session est créée côté MegaKart (« En attente Apex ») — GoKarts n’est pas modifié.</small>
          </div>
        </form>
      </section>

      <section className="qr-reservations-list" aria-label="Sessions créées" style={{ marginTop: 18 }}>
        <header className="qr-list-header" style={{ gridTemplateColumns: "1.6fr 1fr 1fr 2fr 1.4fr" }}>
          <span>SESSION</span><span>TYPE</span><span>ÉTAT</span><span>PILOTES</span><span>ACTIONS</span>
        </header>
        {sessions.length === 0 && <div className="empty-state"><PlusCircle size={22} /><strong>Aucune session</strong><span>Créez votre première session ci-dessus.</span></div>}
        {sessions.map((s) => (
          <article className="qr-reservation-row" key={s.id} style={{ gridTemplateColumns: "1.6fr 1fr 1fr 2fr 1.4fr", alignItems: "center", outline: activeId === s.id ? "1px solid #38e07b" : "none" }}>
            <div className="qr-session"><strong>{s.name}</strong><span>{Math.round(s.durationSec / 60)} min · {s.id}</span></div>
            <div><b>{SESSION_TYPE_LABELS.find((t) => t.value === s.type)?.label ?? s.type}</b></div>
            <div><span className={"status-pill status-" + stateTone(s.state)}><i />{STATE_LABELS[s.state]}</span></div>
            <div style={{ fontSize: 13 }}>
              {s.drivers.length === 0 ? <small style={{ color: "#8aa0b6" }}>—</small> : s.drivers.map((d) => (
                <div key={d.id}><b>{d.name}</b> <small style={{ color: "#8aa0b6" }}>· Kart {d.kartNumber}{d.transponder ? ` · T${d.transponder}` : ""}</small></div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {s.resultId && (
                <button className="primary-button" onClick={() => setResult(history.find((h) => h.id === s.resultId) ?? null)} disabled={!history.some((h) => h.id === s.resultId)} title="Podium, classement et QR souvenir">
                  <Trophy size={14} /> Résultats
                </button>
              )}
              {activeId === s.id
                ? <span className="status-pill status-live" style={{ alignSelf: "center" }}><Radio size={12} /> ACTIVE</span>
                : !s.resultId && <button className="secondary-button" onClick={() => setActive(s.id)}><Radio size={14} /> Activer</button>}
              <button className="secondary-button" onClick={() => sendToApex(s.id)} title="Créer dans GoKarts (Apex)"><Zap size={14} /> Apex</button>
              <button className="secondary-button" aria-label="Supprimer" onClick={() => remove(s.id)}><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </section>

      <section className="qr-reservations-list" aria-label="Sessions GoKarts" style={{ marginTop: 18 }}>
        <div className="panel-header" style={{ padding: "0 4px 10px" }}>
          <div><span className="panel-kicker">GOKARTS · EN DIRECT</span><h2>Sessions sur le système de chronométrage</h2></div>
          <small style={{ color: "#8aa0b6" }}>{gokarts.track ?? ""}{gokarts.date ? ` · ${String(gokarts.date)}` : ""}</small>
        </div>
        <header className="qr-list-header" style={{ gridTemplateColumns: "0.6fr 1.4fr 1fr 1fr 1fr" }}>
          <span>N°</span><span>TYPE</span><span>DURÉE</span><span>ÉTAT</span><span>PILOTES</span>
        </header>
        {gokarts.sessions.length === 0 && <div className="empty-state"><Flag size={22} /><strong>{gokarts.loaded ? "Aucune session GoKarts" : "Chargement…"}</strong><span>Les sessions créées dans GoKarts apparaîtront ici (via GoServer).</span></div>}
        {gokarts.sessions.map((g) => (
          <article className="qr-reservation-row" key={g.index} style={{ gridTemplateColumns: "0.6fr 1.4fr 1fr 1fr 1fr", alignItems: "center" }}>
            <div><strong>{String(g.num).padStart(2, "0")}</strong></div>
            <div><b>{SESSION_TYPE_LABELS.find((t) => t.value === g.type)?.label ?? g.type}</b>{g.title ? <small style={{ color: "#8aa0b6", display: "block" }}>{g.title}</small> : null}</div>
            <div>{Math.round(g.duration / 60)} min</div>
            <div><span className={"status-pill status-" + (g.state === "finished" ? "confirmed" : g.state ? "live" : "pending")}><i />{g.state === "finished" ? "Terminée" : g.state ? g.state : "Prête"}</span></div>
            <div><b>{g.drivers}</b> <small style={{ color: "#8aa0b6" }}>pilote{g.drivers > 1 ? "s" : ""}</small></div>
          </article>
        ))}
        <small style={{ color: "#8aa0b6", display: "block", marginTop: 8 }}>Le plan GoKarts affiche le nombre de pilotes. Les noms des pilotes nécessitent l’API Sessions (à obtenir d’Apex).</small>
      </section>

      <ResultSheet result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function StatsView() {
  const { sessions, loaded } = useHistory();
  const [result, setResult] = useState<HistorySession | null>(null);
  const fmt = (ms: number | null | undefined) => {
    if (ms == null) return "—";
    const s = ms / 1000, m = Math.floor(s / 60);
    return m > 0 ? `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}` : s.toFixed(3);
  };
  const totalLaps = sessions.reduce((n, s) => n + (s.laps || 0), 0);
  const records = (() => {
    const map = new Map<string, { name: string; bestLapMs: number | null; laps: number; sessions: number; wins: number }>();
    for (const s of sessions) {
      for (const d of s.drivers) {
        let e = map.get(d.name);
        if (!e) { e = { name: d.name, bestLapMs: null, laps: 0, sessions: 0, wins: 0 }; map.set(d.name, e); }
        e.sessions += 1;
        e.laps += d.laps || 0;
        if (d.bestLapMs != null && (e.bestLapMs == null || d.bestLapMs < e.bestLapMs)) e.bestLapMs = d.bestLapMs;
        if (s.winner === d.name) e.wins += 1;
      }
    }
    return [...map.values()].sort((a, b) => (a.bestLapMs ?? 9e15) - (b.bestLapMs ?? 9e15));
  })();
  const overallBest = records.find((r) => r.bestLapMs != null) ?? null;

  const dt = (iso: string) => { try { return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };

  return (
    <div className="clients-history-page">
      <header className="clients-history-hero">
        <div><span className="eyebrow"><i /> STATISTIQUES</span><h1>Historique &amp; records</h1><p>Sessions terminées capturées en direct depuis GoKarts, avec les meilleurs temps par pilote.</p></div>
        <span className="history-only-badge"><Trophy size={14} /> {sessions.length} SESSION{sessions.length > 1 ? "S" : ""}</span>
      </header>

      <section className="client-history-kpis">
        <article><Flag size={18} /><span><small>SESSIONS</small><strong>{sessions.length}</strong><b>Terminées</b></span></article>
        <article><Activity size={18} /><span><small>TOURS TOTAUX</small><strong>{totalLaps}</strong><b>Cumulés</b></span></article>
        <article><Zap size={18} /><span><small>MEILLEUR TOUR</small><strong>{overallBest ? fmt(overallBest.bestLapMs) : "—"}</strong><b>{overallBest ? overallBest.name : "—"}</b></span></article>
        <article><UsersRound size={18} /><span><small>PILOTES</small><strong>{records.length}</strong><b>Classés</b></span></article>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-header"><div><span className="panel-kicker">RECORDS</span><h2>Classement des pilotes</h2></div><Trophy size={19} className="muted-icon" /></div>
        {records.length === 0 ? (
          <div className="empty-state"><Trophy size={22} /><strong>{loaded ? "Aucune session archivée" : "Chargement…"}</strong><span>Les records s’afficheront après la première session terminée.</span></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="catalog-table" style={{ width: "100%" }}>
              <thead><tr><th>#</th><th>PILOTE</th><th>MEILLEUR TOUR</th><th>SESSIONS</th><th>TOURS</th><th>VICTOIRES</th></tr></thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={r.name}>
                    <td><strong className={i === 0 ? "lime" : ""}>{String(i + 1).padStart(2, "0")}</strong></td>
                    <td><strong>{r.name}</strong></td>
                    <td className={i === 0 ? "lime" : ""}>{fmt(r.bestLapMs)}</td>
                    <td>{r.sessions}</td>
                    <td>{r.laps}</td>
                    <td>{r.wins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="past-client-list" aria-label="Historique des sessions" style={{ marginTop: 18 }}>
        <header style={{ gridTemplateColumns: "1.4fr 1fr 0.7fr 1fr 2fr 1.1fr" }}><span>SESSION</span><span>VAINQUEUR</span><span>TOURS</span><span>MEILLEUR</span><span>PILOTES</span><span>SOUVENIR</span></header>
        {sessions.length === 0 && <div className="empty-state"><Flag size={22} /><strong>Aucune session</strong><span>L’historique se remplit à chaque session terminée.</span></div>}
        {sessions.map((s) => (
          <article key={s.id} style={{ gridTemplateColumns: "1.4fr 1fr 0.7fr 1fr 2fr 1.1fr", alignItems: "center" }}>
            <div className="past-client-last"><strong>{s.megakart?.name || dt(s.archivedAt)}</strong><small>{s.megakart ? dt(s.archivedAt) : s.source}</small></div>
            <div><b>{s.winner ?? "—"}</b></div>
            <div><strong>{s.laps}</strong></div>
            <div><strong className="lime">{fmt(s.bestLapMs)}</strong><small>{s.bestBy ?? ""}</small></div>
            <div style={{ fontSize: 13 }}>{s.drivers.map((d) => <div key={d.id}><b>{d.name}</b> <small style={{ color: "#8aa0b6" }}>· Kart {d.kart} · {d.laps} tr · {fmt(d.bestLapMs)}</small></div>)}</div>
            <div><button type="button" className="secondary-button" onClick={() => setResult(s)}><QrCode size={14} /> QR &amp; podium</button></div>
          </article>
        ))}
      </section>

      <ResultSheet result={result} onClose={() => setResult(null)} />
    </div>
  );
}

function PaymentMethod({ method }: { method: QrReservation["payment"] }) {
  const isCard = method === "Carte bancaire";
  return <span className={"payment-method " + (isCard ? "card" : "cash")}>{isCard ? <CreditCard size={14} /> : <Banknote size={14} />}{method}</span>;
}

function ReservationsView({ search }: { search: string }) {
  const [paymentFilter, setPaymentFilter] = useState<"Tous" | QrReservation["payment"]>("Tous");
  const filteredReservations = useMemo(() => {
    const query = search.trim().toLowerCase();
    return qrReservations.filter((reservation) => {
      const matchesPayment = paymentFilter === "Tous" || reservation.payment === paymentFilter;
      const searchable = [reservation.id, reservation.time, reservation.organizer, reservation.pack, reservation.payment, ...reservation.friends].join(" ").toLowerCase();
      return matchesPayment && (!query || searchable.includes(query));
    });
  }, [paymentFilter, search]);

  return (
    <div className="reservations-page">
      <div className="page-heading reservations-heading">
        <div><span className="eyebrow"><i /> INSCRIPTIONS QR</span><h1>Réservations sessions</h1><p>Clients inscrits par QR code avec leur groupe d’amis.</p></div>
        <div className="payment-filter" aria-label="Filtrer par mode de paiement">
          <button className={paymentFilter === "Tous" ? "active" : ""} onClick={() => setPaymentFilter("Tous")}>Tous</button>
          <button className={paymentFilter === "Carte bancaire" ? "active" : ""} onClick={() => setPaymentFilter("Carte bancaire")}><CreditCard size={13} /> Carte</button>
          <button className={paymentFilter === "Espèces" ? "active" : ""} onClick={() => setPaymentFilter("Espèces")}><Banknote size={13} /> Espèces</button>
        </div>
      </div>

      <section className="qr-reservations-list" aria-label="Liste des réservations QR">
        <header className="qr-list-header"><span>SESSION</span><span>CLIENT QR</span><span>GROUPE D’AMIS</span><span>PACK</span><span>PAIEMENT</span><span>MONTANT</span><span>STATUT</span></header>
        {filteredReservations.map((reservation) => (
          <article className="qr-reservation-row" key={reservation.id}>
            <div className="qr-session"><strong>{reservation.time}</strong><span>{reservation.id}</span></div>
            <div className="qr-customer"><i>{reservation.initials}</i><span><strong>{reservation.organizer}</strong><small><QrCode size={11} /> Scanné à {reservation.scannedAt}</small></span></div>
            <div className="qr-friends">
              <div className="friend-avatars">{reservation.friends.slice(0, 4).map((friend, index) => <i key={friend} style={{ zIndex: 5 - index }}>{friend.split(" ").map((part) => part[0]).join("")}</i>)}</div>
              <span><strong>{reservation.friends.length + 1} pilotes</strong><small>{reservation.friends.join(" · ")}</small></span>
            </div>
            <div className="qr-pack"><strong>{reservation.pack}</strong><small>Indoor A</small></div>
            <PaymentMethod method={reservation.payment} />
            <strong className="qr-amount">{reservation.amount}</strong>
            <span className="qr-confirmed"><CheckCircle2 size={14} /> Inscrit</span>
          </article>
        ))}
        {filteredReservations.length === 0 && <div className="empty-state"><Search size={23} /><strong>Aucune réservation</strong><span>Aucun résultat pour ce filtre ou cette recherche.</span></div>}
      </section>
    </div>
  );
}

function ClientsView({ search }: { search: string }) {
  const [selectedClient, setSelectedClient] = useState<PastClient | null>(null);
  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return pastClients;
    return pastClients.filter((client) => [client.id, client.name, client.phone, client.email, client.favorite, client.payment, client.profile].join(" ").toLowerCase().includes(query));
  }, [search]);
  const totalSessions = pastClients.reduce((sum, client) => sum + client.sessions, 0);

  return (
    <div className="clients-history-page">
      <header className="clients-history-hero">
        <div><span className="eyebrow"><i /> HISTORIQUE CLIENTS</span><h1>Clients passés</h1><p>Uniquement les clients ayant déjà terminé au moins une session. Les inscriptions futures restent dans Réservations.</p></div>
        <span className="history-only-badge"><CheckCircle2 size={14} /> SESSIONS TERMINÉES UNIQUEMENT</span>
      </header>

      <section className="client-history-kpis">
        <article><UsersRound size={18} /><span><small>CLIENTS PASSÉS</small><strong>{pastClients.length}</strong><b>Dossiers détaillés</b></span></article>
        <article><Flag size={18} /><span><small>SESSIONS TERMINÉES</small><strong>{totalSessions}</strong><b>Historique cumulé</b></span></article>
        <article><WalletCards size={18} /><span><small>POINTS FIDÉLITÉ</small><strong>{pastClients.reduce((sum, client) => sum + client.points, 0).toLocaleString("fr-FR")}</strong><b>Solde cumulé</b></span></article>
      </section>

      <section className="past-client-list" aria-label="Liste des clients passés">
        <header><span>CLIENT</span><span>CONTACT</span><span>DERNIÈRE SESSION</span><span>HISTORIQUE</span><span>OFFRE PRÉFÉRÉE</span><span>PAIEMENT</span><span>DÉPENSÉ</span><span /></header>
        {filteredClients.map((client) => (
          <article key={client.id}>
            <div className="past-client-identity"><i>{client.initials}</i><span><strong>{client.name}</strong><small>{client.id} · {client.profile}</small></span></div>
            <div className="past-client-contact"><strong>{client.phone}</strong><small>{client.email}</small></div>
            <div className="past-client-last"><strong>{client.lastVisit.split(" · ")[0]}</strong><small>{client.lastVisit.split(" · ")[1]} · Indoor A</small></div>
            <div className="past-client-counts"><strong>{client.sessions} sessions</strong><small>{client.visits} visites</small></div>
            <div className="past-client-offer"><strong>{client.favorite}</strong><small>{client.points} points</small></div>
            <PaymentMethod method={client.payment} />
            <div className="past-client-spend"><strong>{client.spend.toLocaleString("fr-FR")} DH</strong><small>Panier moy. {client.average} DH</small></div>
            <button aria-label={`Voir le dossier de ${client.name}`} onClick={() => setSelectedClient(client)}><ChevronRight size={16} /></button>
          </article>
        ))}
        {filteredClients.length === 0 && <div className="empty-state"><Search size={23} /><strong>Aucun ancien client</strong><span>Aucun dossier ne correspond à cette recherche.</span></div>}
      </section>

      <Sheet open={Boolean(selectedClient)} onOpenChange={(open) => !open && setSelectedClient(null)}>
        <SheetContent className="booking-sheet client-history-sheet">
          {selectedClient && <>
            <SheetHeader><SheetDescription>DOSSIER {selectedClient.id} · CLIENT PASSÉ</SheetDescription><SheetTitle>{selectedClient.name}</SheetTitle></SheetHeader>
            <div className="sheet-body client-sheet-body">
              <div className="client-profile-summary"><i>{selectedClient.initials}</i><span><strong>{selectedClient.profile}</strong><small>Client depuis le {selectedClient.since}</small></span><b>{selectedClient.points}<small>POINTS</small></b></div>
              <div className="detail-list">
                <p><span>Téléphone</span><b>{selectedClient.phone}</b></p><p><span>E-mail</span><b>{selectedClient.email}</b></p><p><span>Dernière session</span><b>{selectedClient.lastVisit}</b></p><p><span>Sessions terminées</span><b>{selectedClient.sessions} · {selectedClient.visits} visites</b></p><p><span>Offre préférée</span><b>{selectedClient.favorite}</b></p><p><span>Paiement habituel</span><b>{selectedClient.payment}</b></p><p><span>Total dépensé</span><b>{selectedClient.spend.toLocaleString("fr-FR")} DH</b></p><p><span>Panier moyen</span><b>{selectedClient.average} DH</b></p>
              </div>
              <div className="client-session-history"><span>DERNIÈRES ACTIVITÉS</span>{selectedClient.history.map((entry) => <article key={`${entry.date}-${entry.offer}`}><i /><div><strong>{entry.offer}</strong><small>{entry.date} · {entry.result}</small></div><b>{entry.amount}</b></article>)}</div>
            </div>
          </>}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function PassLoyaltyView() {
  const [selectedPass, setSelectedPass] = useState("Pro");
  return (
    <div className="commerce-page">
      <header className="commerce-hero">
        <div className="commerce-hero-copy"><span className="eyebrow"><i /> PASS & FIDÉLITÉ</span><h1>Roulez plus.<br /><em>Revenez plus.</em></h1><p>Abonnements mensuels et récompenses de session issus de l’offre officielle Mega Kart.</p></div>
        <div className="commerce-hero-metrics"><span><small>FORMULES</small><strong>03</strong><b>Abonnements mensuels</b></span><span><small>ENTRÉE</small><strong>450 DH</strong><b>Starter · par mois</b></span><span><small>FIDÉLITÉ</small><strong>04</strong><b>Récompenses possibles</b></span></div>
      </header>

      <section className="commerce-section">
        <div className="commerce-section-head"><div><span>ABONNEMENTS MENSUELS</span><h2>Choisir une formule</h2></div><p>Inscription anticipée incluse dans chaque pass.</p></div>
        <div className="subscription-grid">
          {monthlyPasses.map((pass) => (
            <article key={pass.name} className={"subscription-card " + (selectedPass === pass.name ? "selected" : "")}>
              <div className="offer-card-top"><span>PASS MENSUEL</span><b>{pass.price.toLocaleString("fr-FR")} DH<small>/ MOIS</small></b></div>
              <h3>{pass.name.toUpperCase()}</h3>
              <div className="session-count"><TicketCheck size={19} /><strong>{pass.sessions}</strong><span>sessions par mois</span></div>
              <ul>{pass.benefits.map((benefit) => <li key={benefit}><CheckCircle2 size={13} />{benefit}</li>)}</ul>
              <div className="offer-bonus"><Zap size={14} /><span>{pass.bonus}</span></div>
              <p className="offer-audience"><b>PUBLIC</b>{pass.audience}</p>
              <button onClick={() => setSelectedPass(pass.name)}>{selectedPass === pass.name ? <CheckCircle2 size={14} /> : <WalletCards size={14} />}{selectedPass === pass.name ? "FORMULE SÉLECTIONNÉE" : "SÉLECTIONNER"}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="commerce-section loyalty-section">
        <div className="commerce-section-head"><div><span>TIRAGE AU SORT</span><h2>Un cadeau à chaque session</h2></div><p>Un levier de fidélisation avec une récompense différente à chaque tirage.</p></div>
        <div className="reward-grid">
          {loyaltyRewards.map((reward, index) => <article key={reward.card}><span>0{index + 1}</span><Trophy size={20} /><small>{reward.card}</small><strong>{reward.reward}</strong></article>)}
        </div>
      </section>
    </div>
  );
}

function PacksSalesView() {
  const [selectedOffer, setSelectedOffer] = useState("Gold");
  return (
    <div className="commerce-page">
      <header className="commerce-hero packs-hero">
        <div className="commerce-hero-copy"><span className="eyebrow"><i /> PACKS & VENTES</span><h1>Plus vous roulez.<br /><em>Plus vous économisez.</em></h1><p>Packs karting et offres de groupe présentés dans le rapport commercial Mega Kart.</p></div>
        <div className="commerce-hero-metrics"><span><small>PACKS KARTING</small><strong>03</strong><b>Bronze · Silver · Gold</b></span><span><small>À PARTIR DE</small><strong>250 DH</strong><b>3 sessions</b></span><span><small>OFFRES GROUPE</small><strong>02</strong><b>Famille · Amis</b></span></div>
      </header>

      <section className="commerce-section">
        <div className="commerce-section-head"><div><span>PACKS KARTING</span><h2>Offres individuelles</h2></div><p>Des formules progressives pour découvrir, pratiquer ou intensifier l’expérience.</p></div>
        <div className="pack-offer-grid">
          {kartingPacks.map((pack) => (
            <article key={pack.name} className={"pack-offer-card " + (selectedOffer === pack.name ? "selected" : "")}>
              <div className="offer-card-top"><span>PACK {pack.name.toUpperCase()}</span><b>{pack.price} DH</b></div>
              {pack.originalPrice && <small className="old-price">PRIX INITIAL · {pack.originalPrice} DH</small>}
              <h3>{pack.summary}</h3>
              <div className="pack-volume"><strong>{pack.sessions + pack.bonus}</strong><span>SESSIONS AU TOTAL<small>{pack.bonus > 0 ? `${pack.sessions} + ${pack.bonus} offerte${pack.bonus > 1 ? "s" : ""}` : `${pack.sessions} sessions incluses`}</small></span></div>
              <ul>{pack.benefits.map((benefit) => <li key={benefit}><CheckCircle2 size={13} />{benefit}</li>)}</ul>
              <div className="offer-saving"><ArrowDownRight size={14} />{pack.saving}</div>
              <p className="offer-audience"><b>PUBLIC</b>{pack.audience}</p>
              <button onClick={() => setSelectedOffer(pack.name)}>{selectedOffer === pack.name ? <CheckCircle2 size={14} /> : <PackageCheck size={14} />}{selectedOffer === pack.name ? "OFFRE SÉLECTIONNÉE" : "SÉLECTIONNER"}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="commerce-section">
        <div className="commerce-section-head"><div><span>OFFRES DE GROUPE</span><h2>Famille & amis</h2></div><p>Des expériences réunissant plusieurs catégories de participants.</p></div>
        <div className="group-offer-grid">
          {groupPacks.map((offer) => <article key={offer.name}><div><span>OFFRE GROUPE</span><h3>{offer.name}</h3><p>{offer.capacity}</p></div><strong>{offer.price} DH</strong><ul>{offer.benefits.map((benefit) => <li key={benefit}><CheckCircle2 size={13} />{benefit}</li>)}</ul><small>{offer.audience}</small></article>)}
        </div>
      </section>
    </div>
  );
}

function ReportsView() {
  return (
    <div className="commerce-page reports-page">
      <header className="commerce-hero reports-hero">
        <div className="commerce-hero-copy"><span className="eyebrow"><i /> RAPPORT COMMERCIAL</span><h1>Catalogue<br /><em>Mega Kart.</em></h1><p>Synthèse fidèle des offres, tarifs, volumes et avantages documentés.</p></div>
        <div className="commerce-hero-metrics"><span><small>OFFRES</small><strong>08</strong><b>Commercialisées</b></span><span><small>PRIX MIN.</small><strong>250 DH</strong><b>Pack Bronze</b></span><span><small>PRIX MAX.</small><strong>1 600 DH</strong><b>VIP Racing · mois</b></span></div>
      </header>

      <section className="report-summary-grid">
        <article><PackageCheck size={19} /><span><small>PACKS KARTING</small><strong>3</strong><b>3 à 9 sessions</b></span></article>
        <article><WalletCards size={19} /><span><small>ABONNEMENTS</small><strong>3</strong><b>5 à 20 sessions / mois</b></span></article>
        <article><UsersRound size={19} /><span><small>OFFRES GROUPE</small><strong>2</strong><b>Famille et amis</b></span></article>
        <article><Trophy size={19} /><span><small>RÉCOMPENSES</small><strong>4</strong><b>À chaque session</b></span></article>
      </section>

      <section className="report-workspace">
        <article className="report-price-panel">
          <div className="commerce-section-head"><div><span>POSITIONNEMENT TARIFAIRE</span><h2>Prix des offres</h2></div><p>Échelle maximale · 1 600 DH</p></div>
          <div className="price-bars">{catalogReport.map((offer) => <div key={`${offer.category}-${offer.name}`}><span><b>{offer.name}</b><small>{offer.category}</small></span><i><em style={{ "--bar": `${offer.price / 16}%` } as React.CSSProperties} /></i><strong>{offer.price.toLocaleString("fr-FR")} DH</strong></div>)}</div>
        </article>
        <aside className="report-insight-panel"><span>LECTURE COMMERCIALE</span><h2>Une gamme pour chaque profil.</h2><p>Les packs couvrent la découverte et la pratique régulière. Les abonnements structurent la fidélité mensuelle. Les offres Famille et Amis développent les sorties collectives.</p><div><b>16,7 %</b><span>Économie annoncée sur Bronze</span></div><div><b>9 sessions</b><span>Total inclus dans Gold</span></div><div><b>80 DH</b><span>Coût moyen par personne avec Pack Amis à 5</span></div></aside>
      </section>

      <section className="commerce-section catalog-section">
        <div className="commerce-section-head"><div><span>MATRICE DES OFFRES</span><h2>Détail du catalogue</h2></div><p>Données reprises du rapport Mega Kart.</p></div>
        <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>CATÉGORIE</th><th>OFFRE</th><th>PRIX</th><th>VOLUME</th><th>AVANTAGE PRINCIPAL</th></tr></thead><tbody>{catalogReport.map((offer) => <tr key={`${offer.category}-${offer.name}`}><td>{offer.category}</td><td><strong>{offer.name}</strong></td><td>{offer.price.toLocaleString("fr-FR")} DH</td><td>{offer.volume}</td><td>{offer.advantage}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

function PageTransitionLoader({ visible }: { visible: boolean }) {
  return (
    <div className={"page-transition-loader " + (visible ? "visible" : "")} role="status" aria-live="polite" aria-hidden={!visible}>
      <div className="transition-loader-content">
        <div className="transition-brand-lockup">
          <div className="transition-logo" role="img" aria-label="MegaKart" />
          <div className="wheel-loader" aria-hidden="true"><div className="wheel-loader-image" /></div>
        </div>
        <div className="transition-progress"><i /></div>
        <strong>CHANGEMENT DE CIRCUIT</strong>
        <span>Synchronisation du centre opérationnel</span>
      </div>
    </div>
  );
}

type HashView = { kind: "dashboard" } | { kind: "ecran" } | { kind: "souvenir"; token: string } | { kind: "reserver" };

const readHashView = (): HashView => {
  const hash = window.location.hash;
  if (hash === "#ecran") return { kind: "ecran" };
  // The visitor booking page, opened from a QR code at the entrance. Like #souvenir it must
  // never mount the dashboard, whose hooks reach the timing bridge on localhost.
  if (hash === "#reserver") return { kind: "reserver" };
  if (hash.startsWith(SOUVENIR_HASH_PREFIX)) return { kind: "souvenir", token: hash.slice(SOUVENIR_HASH_PREFIX.length) };
  return { kind: "dashboard" };
};

const MIN_PAGE_TRANSITION_MS = 3000;
const preparePageData = (label: string) => Promise.resolve(label);

export default function Home() {
  const [active, setActive] = useState("Vue générale");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  // null until the URL fragment has been read on the client. Server HTML and the first client render
  // are an empty shell, so hydration always matches and a player's phone opening #souvenir=… never
  // mounts the dashboard (whose hooks would try to reach the timing bridge on localhost).
  const [hashView, setHashView] = useState<HashView | null>(null);
  const navigationTimers = useRef<number[]>([]);
  const navigationRun = useRef(0);

  useEffect(() => () => {
    navigationRun.current += 1;
    navigationTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  // Full-screen views live behind the URL fragment so they work on the static host:
  // /#ecran is the venue TV, /#souvenir=… is the player's race souvenir opened from a QR code.
  // Layout effect: resolved before the first paint, so the empty shell is never visible on the client.
  useLayoutEffect(() => {
    const sync = () => setHashView(readHashView());
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Only the dashboard, where sessions are managed, drives the bridge's active session. The venue
  // screen may run in another browser with no sessions of its own and must not clear it.
  const bridgeSync = useBridgeSessionSync(hashView?.kind === "dashboard");

  const navigateToPage = (label: string) => {
    if (label === active) return;
    const run = ++navigationRun.current;
    const startedAt = window.performance.now();
    navigationTimers.current.forEach((timer) => window.clearTimeout(timer));
    setPageLoading(true);
    navigationTimers.current = [window.setTimeout(() => { setActive(label); setSearch(""); }, 360)];
    void preparePageData(label).finally(() => {
      const remaining = Math.max(0, MIN_PAGE_TRANSITION_MS - (window.performance.now() - startedAt));
      const hideTimer = window.setTimeout(() => {
        if (navigationRun.current === run) setPageLoading(false);
      }, remaining);
      navigationTimers.current.push(hideTimer);
    });
  };

  if (hashView === null) return <div className="app-boot" aria-hidden="true" />;
  if (hashView.kind === "souvenir") return <SouvenirPage token={hashView.token} />;
  if (hashView.kind === "reserver") return <ReservationPage />;
  if (hashView.kind === "ecran") {
    return (
      <BigScreen
        onExit={() => {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
          setHashView({ kind: "dashboard" });
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onSelect={navigateToPage} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
      <div className="workspace">
        <Topbar openMenu={() => setMobileOpen(true)} search={search} setSearch={setSearch} />
        <main className="dashboard-content">
          {active === "Course en direct" ? <LiveRaceView /> : active === "Liste d\u2019attente" ? <FileAttenteView search={search} /> : active === "Sessions" ? <SessionsView bridgeSync={bridgeSync} /> : active === "Statistiques" ? <StatsView /> : active === "Réservations" ? <ReservationsView search={search} /> : active === "Clients" ? <ClientsView search={search} /> : active === "Pass & fidélité" ? <PassLoyaltyView /> : active === "Packs & ventes" ? <PacksSalesView /> : active === "Carburant" ? <FuelView /> : active === "Rapports" ? <ReportsView /> : <Overview search={search} selectedBooking={selectedBooking} setSelectedBooking={setSelectedBooking} />}
        </main>
      </div>
      <PageTransitionLoader visible={pageLoading} />
    </div>
  );
}
