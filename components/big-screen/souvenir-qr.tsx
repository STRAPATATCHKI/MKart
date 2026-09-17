import { QrCode } from "@/components/qr-code";

// End-of-race QR block for the TV: big enough to scan from a few metres away.
export function SouvenirQr({ url, className = "" }: { url: string; className?: string }) {
  return (
    <div className={"bs-qr " + className} data-souvenir-url={url}>
      <div className="bs-qr-code">
        <QrCode value={url} label="QR code : souvenir de la course" />
      </div>
      <div className="bs-qr-copy">
        <b>TON SOUVENIR</b>
        <span>Scanne pour garder le classement sur ton téléphone</span>
      </div>
    </div>
  );
}
