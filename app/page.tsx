"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLiveRace, type LiveDriver } from "@/hooks/use-live-race";
import { useSessions, useActiveRoster } from "@/hooks/use-sessions";
import { useHistory, type HistorySession } from "@/hooks/use-history";
import { useGokartsSessions } from "@/hooks/use-gokarts-sessions";
import { TRACK_WIDTH, TRACK_HEIGHT, LEGACY_TRACK_WIDTH, TRACK_LAYOUT_VERSION, defaultRoutePoints, makeSmoothRoute, notifyTrackChanged, saveSharedTrack, type RoutePoint } from "@/lib/track";
import { SESSION_TYPE_LABELS, STATE_LABELS, rankModeFor, type SessionType, type SessionState } from "@/lib/megakart-session";
import { issueFor, sessionFormIssues } from "@/lib/session-form";
import { CatalogPage } from "@/components/packs/catalog-page";
import { ClientsPage } from "@/components/clients/clients-page";
import { Overview } from "@/components/overview/overview";
import { SystemStatus } from "@/components/system/system-status";
import { TrackRecordCard } from "@/components/stats/track-record-card";
import { OfferCard } from "@/components/packs/offer-card";
import { useCatalog } from "@/hooks/use-catalog";
import { onSale, pricePerPerson, savingLabel, totalUnits, volumeLabel, KIND_LABELS, type Offer } from "@/lib/catalog";
import { apexController } from "@/lib/apex-session-controller";
import { BigScreen } from "@/components/big-screen/big-screen";
import { SouvenirPage } from "@/components/souvenir/souvenir-page";
import { ReservationPage } from "@/components/reservation/reservation-page";
import { DeskOnlyNotice } from "@/components/desk-only-notice";
import { useIsCompact } from "@/hooks/use-compact";
import { ChronoPanel } from "@/components/chrono/chrono-panel";
import { FileAttenteView } from "@/components/caisse/file-attente-view";
import { ResultSheet } from "@/components/results/result-sheet";
import { useBridgeSessionSync, type BridgeSync } from "@/hooks/use-bridge-sync";
import { useSignups } from "@/hooks/use-signups";
import { SignupPanel } from "@/components/signups/signup-panel";
import { GarageView } from "@/components/garage/garage-view";
import { signupPlayers, type Signup } from "@/lib/bridge-client";
import { DriverAvatar } from "@/components/big-screen/driver-avatar";
import { useTiming } from "@/hooks/use-timing";
import { RaceControlPanel } from "@/components/timing/race-control-panel";
import { RaceHistoryPanel } from "@/components/timing/race-history-panel";
import { useRaceHistory } from "@/hooks/use-race-history";
import { explainTimingError, timing, TimingOffline } from "@/lib/timing-client";

type DriverRow = { name: string; kart: string; transponder: string; color?: number };
import { SOUVENIR_HASH_PREFIX } from "@/lib/race-souvenir";
import {
  Activity, Banknote, Bell, CalendarDays, CheckCircle2,
  ChevronRight, Clock3, CreditCard, Crosshair, Flag, LayoutDashboard, Menu, MonitorPlay, MoreHorizontal,
  PackageCheck, Pencil, PlusCircle, QrCode, Radio, RotateCcw, Save, Search,
  Trash2, Trophy, Undo2, UsersRound, WalletCards, Wrench, X, Zap,
} from "lucide-react";

import { useQueue } from "@/hooks/use-queue";
import { badgeLabel, badgeTitle, waitingCount, waitingPilots } from "@/lib/queue-badge";

const navItems = [
  { label: "Vue générale", icon: LayoutDashboard },
  { label: "Course en direct", icon: Flag, live: true },
  { label: "Liste d’attente", icon: CalendarDays, badge: "queue" as const },
  { label: "Sessions", icon: PlusCircle },
  { label: "Statistiques", icon: Trophy },
  { label: "Réservations", icon: CalendarDays },
  { label: "Clients", icon: UsersRound },
  { label: "Pass & fidélité", icon: WalletCards },
  { label: "Packs & ventes", icon: PackageCheck },
  { label: "Garage", icon: Wrench },
  { label: "Rapports", icon: Activity },
];

