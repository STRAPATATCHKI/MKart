"use client";

// Shown instead of the dashboard on phones and small tablets. The console is for the office PC;
// staff who open the link on a phone should be told plainly, not handed a broken layout.
import { Monitor } from "lucide-react";

export function DeskOnlyNotice() {
  return (
    <div className="desk-only">
      <div className="desk-only-card">
        <Monitor size={40} strokeWidth={1.5} />
        <h1>Poste de commande</h1>
        <p>Le tableau de bord MegaKart s’utilise sur l’ordinateur de l’accueil : grand écran, souris et réseau de la piste.</p>
        <p className="desk-only-hint">Sur téléphone, seuls la réservation et le formulaire d’inscription des clients sont disponibles.</p>
      </div>
    </div>
  );
}
