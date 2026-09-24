// Dashboard → big screen commands (same PC, same browser). A BroadcastChannel reaches a screen
// window that is already open; a short-lived localStorage copy covers the screen we are
// opening right now, which reads it once it has mounted.
import type { RaceSouvenir } from "@/lib/race-souvenir";

export type ScreenCommand =
  | { type: "show-result"; race: RaceSouvenir; at: number }
  // The dashboard's DÉPART: the TV runs the start lights and releases the chrono on green.
  | { type: "start-lights"; at: number; nonce: string }
  // The screen's answer, so the dashboard knows a TV took the start rather than nobody.
  | { type: "start-lights-ack"; nonce: string };

const CHANNEL = "megakart-ecran";
const PENDING_KEY = "megakart-ecran-command";
const PENDING_TTL_MS = 15_000;
let screenWindow: Window | null = null;

function broadcast(command: ScreenCommand) {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(command);
    channel.close();
  } catch {
    /* BroadcastChannel unsupported */
  }
}

export function showResultOnBigScreen(race: RaceSouvenir) {
  const command: ScreenCommand = { type: "show-result", race, at: Date.now() };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(command));
  } catch {
    /* storage unavailable: an open screen still gets the broadcast */
  }
  broadcast(command);
  if (screenWindow && !screenWindow.closed) screenWindow.focus();
  else screenWindow = window.open("/#ecran", "megakart-ecran");
}

/**
 * Ask an open TV to run the start lights and release the chrono on green.
 *
 * Resolves true when a screen acknowledged within the window - the start is then the TV's,
 * and the pilots see red → green on the wall. Resolves false when no screen answered, so the
 * caller can arm the chrono itself: a race must never fail to start because a TV is off.
 */
export function requestStartLights(waitMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    let channel: BroadcastChannel | null = null;
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const done = (taken: boolean) => {
      window.clearTimeout(timer);
      channel?.close();
      resolve(taken);
    };
    const timer = window.setTimeout(() => done(false), waitMs);
    try {
      channel = new BroadcastChannel(CHANNEL);
      channel.onmessage = (event: MessageEvent<ScreenCommand>) => {
        if (event.data?.type === "start-lights-ack" && event.data.nonce === nonce) done(true);
      };
      channel.postMessage({ type: "start-lights", at: Date.now(), nonce } satisfies ScreenCommand);
    } catch {
      done(false);
    }
  });
}

export type ScreenCommandHandlers = {
  onShowResult: (command: Extract<ScreenCommand, { type: "show-result" }>) => void;
  /** Return true to take the start; the channel then acknowledges it to the dashboard. */
  onStartLights?: () => boolean;
};

export function listenForScreenCommands(handlers: ScreenCommandHandlers): () => void {
  const consumePending = () => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      localStorage.removeItem(PENDING_KEY);
      const command = JSON.parse(raw) as ScreenCommand;
      if (command?.type === "show-result" && Date.now() - command.at < PENDING_TTL_MS) handlers.onShowResult(command);
    } catch {
      /* ignore malformed or unavailable storage */
    }
  };
  consumePending();
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<ScreenCommand>) => {
      const command = event.data;
      if (command?.type === "show-result") {
        try {
          localStorage.removeItem(PENDING_KEY);
        } catch {
          /* ignore */
        }
        handlers.onShowResult(command);
        return;
      }
      if (command?.type === "start-lights" && handlers.onStartLights) {
        // Answer BEFORE running the lights: the dashboard is waiting on the ack, not on green.
        if (handlers.onStartLights()) {
          channel?.postMessage({ type: "start-lights-ack", nonce: command.nonce } satisfies ScreenCommand);
        }
      }
    };
  } catch {
    /* BroadcastChannel unsupported */
  }
  return () => channel?.close();
}
