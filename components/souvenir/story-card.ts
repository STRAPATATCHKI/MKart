// The souvenir as an Instagram story: a 1080 × 1920 image the phone's share sheet can hand to
// Instagram (or WhatsApp, or the camera roll).
//
// A story has to be an IMAGE. Sharing text and a link puts nothing in a story; sharing a file
// puts Instagram in the share sheet with "Story" one tap away. So this draws the result with
// the venue's branding, big enough to read from a phone in the hand. No QR on it: a story is
// a boast, not a form, and a code on it reads as advertising. The other pilots are listed
// under the headline so it is visibly a race that was raced, not a solo lap - and whoever is
// sharing stays the headline, whether they came first or fifth.
//
// Drawn with the canvas API and nothing else: the page is hosted statically and the image is
// built on the customer's own phone, so there is nothing to render server-side.

import type { RaceSouvenir } from "@/lib/race-souvenir";

export const STORY_W = 1080;
export const STORY_H = 1920;

const LIME = "#d8ff35";
const INK = "#050604";
const TEXT = "#f4f6ed";
const MUTED = "#9aa39a";
const DISPLAY = '900 italic 1px "Barlow Condensed", "Arial Narrow", "Segoe UI", sans-serif';

export type StoryCardInput = {
  race: RaceSouvenir;
  /** Index of the pilot whose result is the headline; null draws the winner. */
  pick: number | null;
  fmtLap: (ms: number | null) => string;
};

function font(weight: string, size: number, italic = false) {
  return `${italic ? "italic " : ""}${weight} ${size}px "Barlow Condensed", "Arial Narrow", "Segoe UI", sans-serif`;
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);     // a missing avatar is not a reason to have no story
    img.src = src;
  });
}

function ordinal(position: number): string {
  return position === 1 ? "1ER" : `${position}E`;
}