type NotificationType = "qr" | "race" | "payment" | "delay";
const operationalNotifications: { id: string; type: NotificationType; title: string; detail: string; time: string }[] = [];

type QrReservation = { id: string; time: string; organizer: string; initials: string; friends: string[]; pack: string; amount: string; payment: "Carte bancaire" | "Espèces"; scannedAt: string };
const qrReservations: QrReservation[] = [];


const loyaltyRewards = [
  { card: "Carte 1", reward: "20 % de réduction" },
  { card: "Carte 2", reward: "50 % de réduction" },
  { card: "Carte 3", reward: "Sessions gratuites" },
  { card: "Carte 4", reward: "Boisson gratuite" },
];

// The price matrix on Rapports, built from the live catalog rather than a copy of it.
function catalogReportRows(offers: Offer[]) {
  return offers.map((offer) => ({
    category: KIND_LABELS[offer.kind].title,
    name: offer.name,
    price: offer.price,
    volume: volumeLabel(offer),
    advantage: savingLabel(offer) ?? offer.extras[0] ?? offer.description ?? "",
  }));
}

function LogoMark() {
  return (
    <div className="brand-mark" aria-label="MegaKart">
      <span className="brand-flag"><i /><i /><i /><i /></span>
      <span className="brand-copy"><strong>MEGA</strong><em>KART</em></span>
    </div>
  );
}

/**
 * The waiting badge.
 *
 * It lives in the sidebar rather than in the Liste d'attente page because its whole job is to
 * be seen from the OTHER pages: an operator looking at Sessions has no other way to learn that
 * someone just walked in. That means this poll runs all day, which is why it is slower than the
 * page's own - a badge four seconds stale is still a badge, and the desk server is on this PC.
 */
