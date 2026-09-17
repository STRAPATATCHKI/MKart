"use client";

// Fuel page: this morning's barrel reading, what the fleet burns, and how long the stock lasts.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Check, Droplets, Fuel, Gauge, Plus, Settings2, Timer } from "lucide-react";
import { FuelBarrel } from "./fuel-barrel";
import { useFuel } from "@/hooks/use-fuel";
import { dailyUsage, estimateFuel, formatHours, formatL, todayKey, type FuelSettings } from "@/lib/fuel-store";

/** Counts up to a new value, so figures land instead of jumping. */
function useCountUp(value: number, duration = 700) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const raf = requestAnimationFrame(() => {
        setShown(value);
        from.current = value;
      });
      return () => cancelAnimationFrame(raf);
    }
    const start = performance.now();
    const origin = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(origin + (value - origin) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else from.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

const numberField: CSSProperties = {
  width: "100%", height: 44, padding: "0 12px", borderRadius: 9, border: "1px solid #2a3327",
  background: "#0d1210", color: "#f4f6ed", font: "800 16px Inter, sans-serif", fontVariantNumeric: "tabular-nums",
};

export function FuelView() {
  const { settings, days, today, saveDay, saveSettings } = useFuel();
  // Uncontrolled, keyed on the stored reading: it shows what is saved, stays editable, and needs
  // no effect to copy the stored value into state.
  const openingRef = useRef<HTMLInputElement>(null);
  const [refillInput, setRefillInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const stockL = (today?.openingL ?? 0) + (today?.refillL ?? 0);
  const estimate = useMemo(() => estimateFuel(stockL, settings), [stockL, settings]);
  const shownStock = useCountUp(stockL);
  const shownLevel = useCountUp(estimate.level * 100);
  const usage = useMemo(() => dailyUsage(days).slice(0, 7), [days]);
  const yesterday = usage.find((entry) => entry.usedL != null) ?? null;
  const peak = Math.max(1, ...usage.map((entry) => entry.usedL ?? 0));

  const saveOpening = () => {
    const litres = Math.max(0, Number((openingRef.current?.value ?? "").replace(",", ".")) || 0);
    saveDay({ date: todayKey(), openingL: litres, refillL: today?.refillL ?? 0, note: today?.note });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const addRefill = () => {
    const litres = Math.max(0, Number(refillInput.replace(",", ".")) || 0);
    if (!litres) return;
    saveDay({ date: todayKey(), openingL: today?.openingL ?? 0, refillL: (today?.refillL ?? 0) + litres, note: today?.note });
    setRefillInput("");
  };

  const setting = (key: keyof FuelSettings, value: string) => {
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed) && parsed >= 0) saveSettings({ [key]: parsed } as Partial<FuelSettings>);
  };

  const dayLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });

  return (
    <div className="fuel-page">
      <header className="page-heading fuel-heading">
        <div>
          <span className="eyebrow"><i /> CARBURANT</span>
          <h1>Consommation &amp; stock</h1>
          <p>Relevé du matin, appoints de la journée et autonomie estimée de la flotte.</p>
        </div>
        <button type="button" className="secondary-button" onClick={() => setShowSettings((v) => !v)}>
          <Settings2 size={15} /> Paramètres
        </button>
      </header>

      {estimate.low && (
        <div className="fuel-alert" role="status">
          <AlertTriangle size={17} />
          <span><strong>Stock bas</strong> — il reste {formatL(stockL)} sur {formatL(settings.capacityL, 0)}. Prévoyez une livraison.</span>
        </div>
      )}

      <section className="fuel-kpis">
        <article className={estimate.low ? "is-low" : ""}>
          <Fuel size={18} />
          <span><small>STOCK ACTUEL</small><strong>{shownStock.toFixed(1)}<em>L</em></strong><b>{Math.round(shownLevel)} % de la cuve</b></span>
        </article>
        <article>
          <Timer size={18} />
          <span><small>AUTONOMIE</small><strong>{formatHours(estimate.hoursLeft)}</strong><b>{estimate.sessionsLeft} session{estimate.sessionsLeft > 1 ? "s" : ""} de {settings.sessionMinutes} min</b></span>
        </article>
        <article>
          <Gauge size={18} />
          <span><small>FLOTTE COMPLÈTE</small><strong>{estimate.fleetLph.toFixed(1)}<em>L/h</em></strong><b>{settings.juniorKarts} junior · {settings.gtKarts} GT</b></span>
        </article>
        <article>
          <Droplets size={18} />
          <span>
            <small>CONSO. VEILLE</small>
            <strong>{yesterday?.usedL != null ? <>{yesterday.usedL.toFixed(1)}<em>L</em></> : "—"}</strong>
            <b>{yesterday?.usedL != null ? dayLabel(yesterday.day.date) : "Deux relevés nécessaires"}</b>
          </span>
        </article>
      </section>

      <section className="fuel-main">
        <article className="panel fuel-barrel-card">
          <div className="panel-header"><div><span className="panel-kicker">CUVE</span><h2>Relevé du matin</h2></div></div>
          <div className="fuel-barrel-body">
            <FuelBarrel level={estimate.level} low={estimate.low} />
            <div className="fuel-barrel-side">
              <label className="fuel-field">
                <span>Essence mesurée ce matin</span>
                <div className="fuel-input-row">
                  <input
                    key={`${today?.date ?? "new"}:${today?.openingL ?? ""}`}
                    ref={openingRef}
                    style={numberField}
                    inputMode="decimal"
                    defaultValue={today ? String(today.openingL) : ""}
                    onKeyDown={(e) => e.key === "Enter" && saveOpening()}
                    placeholder={`0 – ${settings.capacityL}`}
                    aria-label="Litres mesurés ce matin"
                  />
                  <button type="button" className="primary-button" onClick={saveOpening}>
                    {saved ? <><Check size={15} /> Enregistré</> : "Enregistrer"}
                  </button>
                </div>
              </label>

              <label className="fuel-field">
                <span>Appoint dans la journée</span>
                <div className="fuel-input-row">
                  <input
                    style={numberField}
                    inputMode="decimal"
                    value={refillInput}
                    onChange={(e) => setRefillInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addRefill()}
                    placeholder="litres ajoutés"
                    aria-label="Litres ajoutés"
                  />
                  <button type="button" className="secondary-button" onClick={addRefill}><Plus size={15} /> Ajouter</button>
                </div>
              </label>

              <dl className="fuel-readout">
                <div><dt>Relevé</dt><dd>{today ? formatL(today.openingL) : "—"}</dd></div>
                <div><dt>Appoints</dt><dd>{today?.refillL ? formatL(today.refillL) : "—"}</dd></div>
                <div><dt>Total</dt><dd className="lime">{formatL(stockL)}</dd></div>
              </dl>
            </div>
          </div>
        </article>

        <article className="panel fuel-estimate-card">
          <div className="panel-header"><div><span className="panel-kicker">ESTIMATION</span><h2>Consommation par kart</h2></div></div>

          <div className="fuel-karts">
            <div className="fuel-kart fuel-kart--junior">
              <span className="fuel-kart-tag">JUNIOR</span>
              <strong>{settings.juniorLph.toFixed(1)}<em>L/h</em></strong>
              <small>{formatL(estimate.juniorPerSessionL, 2)} par session de {settings.sessionMinutes} min</small>
              <div className="fuel-kart-bar"><i style={{ width: `${(settings.juniorLph / Math.max(settings.juniorLph, settings.gtLph)) * 100}%` }} /></div>
            </div>
            <div className="fuel-kart fuel-kart--gt">
              <span className="fuel-kart-tag">GT</span>
              <strong>{settings.gtLph.toFixed(1)}<em>L/h</em></strong>
              <small>{formatL(estimate.gtPerSessionL, 2)} par session de {settings.sessionMinutes} min</small>
              <div className="fuel-kart-bar"><i style={{ width: `${(settings.gtLph / Math.max(settings.juniorLph, settings.gtLph)) * 100}%` }} /></div>
            </div>
          </div>

          <div className="fuel-session-note">
            <Gauge size={15} />
            <span>Une session complète ({settings.juniorKarts} junior + {settings.gtKarts} GT) consomme <strong>{formatL(estimate.fleetPerSessionL, 1)}</strong>. Le stock actuel couvre <strong>{estimate.sessionsLeft}</strong> session{estimate.sessionsLeft > 1 ? "s" : ""}.</span>
          </div>

          <div className="fuel-history">
            <div className="fuel-history-head"><span>7 DERNIERS JOURS</span><small>litres consommés</small></div>
            {!usage.some((entry) => entry.usedL != null) ? (
              <div className="empty-state" style={{ padding: "22px 16px" }}>
                <Droplets size={20} />
                <strong>{usage.length === 0 ? "Aucun relevé" : "Encore un relevé"}</strong>
                <span>
                  {usage.length === 0
                    ? "Enregistrez le niveau chaque matin pour suivre la consommation."
                    : "La consommation d’une journée se calcule entre deux relevés du matin : revenez demain."}
                </span>
              </div>
            ) : (
              <ul className="fuel-bars">
                {usage.map(({ day, usedL }) => (
                  <li key={day.date}>
                    <i style={{ height: `${usedL != null ? Math.max(6, (usedL / peak) * 100) : 4}%` }} className={usedL == null ? "is-empty" : ""} />
                    <b>{usedL != null ? usedL.toFixed(0) : "—"}</b>
                    <small>{dayLabel(day.date)}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      </section>

      {showSettings && (
        <section className="panel fuel-settings">
          <div className="panel-header"><div><span className="panel-kicker">PARAMÈTRES</span><h2>Cuve et flotte</h2></div></div>
          <div className="fuel-settings-grid">
            {([
              ["capacityL", "Capacité de la cuve (L)"],
              ["reserveL", "Seuil d’alerte (L)"],
              ["juniorLph", "Kart JUNIOR (L/h)"],
              ["gtLph", "Kart GT (L/h)"],
              ["juniorKarts", "Nombre de karts JUNIOR"],
              ["gtKarts", "Nombre de karts GT"],
              ["sessionMinutes", "Durée d’une session (min)"],
            ] as Array<[keyof FuelSettings, string]>).map(([key, label]) => (
              <label key={key} className="fuel-field">
                <span>{label}</span>
                <input
                  style={numberField}
                  inputMode="decimal"
                  defaultValue={String(settings[key])}
                  onBlur={(e) => setting(key, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setting(key, (e.target as HTMLInputElement).value)}
                />
              </label>
            ))}
          </div>
          <small className="fuel-settings-note">Les valeurs par défaut sont des estimations : ajustez-les avec vos relevés réels pour affiner l’autonomie.</small>
        </section>
      )}
    </div>
  );
}
