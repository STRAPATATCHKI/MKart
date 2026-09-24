// What the sidebar's system card says, from what the services report about themselves.
//
// The desk (which serves this page) and the bridge each report when they started and when
// their code on disk last changed. Code newer than the process means an update is waiting,
// which is exactly the situation that caused "Serveur d'accueil trop ancien": the files were
// new, the running server was not. Pure logic, exercised by tests/system-status.test.mjs.

export type DeskSystem = {
  startedAt: number;
  codeUpdatedAt: number;
  stale: boolean;
  bridgeCodeUpdatedAt: number;
  bundleBuiltAt: number;
  launchers: { desk: boolean; bridge: boolean };
};

/**
 * How the desk answered GET /api/system:
 *   ok      - a desk with the Synchroniser button's endpoints;
 *   wifi    - refused (403): the page was opened through the PC's Wi-Fi address;
 *   old     - answered with the page itself: a desk from before this card existed;
 *   down    - no answer at all;
 *   hosted  - the page is not on the venue PC (the online copy), nothing to synchronise.
 */
export type DeskProbe =
  | { kind: "ok"; system: DeskSystem }
  | { kind: "wifi" }
  | { kind: "old" }
  | { kind: "down" }
  | { kind: "hosted" };

export type BridgeHealth = { ok: boolean; startedAt?: number; codeUpdatedAt?: number; stale?: boolean } | null;

export type SystemSummary = {
  tone: "ok" | "update" | "warn" | "down";
  title: string;
  detail: string;
  canSync: boolean;
  /** What a Synchroniser would bring up to date, in the operator's words. */
  pending: string[];
  rows: { label: string; up: boolean; note?: string }[];
};

/** Private networks and this machine: the only places a venue desk can be reached at. */
export function isVenueHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]"
    || /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
}

export const isLoopbackHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

export function summarize(
  desk: DeskProbe,
  bridge: BridgeHealth,
  chronoOnline: boolean,
  pageBundleAt: number | null,
  deskUrl = "http://127.0.0.1:5190",
): SystemSummary {
  const bridgeUp = !!bridge?.ok;
  const rows = (deskUp: boolean) => [
    { label: "Accueil", up: deskUp },
    { label: "Inscriptions", up: bridgeUp },
    { label: "Chrono", up: chronoOnline },
  ];

  if (desk.kind === "hosted") {
    return { tone: "ok", title: "Dashboard en ligne", detail: "La synchronisation se fait depuis le PC d’accueil.",
             canSync: false, pending: [], rows: rows(false) };
  }
  if (desk.kind === "wifi") {
    return { tone: "warn", title: "Adresse Wi-Fi", detail: `Rien ne peut être enregistré ici : ouvrez ${deskUrl}`,
             canSync: false, pending: [], rows: rows(true) };
  }
  if (desk.kind === "old") {
    return { tone: "update", title: "Accueil à redémarrer",
             detail: "Lancez restart-desk.bat une fois ; ensuite ce bouton s’en chargera.",
             canSync: false, pending: ["accueil"], rows: rows(true) };
  }
  if (desk.kind === "down") {
    return { tone: "down", title: "Accueil injoignable", detail: "Lancez restart-desk.bat sur ce PC.",
             canSync: false, pending: [], rows: rows(false) };
  }

  const sys = desk.system;
  const pending: string[] = [];
  if (sys.stale) pending.push("accueil");
  // A bridge that does not report its start predates this card: it needs the restart too.
  if (bridgeUp && (bridge!.startedAt == null || bridge!.stale)) pending.push("inscriptions");
  if (pageBundleAt != null && sys.bundleBuiltAt > pageBundleAt) pending.push("dashboard");
  const canSync = sys.launchers.desk && sys.launchers.bridge;

  if (!bridgeUp) {
    return { tone: "warn", title: "Inscriptions hors ligne", detail: "Synchroniser relance le pont d’inscription.",
             canSync, pending, rows: rows(true) };
  }
  if (pending.length) {
    return { tone: "update", title: "Mise à jour à appliquer", detail: `À appliquer : ${pending.join(", ")}`,
             canSync, pending, rows: rows(true) };
  }
  return {
    tone: "ok", title: "Systèmes opérationnels",
    detail: `Dernière synchro · ${hhmm(sys.startedAt)}${chronoOnline ? "" : " · chrono hors ligne"}`,
    canSync, pending, rows: rows(true),
  };
}
