// Abstraction over the Apex/GoKarts WRITE side (SupportDev §9: do not fake write commands).
// The live READ side is proven (30001 feed → bridge). The local Python controller
// now owns fresh CREATE through a durable request ledger and a qualified Apex
// reference, independent of the optional reuse pool. Dashboard writes stay
// NOT_CONFIGURED until that fresh-create path passes its approved live test.
// No direct Apex database writes. This browser interface is not yet wired to it.

import type { MegaKartSession } from "./megakart-session";

export type ApexResult =
  | { ok: true; apexSessionId: string }
  | { ok: false; reason: "NOT_CONFIGURED" | string };

export interface ApexSessionController {
  /** Create the session in GoKarts (drivers + kart assignments). */
  createSession(session: MegaKartSession): Promise<ApexResult>;
  /** Green-flag / start the race. */
  startSession(apexSessionId: string): Promise<ApexResult>;
  /** Finish / classify the race. */
  finishSession(apexSessionId: string): Promise<ApexResult>;
}

/** Default: nothing is wired to GoKarts yet. Everything is a no-op that reports NOT_CONFIGURED. */
export class NotConfiguredApexController implements ApexSessionController {
  async createSession(): Promise<ApexResult> {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }
  async startSession(): Promise<ApexResult> {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }
  async finishSession(): Promise<ApexResult> {
    return { ok: false, reason: "NOT_CONFIGURED" };
  }
}

// Single place to choose the active controller. Swap to a real implementation in Phase B.
export const apexController: ApexSessionController = new NotConfiguredApexController();
