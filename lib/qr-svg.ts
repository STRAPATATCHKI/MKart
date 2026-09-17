import { Ecc, QrCode } from "@/lib/qrcodegen";

/** QR modules as one SVG path (4-module quiet zone included). null when the data is too long. */
export function buildQrPath(value: string): { path: string; dimension: number } | null {
  let qr: QrCode;
  try {
    qr = QrCode.encodeText(value, Ecc.MEDIUM);
  } catch {
    return null;
  }
  const border = 4;
  let path = "";
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.getModule(x, y)) path += `M${x + border},${y + border}h1v1h-1z`;
    }
  }
  return { path, dimension: qr.size + border * 2 };
}

/** Standalone SVG markup, for printing or for a window this app doesn't render with React. */
export function qrSvgMarkup(value: string, size: string): string {
  const qr = buildQrPath(value);
  if (!qr) return "";
  return `<svg viewBox="0 0 ${qr.dimension} ${qr.dimension}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${qr.dimension}" height="${qr.dimension}" fill="#ffffff"/><path d="${qr.path}" fill="#050604"/></svg>`;
}
