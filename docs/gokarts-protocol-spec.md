# GoKarts live-feed protocol — observed specification

**What this is.** A description of how Apex GoKarts behaves *on the wire*, built entirely by
observing the traffic it emits on its network ports and validating the decode against real
captured sessions. It is not derived from Apex source, binaries, or documentation. It exists so
MegaKart can be structured against a documented contract instead of guesswork.

**What this is not.** It says nothing about GoKarts' internal logic, and it does not describe
the authenticated write path (session create / arm / classify). That path is gated behind
Apex's own authentication and is obtained from Apex — see [The write wall](#the-write-wall).

**Confidence.** Everything marked ✅ is validated against two real sessions (MOHAMMED, then
TEST DRIVER 1) and reproduced independently — MegaKart's own lap arithmetic matches GoKarts'
figures 31/31 (±1 ms). Items marked ❔ are observed but not fully pinned.

---

## 1. Topology

```
detection loop ──serial──► GoKarts ──┬─ TCP 3074   GoServer software bus
(FTDI, COM3,                          ├─ TCP 9120   Members API   (auth-walled)
 held exclusively)                    ├─ TCP 9122   Sessions API  (auth-walled)
                                      └─ TCP 30000+N  LIVE FEED    (unauthenticated) ◄── this doc
Firebird 5.0 ── TCP 3050
```

- The **detection loop** is a sensor. It reports "transponder X crossed at time T" over serial
  and nothing more. Lap counting, classification, flags — all of that is GoKarts computing on
  top. COM3 is held exclusively by GoKarts; it is never opened by anything else. ✅
- The **live feed** (this document) is the one unauthenticated, read-only source. It is
  GoKarts' *output* — already-classified — not the raw loop signal.

---

## 2. Feed transport

| Property | Value | Conf |
|---|---|---|
| Protocol | TCP, plain text, newline-delimited | ✅ |
| Host | the GoKarts PC (`127.0.0.1` when co-located) | ✅ |
| Port — idle | `30001` | ✅ |
| Port — active session N | `30000 + N` (session 3 → `30003`) | ✅ |
| Encoding | UTF-8, pipe-delimited fields | ✅ |
| Framing | one message per line, `\n` terminated | ✅ |

**Port is dynamic.** The port only *exists* while relevant: with GoKarts running but no session
armed, **no port in 30000–30020 listens at all** — there is no socket to read, so no passing can
arrive regardless of what crosses the loop. ✅ This is the single most important fact for
structuring an agent: the feed is a consequence of an armed session, not a standing service.

**Discovery.** Scan `30001..30012`, prefer the highest active port. Reconnect on drop and
re-scan; a new session appears on a new port. ✅

**Client model.** Connect, then read. The feed pushes; the client sends nothing. ❔ whether the
feed accepts multiple simultaneous clients is untested — assume single-client and do not open a
second socket while GoKarts is timing.

---

## 3. Message vocabulary

Every line is `TAG|field|field|...`. Observed tags:

| Tag | Meaning | Notes |
|---|---|---|
| `SYNC` | heartbeat | ~10 s cadence; `SYNC|1|` |
| `STY` | session state | idle observed as `STY|0||||` — see caveat below |
| `MSG` | free-text message | operator/system text |
| `STL` | start list | seen, not decoded |
| `CTL` | control | seen, not decoded |
| `NREC` | new record (a passing, or a session marker) | **the payload** — §4 |
| `UREC` | update record | merges into an existing record by seq |

**`STY` caveat.** In both captured sessions every `STY` was `STY|0` — session state was **not**
reliably carried by `STY`. Do not use it as a session boundary. The real boundaries are flags
*inside* the `NREC` stream (§4). ✅

---

## 4. `NREC` — the record line

```
NREC | seq | flags | transponder | ? | ts_us | lapNo | total_us | last_us | s1 | s2 | s3 | name?
   0    1      2          3        4     5       6         7         8       9  10  11    12
```

| # | Field | Type | Source | Conf |
|---|---|---|---|---|
| 0 | `seq` | int | record id within the session | ✅ |
| 1 | `flags` | int bitfield | passing type / marker (see below) | ✅ |
| 2 | `transponder` | int | physical tag id; `0` on session markers | ✅ |
| 3 | `?` | int | driver/entrant id — differs per driver ❔ | ❔ |
| 4 | `ts_us` | int | **hardware timestamp, microseconds** | ✅ |
| 5 | `lapNo` | int | lap number — **computed by GoKarts** | ✅ |
| 6 | `total_us` | int | cumulative time, µs — **computed by GoKarts** | ✅ |
| 7 | `last_us` | int | last lap, µs — **computed by GoKarts** | ✅ |
| 8–10 | `s1 s2 s3` | int | sector times, µs — 0 when unused | ✅ |
| 11 | `name?` | string | driver name when present, else empty | ❔ |

### flags

