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
  dailyUsage, dayFuel, daysSince, estimateFuel, formatHours, formatL, parseKartList, tankStock, todayKey,
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
  const { settings, days, tank, saveSettings, addRefill: pourIn, setLevel } = useFuel();
  const { races, state: raceState } = useSavedRaces();
  // Free runs from the start of the running stock (and a week at least, for the chart).
  const { stints, state: runState } = useFreeRuns(Math.max(7, tank ? daysSince(tank.baseAt) : 7));
  const levelRef = useRef<HTMLInputElement>(null);
  const [refillInput, setRefillInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const fuel = useMemo(() => dayFuel(races, stints, settings, todayKey()), [races, stints, settings]);
  const dayRaces = fuel.races;
  // One running stock, never reset by the calendar: full on day one (or the last fill), plus
  // top-ups, minus every race and free run since.
  const stock = useMemo(() => tankStock(tank, races, stints, settings), [tank, races, stints, settings]);
  const stockL = stock ? Math.max(0, stock.stockL) : 0;
  const burnedL = stock?.burnedL ?? 0;
  const burnedTodayL = fuel.totalL;
  const estimate = useMemo(() => estimateFuel(stockL, settings), [stockL, settings]);
  const baseAt = tank ? Date.parse(tank.baseAt) : null;
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

  // Filled up, or measured with the dipstick: the count starts again from this level. Only then -
  // never each morning, which is what used to throw away the fuel burned the day before.
  const saveLevel = () => {
    const litres = Math.max(0, Number((levelRef.current?.value ?? "").replace(",", ".")) || 0);
    if (!window.confirm(`Le stock repart de ${formatL(litres)} maintenant (plein fait ou niveau mesuré) ?`)) return;
    setLevel(litres);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  const addRefill = () => {
    const litres = Math.max(0, Number(refillInput.replace(",", ".")) || 0);
    if (!litres) return;
    pourIn(litres);
    setRefillInput("");
  };

  const setting = (key: keyof FuelSettings, value: string) => {
    if (key === "juniorKartNumbers") { saveSettings({ juniorKartNumbers: parseKartList(value) }); return; }
    const parsed = Number(value.replace(",", "."));
    if (Number.isFinite(parsed) && parsed >= 0) saveSettings({ [key]: parsed } as Partial<FuelSettings>);
  };

  const dayLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  const time = (ms: number) => new Date(ms).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dateLabel = (ms: number) => new Date(ms).toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "2-digit" });
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
            <p>Un stock continu : plein de départ, appoints, et chaque course réelle déduite.</p>
          </div>
          <button type="button" className="secondary-button" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 size={15} /> Paramètres
          </button>
        </header>
      )}

      {stock && stock.stockL < 0 && (
        <div className="fuel-alert" role="status">
          <AlertTriangle size={17} />
          <span><strong>Le calcul passe sous zéro</strong> ({formatL(stock.stockL)}) : un appoint n’a sans doute pas été enregistré. Ajoutez-le, ou enregistrez le niveau mesuré.</span>
        </div>
      )}
      {estimate.low && stock && stock.stockL >= 0 && (
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
        <article className={estimate.low && stock ? "is-low" : ""}>
          <Fuel size={18} />
          <span>
            <small>STOCK ACTUEL</small>
            <strong>{stock ? <>{shownStock.toFixed(1)}<em>L</em></> : "—"}</strong>
            <b>{stock && baseAt != null ? `${Math.round(shownLevel)} % de la cuve · −${formatL(burnedL)} depuis le ${dateLabel(baseAt)}` : "Enregistrez le niveau de la cuve"}</b>
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
          <span><small>AUTONOMIE</small><strong>{stock ? formatHours(estimate.hoursLeft) : "—"}</strong><b>{estimate.sessionsLeft} session{estimate.sessionsLeft > 1 ? "s" : ""} de {settings.sessionMinutes} min, flotte complète</b></span>
        </article>
        <article>
          <Gauge size={18} />
          <span><small>FLOTTE COMPLÈTE</small><strong>{estimate.fleetLph.toFixed(1)}<em>L/h</em></strong><b>{settings.juniorKarts} junior · {settings.gtKarts} GT</b></span>
        </article>
      </section>

      <section className="fuel-main">
        <article className="panel fuel-barrel-card">
          <div className="panel-header"><div><span className="panel-kicker">CUVE</span><h2>Stock continu</h2></div></div>
          <div className="fuel-barrel-body">
            <FuelBarrel level={estimate.level} low={estimate.low} />
            <div className="fuel-barrel-side">
              {stock && baseAt != null ? (
                <p className="fuel-since">
                  Depuis le {dateLabel(baseAt)} ({formatL(stock.baseL, 0)}) : {stock.races} course{stock.races > 1 ? "s" : ""} et {stock.runs} roulage{stock.runs > 1 ? "s" : ""} hors course déduits. Pas de remise à zéro chaque jour.
                </p>
              ) : null}

              <label className="fuel-field">
                <span>Appoint (litres versés dans la cuve)</span>
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

              <label className="fuel-field">
                <span>Plein fait ou niveau mesuré (le compte repart de là)</span>
                <div className="fuel-input-row">
                  <input
                    ref={levelRef}
                    style={numberField}
                    inputMode="decimal"
                    defaultValue={String(settings.capacityL)}
                    onKeyDown={(e) => e.key === "Enter" && saveLevel()}
                    placeholder={`0 – ${settings.capacityL}`}
                    aria-label="Litres dans la cuve maintenant"
                  />
                  <button type="button" className="secondary-button" onClick={saveLevel}>
                    {saved ? <><Check size={15} /> Enregistré</> : "Enregistrer"}
                  </button>
                </div>
              </label>

              <dl className="fuel-readout">
                <div><dt>Départ{baseAt != null ? ` · ${dateLabel(baseAt)}` : ""}</dt><dd>{stock ? formatL(stock.baseL) : "—"}</dd></div>
                <div><dt>Appoints</dt><dd>{stock?.refillL ? `+${formatL(stock.refillL)}` : "—"}</dd></div>
                <div><dt>Roulage</dt><dd>{burnedL > 0 ? `−${formatL(burnedL)}` : "—"}</dd></div>
                <div><dt>Reste</dt><dd className="lime">{stock ? formatL(stock.stockL) : "—"}</dd></div>
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
                <li key={r.raceId} className={baseAt != null && r.at < baseAt ? "is-before" : ""}
                  title={baseAt != null && r.at < baseAt ? "Avant le dernier plein : déjà comptée dans le niveau" : undefined}>
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
                <li key={`${r.transponder}-${r.start}`} className={baseAt != null && r.start < baseAt ? "is-before" : ""}>
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
