// Paid groups sent from Liste d'attente (« Envoyer en session ») to Sessions, where they wait in
// the "Inscriptions clients" list beside the phone sign-ups until someone presses « Ajouter ».
// Kept in this browser, like the race form (lib/session-draft.ts), so they survive changing page.

export type QueuedPilot = { name: string; kart: number | null };
export type QueuedGroup = {
  /** The reservation's desk code (MK-6149): one entry per reservation. */
  code: string;
  /** The code the phone showed the client (W1A1), when there is one. */
  clientCode: string | null;
  contactName: string;
  pilots: QueuedPilot[];
  /** The pack, as the till shows it. */
  pack: string | null;
  sentAt: number;
};

export const QUEUE_KEY = "megakart-session-queue-v1";
export const QUEUE_CHANGED = "mk-session-queue-changed";

export function loadQueue(): QueuedGroup[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(list)) return [];
    return list.filter((g): g is QueuedGroup => !!g && typeof g.code === "string" && Array.isArray(g.pilots));
  } catch {
    return [];
  }
}

function saveQueue(list: QueuedGroup[]): void {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(list)); } catch { /* private window */ }
  try { window.dispatchEvent(new Event(QUEUE_CHANGED)); } catch { /* not a browser */ }
}

/** Newest first; sending the same reservation again refreshes it (karts changed since) instead of doubling it. */
export function withGroup(list: QueuedGroup[], group: QueuedGroup): QueuedGroup[] {
  return [group, ...list.filter((g) => g.code !== group.code)];
}

export function withoutGroup(list: QueuedGroup[], code: string): QueuedGroup[] {
  return list.filter((g) => g.code !== code);
}

/** Sent now: the time is stamped here. */
export const queueGroup = (group: Omit<QueuedGroup, "sentAt">) => saveQueue(withGroup(loadQueue(), { ...group, sentAt: Date.now() }));
export const unqueueGroup = (code: string) => saveQueue(withoutGroup(loadQueue(), code));