| Value | Hex | Meaning |
|---|---|---|
| `2` | `0x2` | normal passing |
| `786434` | `0xC0002` | best-lap marker |
| `65282` | `0xFF02` | **session-start** marker (transponder 0) |
| `65285` | `0xFF05` | **session-end / reset** (transponder 0, kart 0) |

### The critical distinction for building a program

Of the twelve fields, only **two are the raw hardware's own truth**: `transponder` (#2) and
`ts_us` (#4). Everything else — `lapNo`, `total_us`, `last_us`, sectors — is **GoKarts'
classification of *its* session window.** ✅

This is why MegaKart recomputes from `(transponder, ts_us)` pairs alone and ignores GoKarts'
lap arithmetic: if your session window differs from GoKarts', its numbers are wrong for you.
Verified: the 731 ms lap GoKarts reported is reproduced exactly from raw timestamps. ✅

### Worked example (real capture)

```
NREC|1|65282|0|0|3998635319237000|0|0|0|0|0|0|        ← session START
NREC|2|2|23|1|3998635319237000|1|0|0|0|0|0|           ← transponder 23, first crossing
NREC|3|786434|23|1|3998635319968000|2|731000|731000  ← BEST-LAP flag; 3998635319968000
                                                         − 3998635319237000 = 731000 µs = 0.731 s ✅
NREC|52|65285|0|0|3998635800281000|0|481044000|0|...  ← session END
```

The lap time is derivable purely from the timestamp delta — no dependence on GoKarts' fields.

---

## 5. How to structure a program against this

Rules that fall directly out of the observations above:

1. **The feed exists only while a session is armed.** Treat "no port" as a first-class state,
   distinct from "port open, nobody has crossed yet." Never let an empty leaderboard mean both.
2. **Own your session window.** Bracket the race with your own start/stop; do not depend on
   GoKarts' `65282`/`65285` as your boundaries (record them as context only).
3. **Trust two fields.** Compute laps/gaps/best from `(transponder, ts_us)`. Ignore `lapNo`,
   `total_us`, `last_us`.
4. **`laps = crossings − 1`.** The first crossing starts a lap, it does not complete one.
5. **Filter at read time, not ingest.** Keep every crossing; apply a min-lap guard (default
   250 ms) when computing the board, so a mis-set threshold is a recompute, not a lost race.
   (Real data contains 0 ms duplicate crossings — the same pass reported twice — and genuine
   sub-second laps down to ~330 ms; the guard must remove the first without eating the second.)
6. **Identity is per-session.** A transponder is physical hardware, reused by a different driver
   each session (id 23 was MOHAMMED, then TEST DRIVER 1). Resolve `transponder → driver` through
   a per-session roster, never a static map.
7. **A race counted across a feed drop is incomplete — mark it so, permanently.**

The MegaKart reference implementation of all seven lives in
[`tools/apex-bridge/chrono.mjs`](../tools/apex-bridge/chrono.mjs), with the decode validator in
[`tools/apex-bridge/decode.mjs`](../tools/apex-bridge/decode.mjs) and 23 unit + 20 e2e tests.

---

## 6. The write wall

Everything above is the **read** side, and it is complete and proven.

**Creating, arming, or classifying a session** — writing into GoKarts — is not on the feed. It
requires GoKarts' authenticated APIs:

- **Sessions API (9122)** and **Members API (9120)**: XML-over-TCP, `<connection key="NONCE"/>`
  challenge + a signed response (`@pex` / `TWebToken`). This is a deliberate authentication
  wall placed by Apex. ✅ that it exists; the signing scheme is **not** documented here and is
  not to be reconstructed.
- **JSON import** (`IMPORT_SESSIONS_JSON_DIR`): investigated and confirmed to import session
  **stats/history**, not runnable sessions. Not a write path for creating races. ✅

**The supported way through is Apex.** As a licensed centre (888), request the Sessions API
token and write spec from Apex. MegaKart already has the seam to receive it:
[`lib/apex-session-controller.ts`](../lib/apex-session-controller.ts) — a
`NotConfiguredApexController` today, swapped for a real implementation the day a token exists,
with no UI change. When that lands, "run races from MegaKart" becomes a config change.

Two things worth asking Apex at the same time:
1. A **decoder mirror output** (a second TCP/UDP destination for passings) — this would give
   MegaKart a timing feed independent of GoKarts running at all, still read-only.
2. Whether `AUTO_INSERT_DRIVERS` (already enabled in the config) will create pilots from unknown
   transponders on the fly, removing the manual name entry.

---

## 7. Boundary (unchanged, and it holds)

Counting laps is **observation**. Releasing karts — start lights, kart power (GoControl),
remote shutdown (DeHaardt) — is **control**, and control stays with a human. Nothing in
MegaKart automates the control side, and the feed described here cannot reach it: it is a
read-only stream of passings, not a command channel.
