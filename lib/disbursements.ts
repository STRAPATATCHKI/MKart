// Décaissements for the dashboard: the types, and the shared rules (lib/disbursement-rules.mjs)
// with theirs.

import * as rules from "./disbursement-rules.mjs";

export type DisbursementStatus = "EN_ATTENTE" | "APPROUVE" | "REFUSE" | "ANNULE" | "DECAISSE";
export type HistoryEvent = { at: string; event: "cree" | "piece" | "approuve" | "refuse" | "annule" | "decaisse"; by: string | null; via: string | null; note: string | null };
/** A photo joined to a request; the image itself is at /api/disbursements/<id>/pieces/<photo id>. */
export type Attachment = { id: string; type: string; size: number; addedAt: string };

export type Disbursement = {
  id: string;
  code: string;
  amount: number;
  category: string;
  description: string;
  beneficiary: string;
  method: string;
  reference: string | null;
  urgent: boolean;
  requestedBy: string;
  status: DisbursementStatus;
  createdAt: string;
  attachments?: Attachment[];
  decision: { decision: "approve" | "refuse"; by: string; at: string; comment: string | null; via: string } | null;
  paidOutAt: string | null;
  paidOutBy: string | null;
  history: HistoryEvent[];
  updatedAt: string;
};

export type NewDisbursement = {
  amount: string | number;
  category: string;
  description: string;
  beneficiary: string;
  method: string;
  reference?: string;
  urgent?: boolean;
  requestedBy: string;
  /** Photos as data: URLs (already shrunk). */
  attachments?: string[];
};

export const MAX_ATTACHMENTS: number = rules.MAX_ATTACHMENTS;
export const photoUrl = (d: Disbursement, a: Attachment) => `/api/disbursements/${encodeURIComponent(d.id)}/pieces/${encodeURIComponent(a.id)}`;

export const CATEGORIES: { id: string; label: string }[] = rules.CATEGORIES;
export const METHODS: { id: string; label: string }[] = rules.METHODS;
export const STATUS_FR: Record<DisbursementStatus, string> = rules.STATUS_FR;
export const EVENT_FR: Record<HistoryEvent["event"], string> = rules.EVENT_FR;

/** The form, checked exactly as the desk will check it: the message to show, or null. */
export const formError = (input: NewDisbursement): string | null => rules.checkNew(input).error ?? null;

export const totals = (list: Disbursement[]): { pending: number; pendingDh: number; approvedDh: number; paidOutDh: number } => rules.totals(list);