/** Render the card. Resolves to a PNG blob, or null if the browser cannot draw it. */
export async function renderStoryCard(input: StoryCardInput): Promise<Blob | null> {
  const { race, fmtLap } = input;
  const index = input.pick ?? 0;
  const me = race.drivers[index];
  if (!me) return null;

  const canvas = document.createElement("canvas");
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Fonts on a canvas are whatever is already loaded; ask for the display face first so the
  // first draw is not in a fallback that gets swapped a frame later.
  try {
    await (document as Document & { fonts?: { load: (f: string) => Promise<unknown> } }).fonts?.load(DISPLAY);
  } catch { /* no font API: the fallback face is fine */ }

  // ---- background: the venue's dark green, with a lime glow off the top -------------------
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const glow = ctx.createRadialGradient(STORY_W / 2, -200, 50, STORY_W / 2, -200, 1100);
  glow.addColorStop(0, "rgba(216,255,53,.22)");
  glow.addColorStop(1, "rgba(216,255,53,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  // a faint grid, like the big screen
  ctx.strokeStyle = "rgba(216,255,53,.05)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= STORY_W; x += 90) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, STORY_H); ctx.stroke(); }
  for (let y = 0; y <= STORY_H; y += 90) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(STORY_W, y); ctx.stroke(); }

  // ---- logo + kicker ----------------------------------------------------------------------
  const logo = await loadImage("/megakart-loader-logo.png");
  if (logo) {
    const w = 420;
    const h = (logo.height / logo.width) * w;
    ctx.drawImage(logo, (STORY_W - w) / 2, 150, w, h);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = LIME;
  ctx.font = font("900", 34);
  ctx.letterSpacing = "8px";
  ctx.fillText("SOUVENIR OFFICIEL · MEGAKART FÈS", STORY_W / 2, 470);
  ctx.letterSpacing = "0px";

  // ---- the headline: position -------------------------------------------------------------
  const position = index + 1;
  ctx.fillStyle = TEXT;
  ctx.font = font("900", 90, true);
  ctx.fillText(position === 1 ? "VAINQUEUR" : "RÉSULTAT", STORY_W / 2, 620);

  // the big number on a lime plate
  const plateW = 520, plateH = 330, plateX = (STORY_W - plateW) / 2, plateY = 680;
  ctx.fillStyle = LIME;
  ctx.beginPath();
  ctx.moveTo(plateX + 30, plateY);
  ctx.lineTo(plateX + plateW, plateY);
  ctx.lineTo(plateX + plateW - 30, plateY + plateH);
  ctx.lineTo(plateX, plateY + plateH);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.font = font("900", 250, true);
  ctx.fillText(String(position), STORY_W / 2, plateY + 245);
  ctx.font = font("900", 44);
  ctx.letterSpacing = "6px";
  ctx.fillText(`${ordinal(position)} SUR ${race.drivers.length}`, STORY_W / 2, plateY + 305);
  ctx.letterSpacing = "0px";

  // ---- who ---------------------------------------------------------------------------------
  const avatar = me.pilot ? await loadImage(`/drivers/driver-${me.pilot}.png`) : null;
  let nameY = 1130;
  if (avatar) {
    const size = 170;
    ctx.save();
    ctx.beginPath();
    ctx.arc(STORY_W / 2, 1160, size / 2 + 12, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(216,255,53,.12)";
    ctx.fill();
    ctx.strokeStyle = LIME;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.restore();
    ctx.drawImage(avatar, STORY_W / 2 - size / 2, 1160 - size / 2, size, size);
    nameY = 1330;
  }
  ctx.fillStyle = TEXT;
  ctx.font = font("900", 96, true);
  ctx.fillText(me.name.toUpperCase().slice(0, 18), STORY_W / 2, nameY);
  ctx.fillStyle = MUTED;
  ctx.font = font("700", 40);
  ctx.letterSpacing = "4px";
  ctx.fillText(`KART ${me.kart}  ·  ${me.laps} TOUR${me.laps > 1 ? "S" : ""}`, STORY_W / 2, nameY + 62);
  ctx.letterSpacing = "0px";

  // ---- the lap ----------------------------------------------------------------------------
  const lapY = nameY + 130;
  ctx.fillStyle = LIME;
  ctx.font = font("900", 34);
  ctx.letterSpacing = "6px";
  ctx.fillText("MEILLEUR TOUR", STORY_W / 2, lapY);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = TEXT;
  ctx.font = font("900", 128, true);
  ctx.fillText(fmtLap(me.bestLapMs), STORY_W / 2, lapY + 125);

  // ---- the field: everyone else, in finishing order, the sharer marked in lime -------------
  // Up to five rows, which is what fits; a bigger race shows the top five and says how many.
  const rows = race.drivers.slice(0, 5);
  const rowH = 58, listW = 880, listX = (STORY_W - listW) / 2;
  let y = lapY + 215;
  ctx.textAlign = "left";
  ctx.font = font("900", 30);
  ctx.fillStyle = MUTED;
  ctx.letterSpacing = "5px";
  ctx.fillText("CLASSEMENT", listX, y);
  ctx.letterSpacing = "0px";
  y += 22;
  rows.forEach((d, i) => {
    const mine = i === index;
    if (mine) {
      ctx.fillStyle = "rgba(216,255,53,.14)";
      ctx.fillRect(listX - 16, y, listW + 32, rowH);
      ctx.fillStyle = LIME;
      ctx.fillRect(listX - 16, y, 8, rowH);
    }
    const base = y + rowH / 2 + 12;
    ctx.textAlign = "left";
    ctx.fillStyle = mine ? LIME : MUTED;
    ctx.font = font("900", 34, true);
    ctx.fillText(String(i + 1), listX + 10, base);
    ctx.fillStyle = mine ? TEXT : "#c9d0c6";
    ctx.font = font(mine ? "900" : "700", 34);
    ctx.fillText(d.name.toUpperCase().slice(0, 16), listX + 70, base);
    ctx.textAlign = "right";
    ctx.fillStyle = mine ? LIME : MUTED;
    ctx.font = font("700", 32);
    ctx.fillText(fmtLap(d.bestLapMs), listX + listW - 10, base);
    y += rowH + 6;
  });
  if (race.drivers.length > rows.length) {
    ctx.textAlign = "left";
    ctx.fillStyle = MUTED;
    ctx.font = font("700", 28);
    ctx.fillText(`+ ${race.drivers.length - rows.length} autre${race.drivers.length - rows.length > 1 ? "s" : ""} pilote${race.drivers.length - rows.length > 1 ? "s" : ""}`, listX, y + 20);
  }
  ctx.textAlign = "center";

  // ---- date + QR ---------------------------------------------------------------------------
  const when = new Date(race.finishedAt);
  ctx.fillStyle = MUTED;
  ctx.font = font("700", 34);
  ctx.fillText(
    when.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    STORY_W / 2, 1730,
  );

  ctx.fillStyle = LIME;
  ctx.font = font("900", 30);
  ctx.letterSpacing = "8px";
  ctx.fillText("MEGAKART FÈS", STORY_W / 2, 1800);
  ctx.letterSpacing = "0px";

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export type StoryShareOutcome = "shared" | "downloaded" | "failed";

/**
 * Hand the card to the share sheet as a file. On a phone that puts Instagram (Story), WhatsApp
 * and the camera roll one tap away. Where files cannot be shared - a desktop browser - the
 * image is downloaded instead, which is the same picture by another route.
 */
export async function shareStory(blob: Blob, filename = "megakart-souvenir.png"): Promise<StoryShareOutcome> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (nav.share && (!nav.canShare || nav.canShare({ files: [file] }))) {
      await nav.share({ files: [file], title: "Mon résultat MegaKart" });
      return "shared";
    }
  } catch (e) {
    // The sheet was dismissed, or the platform refused files: fall through to the download.
    if ((e as { name?: string })?.name === "AbortError") return "failed";
  }
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return "downloaded";
  } catch {
    return "failed";
  }
}
