import { useMemo } from "react";
import { buildQrPath } from "@/lib/qr-svg";

type QrCodeProps = {
  value: string;
  /** Rendered size; any CSS length. The code scales without blurring (SVG). */
  size?: string;
  className?: string;
  label?: string;
};

// Renders `value` as an SVG QR code: one path of dark modules on a light ground with the
// 4-module quiet zone scanners need. Medium error correction keeps long souvenir links scannable.
export function QrCode({ value, size = "100%", className, label = "QR code" }: QrCodeProps) {
  const matrix = useMemo(() => buildQrPath(value), [value]);

  if (!matrix) return <span className={className} role="img" aria-label={label}>Lien trop long pour un QR code</span>;
  const { path, dimension } = matrix;

  return (
    <svg
      className={className}
      viewBox={`0 0 ${dimension} ${dimension}`}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={dimension} height={dimension} fill="#ffffff" />
      <path d={path} fill="#050604" />
    </svg>
  );
}
