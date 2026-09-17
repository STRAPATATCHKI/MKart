// Abstraction over the Apex/GoKarts WRITE side (SupportDev §9: do not fake write commands).
// The live READ side is proven (30001 feed → bridge). The write side (create/start/finish a
// session in GoKarts) requires the authenticated Sessions API (9122) or a confirmed JSON
// import schema — neither is available yet. So the default controller returns NOT_CONFIGURED
// and the UI treats the session as MegaKart-only (WAITING_APEX). When the write path is
// verified, implement a real controller and swap it in — no UI changes needed.

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