function QueueBadge() {
  const { reservations } = useQueue(8000);
  const groups = waitingCount(reservations);
  const label = badgeLabel(groups);
  if (!label) return null;
  return <i className="nav-badge" title={badgeTitle(groups, waitingPilots(reservations))}>{label}</i>;
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
                <Icon size={18} /><span>{item.label}</span>
                {item.live && <i className="live-dot" />}
                {item.badge === "queue" && <QueueBadge />}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <SystemStatus />
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
    // Share it with the desk so the other screens draw this circuit too, not just this browser.
    void saveSharedTrack({ points: routePoints, start: startIndex, finish: finishIndex });
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
  // MegaKart Timing Control (the ActiveBox chrono): kart map for the form, race state for the panel.
  const timingView = useTiming();
  // The races the chrono has already saved. Watching the current race tells it when to look
  // again, so the race that was just finished is in the list without reloading the page.
  const raceHistory = useRaceHistory(timingView.race?.raceId ?? null, timingView.race?.state ?? null);
  const [result, setResult] = useState<HistorySession | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<SessionType>("practice");
  const [durationMin, setDurationMin] = useState(8);
  const emptyRows = (): DriverRow[] => [
    { name: "", kart: "", transponder: "" },
    { name: "", kart: "", transponder: "" },
  ];
  const [rows, setRows] = useState(emptyRows());
  // Starting grid: row order IS the grid (P1 first). Unless the operator ticks "ordre manuel",
  // the grid is drawn at random when the session is created - same rule as Timing Control.
  const [gridManual, setGridManual] = useState(false);
  const shuffleGrid = () => setRows((current) => {
    const filled = current.filter((r) => r.name.trim());
    const empty = current.filter((r) => !r.name.trim());
    for (let i = filled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filled[i], filled[j]] = [filled[j], filled[i]];
    }
    return [...filled, ...empty];
  });
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

  // Everything the form still needs before it can be sent. The button only exists when this
  // is empty, and each field wears its own reason in red until it is fixed.
  const issues = sessionFormIssues({ name, durationMin, rows });
  const [touched, setTouched] = useState(false);
  const shown = touched ? issues : [];
  const bad = (msg: string | null): React.CSSProperties => (msg ? { ...inp, borderColor: "#ff6b69", boxShadow: "0 0 0 2px rgba(255,107,105,.18)" } : inp);
  const note = (msg: string | null) => (msg
    ? <small style={{ display: "block", marginTop: 4, fontSize: 11, color: "#ff9795" }}>{msg}</small>
    : null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (issues.length) { setTouched(true); return; }   // Enter too early: now show what is missing
    let ordered = rows.filter((r) => r.name.trim());
    if (!gridManual) {
      // Random grid, drawn now so the form, the MegaKart session and the chrono all agree.
      ordered = [...ordered];
      for (let i = ordered.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
      }
      setRows([...ordered, ...rows.filter((r) => !r.name.trim())]);
    }
    const drivers = ordered
      .map((r) => ({ name: r.name.trim(), kartNumber: Number(r.kart) || 0, transponder: r.transponder.trim() || undefined, color: r.color }));
    // A kart carries one transponder, so the same kart twice means the same transponder twice:
    // the chrono would keep only one of the two drivers. Catch it here, with the names.
    const duplicates = (key: (d: typeof drivers[number]) => string | number, label: string) => {
      const seen = new Map<string | number, string>();
      for (const d of drivers) {
        const value = key(d);
        if (!value) continue;
        const first = seen.get(value);
        if (first) return `${label} ${value} est attribué deux fois : ${first} et ${d.name}.`;
        seen.set(value, d.name);
      }
      return null;
    };
    const clash = duplicates((d) => d.kartNumber, "Le kart")
      ?? duplicates((d) => (d.transponder ?? timingView.karts.find((k) => k.kart === d.kartNumber)?.transponder ?? ""), "Le transpondeur");
    if (clash) {
      setNotice({ tone: "warn", text: clash });
      return;
    }
    if (!name.trim() || drivers.length === 0) {
      setNotice({ tone: "warn", text: "Un nom de session et au moins un pilote sont requis." });
      return;
    }
    create({ name, type, durationSec: durationMin * 60, drivers });
    // Hand the same drivers to the chrono. Timing Control resolves each kart's transponder from
    // its own permanent map, so a wrong or missing kart number is refused there, by name.
    const forChrono = drivers.filter((d) => d.kartNumber > 0).map((d, i) => ({ name: d.name, kart: d.kartNumber, grid: i + 1 }));
    void (async () => {
      try {
        const res = await timing.prepare(name.trim(), durationMin * 60_000, forChrono);
        if (res.success) setNotice({ tone: "ok", text: `Session « ${name.trim()} » créée et envoyée au chrono (${res.raceId}). Appuyez sur DÉPART quand les karts sont en grille.` });
        else setNotice({ tone: "warn", text: `Session créée côté MegaKart, mais le chrono a refusé : ${explainTimingError(res.error, res.message)}` });
      } catch (e) {
        setNotice({ tone: "warn", text: e instanceof TimingOffline
          ? `Session « ${name.trim()} » créée côté MegaKart. Le chrono (Timing Control) est hors ligne : lancez-le puis « Envoyer au chrono ».`
          : `Session créée, chrono injoignable : ${String(e)}` });
      }
      timingView.refresh();
    })();
    setName("");
    setDurationMin(8);
    setType("practice");
    setRows(emptyRows());
    setTouched(false);
    // The next thing to do is on the race deck: take the operator there instead of leaving them
    // looking at a blank form that has just done its job.
    window.setTimeout(() => document.getElementById("race-control")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
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
            <label><span style={lab}>Nom de la session</span><input style={bad(issueFor(shown, "name"))} value={name} onChange={(e) => { setTouched(true); setName(e.target.value); }} placeholder="Course #28" />{note(issueFor(shown, "name"))}</label>
            <label><span style={lab}>Type</span>
              <select style={inp} value={type} onChange={(e) => setType(e.target.value as SessionType)}>
                {SESSION_TYPE_LABELS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label><span style={lab}>Durée (min)</span><input style={bad(issueFor(shown, "duration"))} type="number" min={1} max={240} value={durationMin} onChange={(e) => { setTouched(true); setDurationMin(Number(e.target.value) || 0); }} />{note(issueFor(shown, "duration"))}</label>
          </div>

          <div>
            <span style={lab}>Pilotes &amp; karts</span>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "grid", gridTemplateColumns: "40px 30px 2fr 1fr 1fr 36px", gap: 10, fontSize: 11, color: "#8aa0b6", textTransform: "uppercase", letterSpacing: ".04em" }}>
                <span>Grille</span><span /><span>Pilote</span><span>Kart n°</span><span>Transpondeur</span><span />
              </div>
              {rows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "40px 30px 2fr 1fr 1fr 36px", gap: 10, alignItems: "start" }}>
                  <strong style={{ color: r.name.trim() ? "#d8ff35" : "#3a4450", fontFamily: "monospace" }}>{`P${rows.filter((x, k) => k <= i && x.name.trim()).length || i + 1}`}</strong>
                  <span title={r.color ? `Pilote choisi à l’inscription` : undefined} style={{ display: "grid", placeItems: "center" }}>
                    {r.color ? <DriverAvatar pilot={r.color} seed={r.name} size="28px" /> : null}
                  </span>
                  <div>
                    <input style={bad(issueFor(shown, "row", i, "name"))} value={r.name} onChange={(e) => { setTouched(true); setRow(i, "name", e.target.value); }} placeholder={`Pilote ${i + 1}`} />
                    {note(issueFor(shown, "row", i, "name"))}
                  </div>
                  <div>
                    <input style={bad(issueFor(shown, "row", i, "kart"))} title={issueFor(shown, "row", i, "kart") ?? undefined}
                      value={r.kart} onChange={(e) => { setTouched(true); setRow(i, "kart", e.target.value); }} placeholder="6" inputMode="numeric" list="timing-karts" />
                    {note(issueFor(shown, "row", i, "kart"))}
                  </div>
                  <input style={inp} value={r.transponder || (timingView.karts.find((k) => String(k.kart) === r.kart.trim())?.transponder ?? "")}
                    onChange={(e) => setRow(i, "transponder", e.target.value)} placeholder="auto (Timing Control)" />
                  <button type="button" aria-label="Retirer le pilote" onClick={() => setRows((rr) => rr.filter((_, idx) => idx !== i))} style={{ ...inp, width: 36, height: 38, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}><X size={15} /></button>
                </div>
              ))}
            </div>
            {/* Kart numbers known to the chrono, with their transponders: typing is still allowed. */}
            <datalist id="timing-karts">
              {timingView.karts.filter((k) => k.enabled).map((k) => <option key={k.kart} value={String(k.kart)}>{`Kart ${k.kart} · ${k.transponder}`}</option>)}
            </datalist>
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
              <button type="button" className="secondary-button" onClick={() => setRows((r) => [...r, { name: "", kart: "", transponder: "" }])}><PlusCircle size={15} /> Ajouter un pilote</button>
              <button type="button" className="secondary-button" onClick={() => { shuffleGrid(); setGridManual(true); }} title="Tire la grille au sort : l’ordre des lignes devient P1, P2, P3…"><Flag size={15} /> Grille aléatoire</button>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#8aa0b6" }}>
                <input type="checkbox" checked={gridManual} onChange={(e) => setGridManual(e.target.checked)} />
                ordre manuel — garder l’ordre des lignes comme grille
              </label>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 40 }}>
            {shown.length === 0 ? (
              <>
                <button type="submit" className="primary-button"><Flag size={16} /> Créer la session</button>
                <small style={{ color: "#8aa0b6" }}>La session est créée côté MegaKart (« En attente Apex ») — GoKarts n’est pas modifié.</small>
              </>
            ) : (
              <small style={{ color: "#ff9795" }}>
                {issueFor(shown, "rows") ?? `${shown.length} chose${shown.length > 1 ? "s" : ""} à compléter avant de créer la session.`}
              </small>
            )}
          </div>
        </form>
      </section>

      <RaceControlPanel
        view={timingView}
        draft={{ name, durationMin, rankMode: rankModeFor(type), drivers: rows.filter((r) => r.name.trim()).map((r, i) => ({ name: r.name, kart: Number(r.kart) || 0, color: r.color, grid: i + 1 })) }}
        onNotice={(tone, text) => setNotice({ tone, text })}
      />

      {/* Directly under the deck: « Session suivante » is pressed above, the race that just left
          the deck is found here. */}
      <RaceHistoryPanel history={raceHistory} />

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

      <TrackRecordCard />

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
  return <ClientsPage search={search} />;
}

