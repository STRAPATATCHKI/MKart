"use client";

// The offer catalog as the desk server holds it, shared by every page that shows a price.
//
// Three honest states, because they need different words on screen:
//   "desk"     - read from the desk; edits are saved there and appear everywhere.
//   "seed"     - the desk answered but has never been edited; showing the built-in catalog,
//                and the first save creates catalog.json.
//   "readonly" - the desk is unreachable, or too old to know /api/catalog (it has not been
//                restarted since the catalog was added). Showing the built-in catalog, and
//                saving is refused rather than pretending to work.

import { useCallback, useEffect, useState } from "react";
import { normalizeCatalog, SEED_CATALOG, type Catalog } from "@/lib/catalog";
import { BRIDGE_URL } from "@/lib/bridge-client";

export type CatalogSource = "loading" | "desk" | "seed" | "readonly";

export type CatalogView = {
  catalog: Catalog;
  source: CatalogSource;
  saving: boolean;
  error: string | null;
  /** Where the last save got to on the sign-up forms, in the operator's words. Null before any save. */
  formSync: string | null;
  save: (next: Catalog) => Promise<boolean>;
  reload: () => void;
};

// Every mounted page shares one copy, so saving on Packs & ventes updates Pass & fidélité and
// Rapports without either having to poll.
let shared: { catalog: Catalog; source: CatalogSource; formSync?: string | null } = { catalog: SEED_CATALOG, source: "loading" };
const listeners = new Set<() => void>();
const publish = (next: typeof shared) => { shared = next; listeners.forEach((l) => l()); };

async function fetchCatalog(): Promise<void> {
  try {
    const res = await fetch("/api/catalog", { cache: "no-store" });
    // An old desk answers /api/catalog with the page itself (its static fallback) or a 404:
    // either way it is not a catalog, and editing must be refused, not faked.
    const type = res.headers.get("content-type") || "";
    if (!res.ok || !type.includes("application/json")) { publish({ catalog: SEED_CATALOG, source: "readonly" }); return; }
    const body = (await res.json()) as { offers?: unknown } | null;
    if (!body || !Array.isArray(body.offers)) { publish({ catalog: SEED_CATALOG, source: "seed" }); return; }
    publish({ catalog: normalizeCatalog(body), source: "desk" });
  } catch {
    publish({ catalog: SEED_CATALOG, source: "readonly" });
  }
}

/**
 * Tell the bridge the catalog changed, so the sign-up forms have it now rather than within 30 s.
 * The bridge also publishes it for the hosted form. Best effort: it polls the desk anyway.
 */
async function nudgeBridge(): Promise<void> {
  let formSync: string;
  try {
    const res = await fetch(`${BRIDGE_URL}/catalog/sync`, { method: "POST" });
    const body = (await res.json().catch(() => null)) as { published?: boolean; source?: string } | null;
    formSync = !res.ok ? "Pont d’inscription trop ancien : redémarrez-le (restart-bridge.bat) pour mettre à jour le formulaire."
      : body?.published ? "Formulaires d’inscription à jour (Wi-Fi et en ligne)."
      : "Formulaire Wi-Fi à jour · en ligne : pas de clé Firebase sur ce PC.";
  } catch {
    formSync = "Pont d’inscription injoignable : le formulaire se mettra à jour à son redémarrage.";
  }
  publish({ ...shared, formSync });
}

export function useCatalog(): CatalogView {
  const [, force] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    if (shared.source === "loading") void fetchCatalog();
    return () => { listeners.delete(listener); };
  }, []);

  const save = useCallback(async (next: Catalog) => {
    if (shared.source === "readonly") {
      setError("Serveur d’accueil trop ancien ou injoignable : redémarrez-le (restart-desk.bat) pour enregistrer.");
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      const clean = normalizeCatalog(next);
      const res = await fetch("/api/catalog", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clean),
      });
      const body = (await res.json().catch(() => null)) as ({ error?: string } & Record<string, unknown>) | null;
      if (!res.ok) { setError((body && body.error) || `Enregistrement refusé (${res.status}).`); return false; }
      publish({ catalog: normalizeCatalog(body), source: "desk", formSync: "Envoi au formulaire d’inscription…" });
      void nudgeBridge();
      return true;
    } catch {
      setError("Serveur d’accueil injoignable : rien n’a été enregistré.");
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    catalog: shared.catalog,
    source: shared.source,
    saving,
    error,
    formSync: shared.formSync ?? null,
    save,
    reload: () => { void fetchCatalog(); },
  };
}
