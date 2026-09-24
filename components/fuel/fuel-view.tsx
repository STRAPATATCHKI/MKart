"use client";

// Fuel (Garage → Carburant): this morning's barrel reading, and everything since taking its share
// - every real race (its real duration x each kart that drove) and every kart that went round
// outside a race (tests, warm-ups, from Timing Control's activity log) - at the JUNIOR or GT rate,
// so the stock falls through the day instead of waiting for tomorrow's reading.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertTriangle, Check, Droplets, Flag, Fuel, Gauge, Plus, Settings2, Timer } from "lucide-react";
import { FuelBarrel } from "./fuel-barrel";
import { useFuel } from "@/hooks/use-fuel";
import { useSavedRaces } from "@/hooks/use-saved-races";
import { useFreeRuns } from "@/hooks/use-free-runs";
import {
  dailyUsage, dayFuel, estimateFuel, formatHours, formatL, liveFuelStock, parseKartList, todayKey,
  type FuelSettings,
} from "@/lib/fuel-store";

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

const lastDays = (n: number) => Array.from({ length: n }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - i);
  return todayKey(d);
});

export function FuelView({ embedded = false }: { embedded?: boolean }) {
  const { settings, days, today, saveDay, saveSettings } = useFuel();
  const { races, state: raceState } = useSavedRaces();
  const { stints, state: runState } = useFreeRuns(7);
  // Uncontrolled, keyed on the stored reading: it shows what is saved, stays editable, and needs
  // no effect to copy the stored value into state.
  const openingRef = useRef<HTMLInputElement>(null);
  const [refillInput, setRefillInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const fuel = useMemo(() => dayFuel(races, stints, settings, todayKey()), [races, stints, settings]);
  const dayRaces = fuel.races;
  const { stockL, burnedL } = liveFuelStock(today, fuel);
  const burnedTodayL = fuel.totalL;
  const estimate = useMemo(() => estimateFuel(stockL, settings), [stockL, settings]);
  const shownStock = useCountUp(stockL);
  const shownLevel = useCountUp(estimate.level * 100);

  // Seven days of fuel, counted from the races; the measured figure beside it when two morning
  // readings exist to compare.
  const measured = useMemo(() => new Map(dailyUsage(days).map((e) => [e.day.date, e.usedL])), [days]);
  const history = useMemo(() => lastDays(7).map((day) => ({
    day,
    litres: dayFuel(races, stints, settings, day).totalL,
    measuredL: measured.get(day) ?? null,
  })).reverse(), [races, stints, settings, measured]);
  const peak = Math.max(1, ...history.map((h) => h.litres));

  const saveOpening = () => {
    const litres = Math.max(0, Number((openingRef.current?.value ?? "").replace(",", ".")) || 0);
    // The time of the reading matters: races before it are already in the barrel's level.
    saveDay({ date: todayKey(), openingL: litres, refillL: today?.refillL ?? 0, measuredAt: new Date().toISOString(), note: today?.note });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const addRefill = () => {
    const litres = Math.max(0, Number(refillInput.replace(",", ".")) || 0);
    if (!litres) return;
    saveDay({ date: todayKey(), openingL: today?.openingL ?? 0, refillL: (today?.refillL ?? 0) + litres, measuredAt: today?.measuredAt, note: today?.note });
    setRefillInput("");
  };

  const setting = (key: keyof FuelSettings, value: string) => {
    if (key === "juniorKartNumbers") { saveSettings({ juniorKartNumbers: parseKartList(value) }); return; }
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed) && parsed >= 0) saveSettings({ [key]: parsed } as Partial<FuelSettings>);
  };

  const dayLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const noJuniorList = (settings.juniorKartNumbers ?? []).length === 0;

  return (
    <div className="fuel-page">
      {embedded ? (
        <div className="fuel-toolbar">
          <button type="button" className="secondary-button" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Paramètres
          </button>
        </div>
      ) : (
        <header className="page-heading fuel-heading">
          <div>
            <span className="eyebrow"><i /> CARBURANT</span>
            <h1>Consommation &amp; stock</h1>
            <p>Relevé du matin, appoints, et chaque course réelle déduite du stock.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Paramètres
          </button>
        </header>
      )}

      {estimate.low && today && (
        <div className="fuel-alert" role="status">
          <AlertTriangle size={17} />
          <span><strong>Stock bas</strong> — il reste {formatL(stockL)} sur {formatL(settings.capacityL, 0)}. Prévoyez une livraison.</span>
        </div>
      )}
      {noJuniorList && (
        <div className="fuel-alert fuel-alert--info" role="status">
          <Gauge size={17} />
          <span>Indiquez les numéros des karts <strong>JUNIOR</strong> dans Paramètres : tous les karts comptent comme GT en attendant.</span>
        </div>
      )}

      <section className="fuel-kpis">
        <article className={estimate.low && today ? "is-low" : ""}>
          <Fuel size={18} />
          <span>
            <small>STOCK ACTUEL</small>
            <strong>{today ? <>{shownStock.toFixed(1)}<em>L</em></> : "—"}</strong>
            <b>{today ? `${Math.round(shownLevel)} % de la cuve${burnedL > 0 ? ` · −${formatL(burnedL)} depuis le relevé` : ""}` : "Faites le relevé du matin"}</b>
          </span>
        </article>
        <article>
          <Droplets size={18} />
          <span>
            <small>CONSOMMÉ AUJOURD’HUI</small>
            <strong>{burnedTodayL.toFixed(1)}<em>L</em></strong>
            <b>{dayRaces.length} course{dayRaces.length > 1 ? "s" : ""} · {fuel.runs.length} roulage{fuel.runs.length > 1 ? "s" : ""} hors course{fuel.freeL > 0 ? ` (${formatL(fuel.freeL)})` : ""}</b>
          </span>
        </article>
        <article>
          <Timer size={18} />
          <span><small>AUTONOMIE</small><strong>{today ? formatHours(estimate.hoursLeft) : "—"}</strong><b>{estimate.sessionsLeft} session{estimate.sessionsLeft > 1 ? "s" : ""} de {settings.sessionMinutes} min, flotte complète</b></span>
        </article>
        <article>
          <Gauge size={18} />
          <span><small>FLOTTE COMPLÈTE</small><strong>{estimate.fleetLph.toFixed(1)}<em>L/h</em></strong><b>{settings.juniorKarts} junior · {settings.gtKarts} GT</b></span>
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
                <div><dt>Relevé{today?.measuredAt ? ` · ${time(Date.parse(today.measuredAt))}` : ""}</dt><dd>{today ? formatL(today.openingL) : "—"}</dd></div>
                <div><dt>Appoints</dt><dd>{today?.refillL ? `+${formatL(today.refillL)}` : "—"}</dd></div>
                <div><dt>Roulage</dt><dd>{burnedL > 0 ? `−${formatL(burnedL)}` : "—"}</dd></div>
                <div><dt>Reste</dt><dd className="lime">{today ? formatL(stockL) : "—"}</dd></div>
              </dl>
            </div>
          </div>
        </article>

        <article className="panel fuel-estimate-card">
          <div className="panel-header"><div><span className="panel-kicker">COURSES ET ROULAGES</span><h2>Carburant du jour</h2></div></div>

          {dayRaces.length === 0 ? (
            <div className="empty-state" style={{ padding: "22px 16px" }}>
              <Flag size={20} />
              <strong>{raceState === "offline" ? "Chrono hors ligne" : "Aucune course aujourd’hui"}</strong>
              <span>{raceState === "offline" ? "Ouvrez MegaKart Timing Control pour compter les courses." : "Chaque course terminée au chrono est déduite du stock."}</span>
            </div>
          ) : (
            <ul className="fuel-races">
              {dayRaces.map((r) => (
                <li key={r.raceId} className={today?.measuredAt && r.at < Date.parse(today.measuredAt) ? "is-before" : ""}
                  title={today?.measuredAt && r.at < Date.parse(today.measuredAt) ? "Avant le relevé : déjà comptée dans le niveau mesuré" : undefined}>
                  <time>{time(r.at)}</time>
                  <b>{r.name}</b>
                  <span>{r.minutes} min · {r.juniorKarts > 0 ? `${r.juniorKarts} junior · ` : ""}{r.gtKarts} GT</span>
                  <strong>{formatL(r.litres, 2)}</strong>
                </li>
              ))}
            </ul>
          )}

          {/* Karts that went round outside a race: tests, warm-ups, a kart not in the race. */}
          <div className="fuel-runs-head">
            <span>HORS COURSE</span>
            <small>
              {runState === "unsupported" ? "Redémarrez MegaKart Timing Control pour compter les roulages hors course."
                : runState === "offline" ? "Chrono hors ligne."
                : fuel.runs.length === 0 ? "Aucun kart n’a tourné hors course aujourd’hui."
                : `${fuel.runs.length} roulage${fuel.runs.length > 1 ? "s" : ""} · ${formatL(fuel.freeL, 2)}`}
            </small>
          </div>
          {fuel.runs.length > 0 && (
            <ul className="fuel-races fuel-races--runs">
              {fuel.runs.map((r) => (
                <li key={`${r.transponder}-${r.start}`} className={today?.measuredAt && r.start < Date.parse(today.measuredAt) ? "is-before" : ""}>
                  <time>{time(r.start)}</time>
                  <b>{r.kart ? `Kart ${r.kart}` : r.transponder}{r.junior ? " · junior" : ""}</b>
                  <span>{r.minutes} min · {r.passes} passages</span>
                  <strong>{formatL(r.litres, 2)}</strong>
                </li>
              ))}
            </ul>
          )}

          <div className="fuel-karts">
            <div className="fuel-kart fuel-kart--junior">
              <span className="fuel-kart-tag">JUNIOR</span>
              <strong>{settings.juniorLph.toFixed(1)}<em>L/h</em></strong>
              <small>{noJuniorList ? "Karts à indiquer" : `Karts ${settings.juniorKartNumbers.join(", ")}`}</small>
            </div>
            <div className="fuel-kart fuel-kart--gt">
              <span className="fuel-kart-tag">GT</span>
              <strong>{settings.gtLph.toFixed(1)}<em>L/h</em></strong>
              <small>Tous les autres karts</small>
            </div>
          </div>

          <div className="fuel-history">
            <div className="fuel-history-head"><span>7 DERNIERS JOURS</span><small>litres · courses et roulages</small></div>
            <ul className="fuel-bars">
              {history.map(({ day, litres, measuredL }) => (
                <li key={day} title={measuredL != null ? `Mesuré entre deux relevés : ${formatL(measuredL)}` : undefined}>
                  <i style={{ height: `${litres > 0 ? Math.max(6, (litres / peak) * 100) : 4}%` }} className={litres > 0 ? "" : "is-empty"} />
                  <b>{litres > 0 ? litres.toFixed(0) : "—"}</b>
                  <small>{dayLabel(day)}</small>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </section>

      {showSettings && (
        <section className="panel fuel-settings">
          <div className="panel-header"><div><span className="panel-kicker">PARAMÈTRES</span><h2>Cuve et flotte</h2></div></div>
          <div className="fuel-settings-grid">
            <label className="fuel-field fuel-field--wide">
              <span>Numéros des karts JUNIOR (les autres sont GT)</span>
              <input
                style={numberField}
                defaultValue={(settings.juniorKartNumbers ?? []).join(", ")}
                placeholder="ex. 1, 2, 3, 4"
                onBlur={(e) => setting("juniorKartNumbers", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setting("juniorKartNumbers", (e.target as HTMLInputElement).value)}
              />
            </label>
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
          <small className="fuel-settings-note">
            Chaque course compte sa durée réelle × chaque kart qui a fait au moins un tour ; chaque kart qui tourne hors course compte
            du premier au dernier passage, plus un tour. Ajustez les L/h avec vos relevés pour affiner.
          </small>
        </section>
      )}
    </div>
  );
}
