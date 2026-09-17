// Dashboard → big screen commands (same PC, same browser). A BroadcastChannel reaches a screen
// window that is already open; a short-lived localStorage copy covers the screen we are
// opening right now, which reads it once it has mounted.
import type { RaceSouvenir } from "@/lib/race-souvenir";

export type ScreenCommand = { type: "show-result"; race: RaceSouvenir; at: number };

const CHANNEL = "megakart-ecran";
const PENDING_KEY = "megakart-ecran-command";
const PENDING_TTL_MS = 15_000;
let screenWindow: Window | null = null;

export function showResultOnBigScreen(race: RaceSouvenir) {
  const command: ScreenCommand = { type: "show-result", race, at: Date.now() };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(command));
  } catch {
    /* storage unavailable: an open screen still gets the broadcast */
  }
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(command);
    channel.close();
  } catch {
    /* BroadcastChannel unsupported */
  }
  if (screenWindow && !screenWindow.closed) screenWindow.focus();
  else screenWindow = window.open("/#ecran", "megakart-ecran");
}

export function listenForScreenCommands(handle: (command: ScreenCommand) => void): () => void {
  const consumePending = () => {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (!raw) return;
      localStorage.removeItem(PENDING_KEY);
      const command = JSON.parse(raw) as ScreenCommand;
      if (command?.type === "show-result" && Date.now() - command.at < PENDING_TTL_MS) handle(command);
    } catch {
      /* ignore malformed or unavailable storage */
    }
  };
  consumePending();
  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<ScreenCommand>) => {
      if (event.data?.type !== "show-result") return;
      try {
        localStorage.removeItem(PENDING_KEY);
      } catch {
        /* ignore */
      }
      handle(event.data);
    };
  } catch {
    /* BroadcastChannel unsupported */
  }
  return () => channel?.close();
}
