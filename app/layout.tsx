import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MegaKart Operations Dashboard",
  description: "Pilotage des courses, réservations, ventes et pass fidélité MegaKart Fès.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
