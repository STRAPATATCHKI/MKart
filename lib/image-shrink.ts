// A photo or a pasted screenshot made light enough to send and to keep: at most `max` pixels on
// its long side, as JPEG. A phone photo of a receipt goes from several megabytes to ~200 KB and
// stays perfectly readable. Browser only.

export async function shrinkImage(file: Blob, max = 1600, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image illisible.");
  // White under a transparent screenshot, which JPEG would otherwise turn black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

/** The image files among what was pasted or dropped. */
export function imagesIn(items: DataTransfer | null): File[] {
  if (!items) return [];
  return Array.from(items.files ?? []).filter((f) => f.type.startsWith("image/"));
}
