// Copy to clipboard, including where the modern API is unavailable.
//
// navigator.clipboard requires a SECURE CONTEXT. That covers localhost, but NOT
// http://192.168.x.x — and the caisse may well open the dashboard on the venue LAN address.
// So we fall back to the old selection trick rather than failing silently on the one machine
// that matters.

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    // Keep it off-screen but still selectable; display:none would make the copy a no-op.
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Pilot rows ready to be entered into GoKarts, ordered by kart number. */
export type GokartsPilot = { fullName: string; kartNumber: number | null };

export function sortForGokarts(pilots: GokartsPilot[]): GokartsPilot[] {
  return [...pilots]
    .filter((p) => p.fullName)
    .sort((a, b) => {
      if (a.kartNumber == null) return 1;
      if (b.kartNumber == null) return -1;
      return a.kartNumber - b.kartNumber;
    });
}

/** Just the names, one per line — what you paste into the Pilote column. */
export function namesOnly(pilots: GokartsPilot[]): string {
  return sortForGokarts(pilots).map((p) => p.fullName).join("\n");
}

/** Name<TAB>kart — pastes across two columns in a grid that accepts tab-separated input. */
export function namesWithKarts(pilots: GokartsPilot[]): string {
  return sortForGokarts(pilots)
    .map((p) => `${p.fullName}\t${p.kartNumber ?? ""}`)
    .join("\n");
}

/** Human-readable, for a note or a printed sheet. */
export function readableList(pilots: GokartsPilot[]): string {
  return sortForGokarts(pilots)
    .map((p) => `Kart ${String(p.kartNumber ?? "—").padStart(2, " ")}  →  ${p.fullName}`)
    .join("\n");
}
