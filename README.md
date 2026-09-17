# MegaKart Fès — dashboard, réservations et chronométrage

Operations software for an indoor karting track: visitor bookings, a counter
queue, live timing, and the venue big screen.

It sits **alongside** Apex GoKarts, never in front of it. GoKarts keeps the
safety systems — kart power and speed (GoControl), remote kart shutdown
(DeHaardt) and the start lights. Nothing here touches any of them.

---

## Architecture

```
                 ┌──────────── venue PC (MEGA-KART) ────────────┐
 detection loop  │                                              │
 (FTDI, COM3) ──►│ GoKarts ──TCP 30000+N──► bridge.mjs          │
                 │  (holds COM3            (read-only tap)      │
                 │   exclusively)              │                │
                 │                             ├─► chrono       │
                 │                             └─► /live /stream│
                 │                                              │
                 │ desk.mjs ──► reservations + queue + bundle   │
                 └───────────────────┬──────────────────────────┘
                                     │ outbound HTTPS, batched
                                     ▼
                              Render (disk = store)
                                     │
                                     ▼
                         Firebase Hosting (static bundle)
```

**Why the agent is local.** The GoKarts feed exists only on the venue LAN, on a
port that appears when a session is armed. No cloud server can reach it. The
agent reads locally and pushes outbound, so the venue needs no port forwarding
and no inbound firewall rule.

**Why the venue is local-first.** If the internet drops on a Saturday, the
counter and the big screen keep working. The cloud is a mirror, never the source
of truth for on-site operation.

**Why Render holds the data and not Firestore.** Firestore bills per document
read, and a live leaderboard is the worst possible shape for it — one screen
polling once a second is roughly 86 000 reads a day. Render serves from memory
backed by a persistent disk, at no per-read cost. Firebase does hosting and
auth, not the hot path.

Three Render constraints worth knowing: a service with a disk runs **one
instance only** (no zero-downtime deploys — deploy between sessions, never
during), a free instance **spins down** and cold-starts, and in-memory state
**dies on restart** unless it is appended to the disk as it arrives.

---

## Running it

Two processes on the venue PC. Node 24+, no npm dependencies for either.

```bash
node tools/apex-bridge/bridge.mjs      # timing   → :8787
node tools/reservations/desk.mjs       # bookings → :8788
```

Then the dashboard:

```bash
npm install
npm run dev                            # → :5173, proxies /api to the desk
```

Phones on the venue Wi-Fi open `http://<lan-ip>:8788/#reserver`. The desk prints
the exact URL and the required firewall rule at startup.

### Diagnosing

```bash
node tools/apex-bridge/diagnose.mjs    # walks the chain, names where it stops
node tools/apex-bridge/probe-test.mjs  # decodes raw feed events field by field
```

`diagnose.mjs` reports every link — loop, GoKarts, GoServer, feed port, bridge,
dashboard — and names the first broken one. It never opens COM3.

### Tests

```bash
node tools/apex-bridge/chrono.test.mjs     # lap arithmetic
node tools/apex-bridge/chrono.e2e.mjs      # against a real bridge process
node tools/apex-bridge/simulate-race.mjs   # full race from real captured passings
node tools/reservations/desk.test.mjs      # booking lifecycle (desk must be running)
```

`simulate-race.mjs` replays genuine crossings and checks our independently
computed lap times against the ones GoKarts produced for the same events.

---

## The timing chain, in short

The feed carries `NREC` lines. The only fields we trust are the **transponder**
and the **hardware timestamp**:

```
NREC | seq | flags | transponder | ? | ts_us | lapNo | total_us | last_us | s1 | s2 | s3 | name?
```

`lapNo`, `total_us` and `last_us` are GoKarts' classification of *its* session
window. MegaKart opens and closes its own window, so it recomputes everything
from `(transponder, ts_us)` pairs. Verified: 31/31 laps identical to GoKarts
(±1 ms) on real captured data.

Three rules that matter, each pinned by a test:

- **`laps = crossings − 1`.** The first crossing starts a lap, it does not
  complete one. This off-by-one is the classic way a timing system becomes
  confidently wrong.
- **Filtering happens at read time, never at ingest.** Every crossing is kept in
  an append-only ledger and the double-read guard is applied when the board is
  computed, so a mis-set threshold is a recompute rather than a lost race.
- **A race counted across a feed outage is permanently marked incomplete.**

---

## Secrets and personal data

**No real value belongs in this repository.** `.env.example` documents every
variable with placeholders; the real ones live in Render's environment.

Anything prefixed `VITE_` is compiled into the JavaScript served to phones and
is readable by anyone. Never put a secret behind a `VITE_` prefix.

Bookings contain names, phone numbers, e-mails, birth dates, ages and heights —
and the junior category starts at 130 cm, so some records belong to **children**.
Those files are git-ignored and stay on the venue PC:

```
tools/apex-bridge/out/          signups, capture logs, history, chrono state
%LOCALAPPDATA%\MegaKart\        reservations.json, snapshots
tools/apex-bridge/roster.json   current session's drivers  (roster.example.json is committed)
tools/apex-bridge/karts.json    this venue's kart wiring   (karts.example.json is committed)
```

Before force-adding anything, remember a pushed file stays in git history
forever, even if a later commit deletes it.

---

## Boundaries

Set by the track owner, and they hold:

- The bridge is **read-only** toward Apex. It sends nothing and changes nothing.
- **COM3 is never opened.** GoKarts holds it exclusively; taking it stops live
  timing mid-race.
- **Firebird is never touched** — not its files, not its credentials.
- **Apex API authentication is never forged or bypassed** (ports 9120 / 9122).
- **DeHaardt, kart speed, loop power and the start lights are never automated.**
  Counting laps is observation; releasing karts is control, and control stays
  with a human.

`tools/gokarts-typist/` types pilot names into the GoKarts grid to save
re-keying. It waits for the operator to focus the window rather than seizing it,
sends only printable characters plus one navigation key, and aborts the moment
the foreground window changes. It presses no button; arming a session stays a
human action.

---

## Appendix — the vinext scaffold

Built on [vinext](https://github.com/cloudflare/vinext). Node `>=22.13.0`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite/vinext dev server |
| `npm run build` | deployable artifact |
| `npm run build:firebase` | static bundle for Firebase Hosting |
| `npm start` | serve the built app |
| `npm test` | build and verify preview metadata |
| `npm run db:generate` | Drizzle migrations after a schema change |

Site code lives under `app/`. `.openai/hosting.json` declares optional D1/R2
bindings and is imported by `vite.config.ts`, so it must stay committed — it
holds no secret. `db/schema.ts` is intentionally empty; `examples/d1/` has an
opt-in D1 surface. `.sites-runtime/` is disposable and ignored.

Firebase Hosting serves `dist/client` as a static SPA and **cannot execute
server code** (`worker/index.ts` never runs there) — which is why the API
belongs on Render.
