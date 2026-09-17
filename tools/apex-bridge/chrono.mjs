// MEGAKART-OWNED CHRONO — our own race session, computed from raw crossings.
//
// The dashboard defines the window (Démarrer / Arrêter). Everything in the classification is
// derived HERE from (transponder, ts_us) pairs. We deliberately do NOT reuse GoKarts' lapNo,
// total_us or last_us: those are ITS classification of ITS session window, and if our window
// differs from its window, its numbers are wrong for us. The only upstream values we trust are:
//
//   transponder  — who crossed
//   ts_us        — the hardware timestamp of the crossing (microseconds)
//
// We also do NOT use GoKarts' 65282/65285 session markers as our boundaries. They are recorded
// only as context, so an operator can see whether GoKarts happened to be running a session at
// the same time.
//
// ---------------------------------------------------------------------------------------
// THE LEDGER, AND WHY FILTERING HAPPENS AT READ TIME
//
// Every crossing is appended to a ledger and NEVER deleted. The double-read guard, and any
// other judgement call, is applied when the classification is COMPUTED, not when the event
// arrives. That matters because the guard's threshold is a guess about a specific track:
// measured against the real capture on this system, a 1500 ms threshold discards 24 of 90
// genuine intervals (27%) for transponder 23 — intervals of 332, 621, 731, 1031 ms and more.
//
// If the threshold were applied at ingest, a bad guess would destroy the evidence and the only
// remedy would be to re-run the race. Because classify() is a pure function of
// (ledger, rules), a bad guess is instead a two-second correction: change minLapMs, recompute,
// and the result is re-derived from the same crossings.
//
// This module is pure bookkeeping over events the bridge already receives. It sends nothing to
// Apex, opens no serial port, and has no connection to kart power, start lights or any control
// system. Counting laps is observation; releasing karts is control, and control stays manual.

/**
 * Why membership is decided by ARRIVAL, not by comparing ts_us to a start time:
 * ts_us is a free-running hardware clock (values like 3998635319237000) with no defined
 * relationship to our wall clock. Mapping the two would need a calibration we do not have.
 * Since we are reading a live stream, a crossing that ARRIVES after the operator pressed
 * start is by definition after the start. So arrival decides membership; ts_us is used only
 * for durations, where it is exact and authoritative.
 */

/**
 * Default guard. Deliberately small: at 250 ms it removes exact duplicates and near-instant
 * re-reads (the capture contains seven 0 ms intervals — the same crossing reported twice)
 * while keeping every plausible lap. A guard that is too small shows a suspicious extra lap
 * the operator can see and correct; one that is too large silently deletes real laps and
 * nobody ever knows. Prefer the visible failure.
 */
const DEFAULT_MIN_LAP_MS = 250;

