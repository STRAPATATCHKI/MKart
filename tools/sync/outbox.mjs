// APPEND-ONLY OUTBOX — the venue's memory of what it still owes the cloud.
//
// Every event the venue produces is appended here first and only acknowledged once Render
// confirms it. That ordering is the whole point: if the internet drops mid-race, the race is
// already on disk, and the agent replays from the last acknowledged sequence when the link
// returns. Nothing is ever held only in memory while waiting for a network call.
//
// Sequence numbers are monotonic per venue and never reused. Render deduplicates on
// (venueId, seq), so a retry after a timeout is harmless — the alternative, generating a new
// id per attempt, turns every flaky connection into duplicate races in the history.

import fs from "node:fs";
import path from "node:path";

const MAX_LINE_BYTES = 256 * 1024;

export function createOutbox({ dir, maxEvents = 50_000 }) {
  fs.mkdirSync(dir, { recursive: true });
  const logFile = path.join(dir, "outbox.ndjson");
  const cursorFile = path.join(dir, "cursor.json");

  let seq = 0;
  let acked = 0;

  // Recover position from disk. The cursor is the source of truth for "what Render has";
  // the log is the source of truth for "what happened".
  try {
    const c = JSON.parse(fs.readFileSync(cursorFile, "utf8"));
    if (Number.isFinite(c?.acked)) acked = c.acked;
  } catch { /* first run */ }

  try {
    // Last line wins for the sequence high-water mark. Reading the whole file is fine: it is
    // pruned below maxEvents and only grows while the link is down.
    const raw = fs.readFileSync(logFile, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const e = JSON.parse(lines[i]); if (Number.isFinite(e.seq)) { seq = e.seq; break; } }
      catch { /* torn final line from a crash mid-write; skip it */ }
    }
  } catch { /* first run */ }

  function saveCursor() {
    try {
      const tmp = cursorFile + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify({ acked, seq, at: new Date().toISOString() }));
      fs.renameSync(tmp, cursorFile);
    } catch { /* a lost cursor only costs a replay, never data */ }
  }

  /**
   * Record an event. Returns its sequence number.
   * Synchronous by design: an event that reaches the caller as "recorded" must already be on
   * disk, or a crash between the two loses it.
   */
  function push(kind, payload) {
    const entry = { seq: ++seq, at: new Date().toISOString(), kind, payload };
    const line = JSON.stringify(entry);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
      // Refuse rather than write a line the reader will choke on later.
      throw new Error(`événement trop volumineux (${kind})`);
    }
    fs.appendFileSync(logFile, line + "\n");
    return entry.seq;
  }

  /** The next batch to send: everything after the last acknowledged sequence. */
  function pending(limit = 200) {
    let raw;
    try { raw = fs.readFileSync(logFile, "utf8"); } catch { return []; }
    const out = [];
    for (const line of raw.split("\n")) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      if (e.seq > acked) out.push(e);
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Render confirmed everything up to `upTo`. Only ever moves forward. */
  function ack(upTo) {
    if (!Number.isFinite(upTo) || upTo <= acked) return;
    acked = Math.min(upTo, seq);
    saveCursor();
  }

  /**
   * Drop acknowledged events once the log grows past maxEvents. Called on a quiet link, never
   * mid-batch: rewriting the file while a send is in flight would renumber nothing but could
   * lose a concurrent append.
   */
  function compact() {
    let raw;
    try { raw = fs.readFileSync(logFile, "utf8"); } catch { return 0; }
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length <= maxEvents) return 0;
    const keep = lines.filter((l) => {
      try { return JSON.parse(l).seq > acked; } catch { return false; }
    });
    const tmp = logFile + ".tmp";
    fs.writeFileSync(tmp, keep.length ? keep.join("\n") + "\n" : "");
    fs.renameSync(tmp, logFile);
    return lines.length - keep.length;
  }

  function stats() {
    return { seq, acked, backlog: Math.max(0, seq - acked) };
  }

  return { push, pending, ack, compact, stats };
}
