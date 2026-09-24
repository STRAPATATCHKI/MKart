"use client";

// GARAGE — the karts' consumables: fuel (the barrel and what each real race burns) and spare
// parts (the shelf, what to reorder, which kart each part went on).

import { useState } from "react";
import { Fuel, Package } from "lucide-react";
import { FuelView } from "@/components/fuel/fuel-view";
import { PartsView } from "./parts-view";

type Tab = "carburant" | "pieces";

export function GarageView() {
  const [tab, setTab] = useState<Tab>(() => {
    try { return (localStorage.getItem("megakart-garage-tab") as Tab) || "carburant"; } catch { return "carburant"; }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try { localStorage.setItem("megakart-garage-tab", t); } catch { /* remembered for this visit only */ }
  };
  const operator = (() => { try { return localStorage.getItem("megakart-caisse-operateur-v1") || ""; } catch { return ""; } })();

  return (
    <div className="garage">
      <header className="page-heading fuel-heading">
        <div>
          <span className="eyebrow"><i /> GARAGE</span>
          <h1>Garage</h1>
          <p>Carburant consommé course par course, et pièces de rechange des karts.</p>
        </div>
      </header>

      <div className="fa-filters garage-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "carburant"} className={tab === "carburant" ? "is-on" : ""} onClick={() => choose("carburant")}>
          <Fuel size={14} /> Carburant
        </button>
        <button type="button" role="tab" aria-selected={tab === "pieces"} className={tab === "pieces" ? "is-on" : ""} onClick={() => choose("pieces")}>
          <Package size={14} /> Pièces de rechange
        </button>
      </div>

      {tab === "carburant" ? <FuelView embedded /> : <PartsView operator={operator} />}
    </div>
  );
}