export function createChrono({ resolveDriver, onChange, now = () => Date.now() }) {
  let s = idle();

  function idle() {
    return {
      running: false,
      sessionId: null,
      name: null,
      startedAt: null,
      stoppedAt: null,
      rules: { minLapMs: DEFAULT_MIN_LAP_MS },
      /** Append-only. Nothing is ever removed from here. */
      ledger: [],
      /** GoKarts markers seen during our window (context only, never boundaries) */
      upstreamMarkers: [],
      /** periods the feed was down while we were counting — affects result integrity */
      feedDrops: 0,
      result: null,
    };
  }

  function start({ sessionId = null, name = null, minLapMs } = {}) {
    s = idle();
    s.running = true;
    s.sessionId = sessionId;
    s.name = name;
    s.startedAt = new Date(now()).toISOString();
    if (Number.isFinite(+minLapMs) && +minLapMs >= 0) s.rules.minLapMs = +minLapMs;
    onChange?.();
    return snapshot();
  }

  function stop() {
    if (!s.running) return snapshot();
    s.running = false;
    s.stoppedAt = new Date(now()).toISOString();
    s.result = classify(s.rules);
    onChange?.();
    return snapshot();
  }

  /**
   * Re-derive the classification under different rules, from the SAME crossings. This is the
   * whole point of keeping a ledger: a mis-set threshold is corrected, not re-raced.
   * Works while running and after the finish.
   */
  function reclassify({ minLapMs } = {}) {
    if (Number.isFinite(+minLapMs) && +minLapMs >= 0) s.rules.minLapMs = +minLapMs;
    if (!s.running) s.result = classify(s.rules);
    onChange?.();
    return snapshot();
  }

  function reset() {
    s = idle();
    onChange?.();
    return snapshot();
  }

  /**
   * One crossing from the feed. `flags` is passed only so we can note GoKarts' own session
   * markers as context — they never open or close OUR window. Nothing is rejected here:
   * every crossing enters the ledger, and judgement is deferred to classify().
   */
  function onPassing({ transponder, tsUs, flags, seq = null }) {
    if (!s.running) return;

    if (flags === "65282" || flags === "65285") {
      s.upstreamMarkers.push({ flags, at: new Date(now()).toISOString() });
      onChange?.();
      return;
    }
    if (!transponder || transponder === "0") return;
    if (!Number.isFinite(tsUs) || tsUs <= 0) return;

    s.ledger.push({ transponder: String(transponder), tsUs, flags, seq, arrivedAt: now() });
    onChange?.();
  }

  function noteFeedDrop() {
    if (s.running) s.feedDrops++;
  }

  /**
   * Turn the ledger into a classification, under the given rules. Pure: same ledger + same
   * rules always yields the same board.
   *
   * The first kept crossing does not complete a lap — it STARTS the first timed lap. A kart
   * that has crossed once has 0 completed laps, which is why `laps = kept - 1`. Getting this
   * wrong is the classic off-by-one that makes a timing system confidently wrong.
   */
  function classify(rules) {
    const minLapUs = (rules?.minLapMs ?? DEFAULT_MIN_LAP_MS) * 1000;
    const byT = new Map();
    for (const c of s.ledger) {
      if (!byT.has(c.transponder)) byT.set(c.transponder, []);
      byT.get(c.transponder).push(c);
    }

    const rows = [];
    let excludedTotal = 0;

    for (const [transponder, all] of byT) {
      const sorted = [...all].sort((a, b) => a.tsUs - b.tsUs);

      // Apply the guard HERE, over a copy. The ledger itself is untouched.
      const kept = [];
      let excluded = 0;
      for (const c of sorted) {
        const prev = kept[kept.length - 1];
        if (prev && c.tsUs - prev.tsUs < minLapUs) { excluded++; continue; }
        kept.push(c);
      }
      excludedTotal += excluded;

      const ts = kept.map((c) => c.tsUs);
      const n = ts.length;
      const lapTimesUs = [];
      for (let i = 1; i < n; i++) lapTimesUs.push(ts[i] - ts[i - 1]);

      const bestUs = lapTimesUs.length ? Math.min(...lapTimesUs) : null;
      const lastUs = lapTimesUs.length ? lapTimesUs[lapTimesUs.length - 1] : null;
      const totalUs = n >= 2 ? ts[n - 1] - ts[0] : null;

      const who = resolveDriver?.(transponder) || null;
      rows.push({
        transponder,
        name: who?.name ?? null,
        kart: who?.kartNumber ?? null,
        color: who?.color ?? null,
        crossings: n,
        /** how many of this pilot's raw crossings the current threshold is hiding */
        excluded,
        rawCrossings: sorted.length,
        laps: Math.max(0, n - 1),
        lastLapMs: lastUs != null ? Math.round(lastUs / 1000) : null,
        bestLapMs: bestUs != null ? Math.round(bestUs / 1000) : null,
        totalTimeMs: totalUs != null ? Math.round(totalUs / 1000) : null,
        _lastTs: n ? ts[n - 1] : 0,
      });
    }

    // Position: more completed laps wins. On equal laps, whoever reached that lap count
    // EARLIER (smaller last timestamp) is ahead — that is what being in front means on track.
    rows.sort((a, b) => (b.laps - a.laps) || (a._lastTs - b._lastTs));

    const leader = rows[0] || null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      r.position = i + 1;
      if (!leader || r === leader) {
        r.gap = null;
        r.gapText = rows.length > 1 ? "LEADER" : null;
      } else if (r.laps < leader.laps) {
        r.gap = null;
        r.gapText = `+${leader.laps - r.laps} T`;
      } else {
        const gapMs = Math.round((r._lastTs - leader._lastTs) / 1000);
        r.gap = gapMs;
        r.gapText = `+${(gapMs / 1000).toFixed(3)}`;
      }
    }

    const withBest = rows.filter((r) => r.bestLapMs != null);
    const fastest = withBest.length ? withBest.reduce((m, r) => (r.bestLapMs < m.bestLapMs ? r : m)) : null;

    return {
      rows: rows.map(({ _lastTs, ...keep }) => keep),
      fastest: fastest ? { transponder: fastest.transponder, name: fastest.name, bestLapMs: fastest.bestLapMs } : null,
      totalCrossings: rows.reduce((n, r) => n + r.crossings, 0),
      pilots: rows.length,
      rules: { ...s.rules },
      /**
       * Integrity, so a result is never presented as clean when it is not. A race counted
       * across a feed outage has holes we cannot see, and the operator must know. `excluded`
       * is surfaced too: it is the number the operator needs to judge whether the guard is
       * set sensibly for this track.
       */
      integrity: {
        feedDrops: s.feedDrops,
        excludedByGuard: excludedTotal,
        ledgerSize: s.ledger.length,
        upstreamMarkersSeen: s.upstreamMarkers.length,
        complete: s.feedDrops === 0,
      },
    };
  }

  /** Live view while running, final view once stopped. */
  function snapshot() {
    return {
      running: s.running,
      sessionId: s.sessionId,
      name: s.name,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt,
      minLapMs: s.rules.minLapMs,
      elapsedMs: s.startedAt ? (s.stoppedAt ? Date.parse(s.stoppedAt) : now()) - Date.parse(s.startedAt) : 0,
      feedDrops: s.feedDrops,
      ledgerSize: s.ledger.length,
      upstreamMarkers: s.upstreamMarkers,
      classification: s.running ? classify(s.rules) : s.result,
    };
  }

  /** The raw evidence, for export/audit. Never rides the SSE frame — it can be large. */
  function ledger() {
    return s.ledger.slice();
  }

  return {
    start, stop, reset, reclassify, onPassing, noteFeedDrop, snapshot, ledger,
    get running() { return s.running; },
  };
}