function PassLoyaltyView() {
  // Subscriptions come from the catalog: anything sold by the week or the month, whatever its
  // type, so a pass created in Packs & ventes appears here without being entered twice.
  const { catalog } = useCatalog();
  const monthly = onSale(catalog, (o) => o.period !== "unique");
  const entry = monthly.length ? monthly.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  return (
    <div className="commerce-page">
      <header className="commerce-hero">
        <div className="commerce-hero-copy"><span className="eyebrow"><i /> PASS & FIDÉLITÉ</span><h1>Roulez plus.<br /><em>Revenez plus.</em></h1><p>Abonnements mensuels et récompenses de session issus de l’offre officielle Mega Kart.</p></div>
        <div className="commerce-hero-metrics"><span><small>FORMULES</small><strong>{String(monthly.length).padStart(2, "0")}</strong><b>Abonnements</b></span><span><small>ENTRÉE</small><strong>{entry ? `${entry.price.toLocaleString("fr-FR")} DH` : "—"}</strong><b>{entry ? `${entry.name} · par ${entry.period === "semaine" ? "semaine" : "mois"}` : "aucune formule"}</b></span><span><small>FIDÉLITÉ</small><strong>04</strong><b>Récompenses possibles</b></span></div>
      </header>

      <section className="commerce-section">
        <div className="commerce-section-head"><div><span>ABONNEMENTS</span><h2>Choisir une formule</h2></div><p>Inscription anticipée incluse dans chaque pass.</p></div>
        <div className="cat-grid">
          {monthly.map((offer) => <OfferCard key={offer.id} offer={offer} />)}
          {monthly.length === 0 && <p className="cat-empty">Aucun abonnement en vente — ajoutez-en un dans Packs &amp; ventes.</p>}
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
  return <CatalogPage />;
}

function ReportsView() {
  const { catalog } = useCatalog();
  const offers = onSale(catalog);
  const rows = catalogReportRows(offers);
  const maxPrice = Math.max(1, ...offers.map((o) => o.price));
  const cheapest = offers.length ? offers.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const dearest = offers.length ? offers.reduce((a, b) => (b.price > a.price ? b : a)) : null;
  const count = (f: (o: Offer) => boolean) => offers.filter(f).length;
  const packs = offers.filter((o) => o.period === "unique" && o.basis === "personne" && o.kind !== "session");
  const monthly = offers.filter((o) => o.period !== "unique");
  const groups = offers.filter((o) => o.basis === "groupe");
  const range = (list: Offer[]) => {
    if (!list.length) return "—";
    const n = list.map(totalUnits);
    const lo = Math.min(...n), hi = Math.max(...n);
    return lo === hi ? `${lo}` : `${lo} à ${hi}`;
  };
  const bestSaving = offers
    .filter((o) => o.originalPrice != null && o.originalPrice > o.price)
    .map((o) => ({ o, pct: ((o.originalPrice! - o.price) / o.originalPrice!) * 100 }))
    .sort((a, b) => b.pct - a.pct)[0] ?? null;
  const biggest = packs.length ? packs.reduce((a, b) => (totalUnits(b) > totalUnits(a) ? b : a)) : null;
  const cheapestGroup = groups.length ? groups.reduce((a, b) => (pricePerPerson(b) < pricePerPerson(a) ? b : a)) : null;
  return (
    <div className="commerce-page reports-page">
      <header className="commerce-hero reports-hero">
        <div className="commerce-hero-copy"><span className="eyebrow"><i /> RAPPORT COMMERCIAL</span><h1>Catalogue<br /><em>Mega Kart.</em></h1><p>Synthèse fidèle des offres, tarifs, volumes et avantages documentés.</p></div>
        <div className="commerce-hero-metrics"><span><small>OFFRES</small><strong>{String(offers.length).padStart(2, "0")}</strong><b>En vente</b></span><span><small>PRIX MIN.</small><strong>{cheapest ? `${cheapest.price.toLocaleString("fr-FR")} DH` : "—"}</strong><b>{cheapest?.name ?? "—"}</b></span><span><small>PRIX MAX.</small><strong>{dearest ? `${dearest.price.toLocaleString("fr-FR")} DH` : "—"}</strong><b>{dearest ? `${dearest.name}${dearest.period === "mois" ? " · mois" : ""}` : "—"}</b></span></div>
      </header>

      <section className="report-summary-grid">
        <article><PackageCheck size={19} /><span><small>PACKS INDIVIDUELS</small><strong>{packs.length}</strong><b>{range(packs)} {packs[0] ? packs[0].unit : "sessions"}</b></span></article>
        <article><WalletCards size={19} /><span><small>ABONNEMENTS</small><strong>{monthly.length}</strong><b>{range(monthly)} par période</b></span></article>
        <article><UsersRound size={19} /><span><small>OFFRES GROUPE</small><strong>{groups.length}</strong><b>{count((o) => o.kind === "famille")} famille · {count((o) => o.kind === "amis")} amis</b></span></article>
        <article><Trophy size={19} /><span><small>RÉCOMPENSES</small><strong>{loyaltyRewards.length}</strong><b>À chaque session</b></span></article>
      </section>

      <section className="report-workspace">
        <article className="report-price-panel">
          <div className="commerce-section-head"><div><span>POSITIONNEMENT TARIFAIRE</span><h2>Prix des offres</h2></div><p>Échelle maximale · {maxPrice.toLocaleString("fr-FR")} DH</p></div>
          <div className="price-bars">{rows.map((offer) => <div key={`${offer.category}-${offer.name}`}><span><b>{offer.name}</b><small>{offer.category}</small></span><i><em style={{ "--bar": `${(offer.price / maxPrice) * 100}%` } as React.CSSProperties} /></i><strong>{offer.price.toLocaleString("fr-FR")} DH</strong></div>)}</div>
        </article>
        <aside className="report-insight-panel"><span>LECTURE COMMERCIALE</span><h2>Une gamme pour chaque profil.</h2><p>Les packs couvrent la découverte et la pratique régulière. Les abonnements structurent la fidélité mensuelle. Les offres Famille et Amis développent les sorties collectives.</p>{bestSaving && <div><b>{bestSaving.pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %</b><span>Meilleure économie · {bestSaving.o.name}</span></div>}{biggest && <div><b>{totalUnits(biggest)} {biggest.unit}</b><span>Total inclus dans {biggest.name}</span></div>}{cheapestGroup && <div><b>{pricePerPerson(cheapestGroup).toLocaleString("fr-FR")} DH</b><span>Par personne avec {cheapestGroup.name}{cheapestGroup.people ? ` à ${cheapestGroup.people}` : ""}</span></div>}</aside>
      </section>

      <section className="commerce-section catalog-section">
        <div className="commerce-section-head"><div><span>MATRICE DES OFFRES</span><h2>Détail du catalogue</h2></div><p>Catalogue en vente, modifiable dans Packs &amp; ventes.</p></div>
        <div className="catalog-table-wrap"><table className="catalog-table"><thead><tr><th>CATÉGORIE</th><th>OFFRE</th><th>PRIX</th><th>VOLUME</th><th>AVANTAGE PRINCIPAL</th></tr></thead><tbody>{rows.map((offer) => <tr key={`${offer.category}-${offer.name}`}><td>{offer.category}</td><td><strong>{offer.name}</strong></td><td>{offer.price.toLocaleString("fr-FR")} DH</td><td>{offer.volume}</td><td>{offer.advantage}</td></tr>)}</tbody></table></div>
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

// Every dashboard page has its own address (/#/sessions, /#/carburant …), so a refresh, a
// bookmark or the back button lands on the page you were on instead of the overview.
const HOME_PAGE = "Vue générale";
const PAGE_SLUGS: Array<[string, string]> = [
  [HOME_PAGE, "accueil"],
  ["Course en direct", "course"],
  ["Liste d’attente", "attente"],
  ["Sessions", "sessions"],
  ["Statistiques", "statistiques"],
  ["Réservations", "reservations"],
  ["Clients", "clients"],
  ["Pass & fidélité", "pass"],
  ["Packs & ventes", "packs"],
  ["Garage", "garage"],
  // The page's old name: a bookmark to #/carburant still opens it.
  ["Garage", "carburant"],
  ["Rapports", "rapports"],
];
const slugForPage = (label: string) => PAGE_SLUGS.find(([page]) => page === label)?.[1] ?? "accueil";
const pageForSlug = (slug: string) => PAGE_SLUGS.find(([, s]) => s === slug)?.[0] ?? HOME_PAGE;

type HashView = { kind: "dashboard"; page: string } | { kind: "ecran" } | { kind: "souvenir"; token: string } | { kind: "reserver" };

const readHashView = (): HashView => {
  const hash = window.location.hash;
  if (hash === "#ecran") return { kind: "ecran" };
  // The visitor booking page, opened from a QR code at the entrance. Like #souvenir it must
  // never mount the dashboard, whose hooks reach the timing bridge on localhost.
  if (hash === "#reserver") return { kind: "reserver" };
  if (hash.startsWith(SOUVENIR_HASH_PREFIX)) return { kind: "souvenir", token: hash.slice(SOUVENIR_HASH_PREFIX.length) };
  if (hash.startsWith("#/")) return { kind: "dashboard", page: pageForSlug(hash.slice(2)) };
  return { kind: "dashboard", page: HOME_PAGE };
};

const PAGE_TITLES: Record<string, string> = {
  ecran: "Écran géant · MegaKart",
  souvenir: "Souvenir de course · MegaKart",
  reserver: "Réservation · MegaKart",
};
const titleForView = (view: HashView) =>
  view.kind === "dashboard"
    ? view.page === HOME_PAGE
      ? "MegaKart Operations Dashboard"
      : `${view.page} · MegaKart`
    : PAGE_TITLES[view.kind];

const MIN_PAGE_TRANSITION_MS = 1000;
const preparePageData = (label: string) => Promise.resolve(label);

export default function Home() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pageLoading, setPageLoading] = useState(false);
  // null until the URL fragment has been read on the client. Server HTML and the first client render
  // are an empty shell, so hydration always matches and a player's phone opening #souvenir=… never
  // mounts the dashboard (whose hooks would try to reach the timing bridge on localhost).
  const [hashView, setHashView] = useState<HashView | null>(null);
  const isCompact = useIsCompact();
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

  // The open page comes from the URL, not from state: refreshing or sharing the address reopens
  // the same page, and the browser's back button walks through the pages you visited.
  const active = hashView?.kind === "dashboard" ? hashView.page : HOME_PAGE;

  useEffect(() => {
    if (hashView) document.title = titleForView(hashView);
  }, [hashView]);

  const navigateToPage = (label: string) => {
    if (label === active) return;
    const run = ++navigationRun.current;
    const startedAt = window.performance.now();
    navigationTimers.current.forEach((timer) => window.clearTimeout(timer));
    setPageLoading(true);
    navigationTimers.current = [window.setTimeout(() => {
      window.location.hash = `#/${slugForPage(label)}`;
      setSearch("");
    }, 360)];
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
          setHashView({ kind: "dashboard", page: HOME_PAGE });
        }}
      />
    );
  }

  // The dashboard itself is desktop-only; the client pages above already returned.
  if (isCompact) return <DeskOnlyNotice />;

  return (
    <div className="app-shell">
      <Sidebar active={active} onSelect={navigateToPage} mobileOpen={mobileOpen} closeMobile={() => setMobileOpen(false)} />
      <div className="workspace">
        <Topbar openMenu={() => setMobileOpen(true)} search={search} setSearch={setSearch} />
        <main className="dashboard-content">
          {active === "Course en direct" ? <LiveRaceView /> : active === "Liste d\u2019attente" ? <FileAttenteView search={search} /> : active === "Sessions" ? <SessionsView bridgeSync={bridgeSync} /> : active === "Statistiques" ? <StatsView /> : active === "Réservations" ? <ReservationsView search={search} /> : active === "Clients" ? <ClientsView search={search} /> : active === "Pass & fidélité" ? <PassLoyaltyView /> : active === "Packs & ventes" ? <PacksSalesView /> : active === "Garage" ? <GarageView /> : active === "Rapports" ? <ReportsView /> : <Overview search={search} onOpenQueue={() => navigateToPage("Liste d’attente")} />}
        </main>
      </div>
      <PageTransitionLoader visible={pageLoading} />
    </div>
  );
}
