# MegaKart API — for the app's backend

HTTPS access to MegaKart Fès: revenue, payments, reservations, every race lap by lap, the race
on track live, and the décaissements waiting for approval. The venue PC pushes its data to Firebase; this API
(`tools/megakart-api/api.mjs`, served by the MKart service on Render) serves it behind one key.
It writes one thing only - the manager's answer to a décaissement - and it cannot reach sign-ups,
phone numbers, emails or signatures.

## Settings for your service

| variable | value |
|---|---|
| `MEGAKART_API_URL` | `https://mkart-7c44.onrender.com` (no trailing slash) |
| `MEGAKART_API_KEY` | the key MegaKart gives you (43 characters) |

Every call except `/v1/health` needs the key:

```
Authorization: Bearer <MEGAKART_API_KEY>
```

(`x-api-key: <key>` works too.) Server-to-server only: never ship the key in a browser or
mobile app bundle.

## Conventions

| | |
|---|---|
| Money | whole dirhams (DH) |
| Times | milliseconds since 1970, venue PC clock. Show them in the venue's time zone, **`Africa/Casablanca`** (not the server's or the phone's) |
| `day` | the venue's local calendar day, `YYYY-MM-DD` |
| Missing | the field is absent or `null` |

Errors are JSON `{ "error": "…" }` with 400 (bad parameter), 401 (key), 404, 502 (Firebase
unreachable, retry).

## Endpoints

| GET | returns |
|---|---|
| `/v1/health` | `{ ok, venue, dataUpdatedAt, pcOnline, pcAgeSeconds, timeZone }` — no key. **`pcOnline`** says whether the venue PC is sending (its heartbeat arrives every minute; online while under 6 min old) |
| `/v1/today` | the day at a glance: `day, total, cash, card, payments, pilotsPaid, waiting, pilotsWaiting, estimated, unknown, updatedAt`, plus `pcOnline`, `pcSeenAt`, `pcAgeSeconds`, `timeZone`. `updatedAt` is when the **figures** last changed (still for hours on a quiet night): to show whether the PC is on, use `pcOnline` |
| `/v1/days?from=&to=` | revenue per day, oldest first; without dates, the last 31 days with sales |
| `/v1/payments?day=` or `?from=&to=` | payments, newest first (default: today) |
| `/v1/reservations?day=` or `?from=&to=` | reservations of the last 30 days, newest first (default: today) |
| `/v1/races?day=` or `?from=&to=` | races, newest first (default: today); `&laps=0` drops the lap lists |
| `/v1/races/{raceId}` | one race, every lap |
| `/v1/live` | the race on track now (see below) |
| `/v1/live/stream` | the same, pushed as Server-Sent Events (`event: live`) whenever it changes |
| `/v1/track` | the circuit drawing |
| `/v1/reports/day.pdf?day=` | **the day report as a PDF file to download** (default: today): every race of the day with its pilots and laps, set against the day's payments — see below |
| `/v1/reports/day?day=` | the same report as JSON, for an app that draws it itself |
| `/v1/reports/day.html?day=` | the same report as a printable page |
| `/v1/disbursements?status=&day=` | décaissements, newest first, each with its whole history — see below |
| `/v1/disbursements/{id}` | one décaissement (by its id, or its code `DC-0007`) |
| `/v1/disbursements/{id}/attachments/{photo id}` | a photo joined to it (the image itself) |
| **POST** `/v1/disbursements/{id}/decision` | **approve or refuse** a décaissement — see below |
| `/v1/garage` | fuel and spare parts: `fuel.today` (reading, stock left, barrel level `levelPct`, autonomy `hoursLeft`/`sessionsLeft`, burned by races and by karts going round outside a race, each race and run), `fuel.days`, `parts` (stock, to reorder, last 100 movements) |

Field-by-field descriptions of payments, days, reservations and races are in
`docs/firebase-reports.md` — the API returns those documents unchanged, as arrays.

## The day report (races against payments)

`GET /v1/reports/day.pdf?day=2026-09-26` answers `application/pdf` with
`Content-Disposition: attachment; filename="MegaKart-rapport-2026-09-26.pdf"` — A4, black and
red, the same report the venue prints from Sessions → Courses terminées → « Rapport du jour ».
Without `day`, today at the venue. The key is required, as for everything else: have your
backend fetch it and hand the file to the app (never put the key in the app).

`GET /v1/reports/day?day=…` returns the report itself:

| field | meaning |
|---|---|
| `totals` | `races`, `tests` (races named TEST, set apart), `driverRaces` (times a pilot went on track), `pilots`, `covered` (paid), `extra` (raced more times than paid for), `booked` (booked, never cashed), `check` (first name only or a close name: check by hand), `none` (nobody of that name paid), `revenue` (DH cashed that day), `racePrice` and `missingDh` (uncovered × one race's price), `underpaid` / `underpaidDh` (payments under their pack's price) |
| `uncovered[]` | every time on track that no payment covers: `raceName`, `at`, `driver`, `kart`, `laps`, `bestLapMs`, `coverage` (`extra`, `booked`, `check`, `none`), `reservation`, `suggestions[]` |
| `payments[]` | each payment of the day: `code`, `clientCode`, `paidAt`, `amount`, `method`, `pack`, `packPrice`, `perPilot` (races per pilot), `allowanceFrom`, `pilots[]` (`name`, `races` done), `racesCovered`, `racesExtra` |
| `paidNoRace[]` | paid that day, but none of its pilots raced |
| `races[]` | every race in time order: `raceId`, `name`, `startedAt`, `finishedAt`, `test`, `entries[]` (`position` by best lap, `driver`, `kart`, `laps`, `bestLapMs`, `lapTimesMs[]`, `coverage`, `reservation`) |

Pilots are matched to payments by name, ignoring accents, case and small typing slips; a pack
bought on another day is not counted, and reservations are kept 30 days (older days show races
only).

## Décaissements (money out, approved from the app)

The desk asks for money to go out (fuel, a part, a supplier, an advance); the manager approves
or refuses it from the app; the desk hands the money out only once approved. Nothing leaves
the till without an answer.

`GET /v1/disbursements?status=EN_ATTENTE` — the ones waiting for an answer (poll every 15–30 s,
or show a badge). Each one:

| field | meaning |
|---|---|
| `id`, `code` | identifier, and the code people read (`DC-0007`) |
| `amount` | dirhams |
| `category`, `categoryLabel` | `carburant`, `pieces`, `fournitures`, `fournisseur`, `personnel`, `marketing`, `loyer`, `autre` |
| `description` | what it is for, as typed at the desk |
| `beneficiary` | who receives the money (person or supplier) |
| `method`, `methodLabel` | always `especes` — every décaissement is cash taken from the till |
| `reference` | invoice or reference number, or null |
| `urgent` | the desk marked it urgent: show it first |
| `requestedBy`, `createdAt`, `day` | who asked, when |
| `status`, `statusLabel` | `EN_ATTENTE` (waiting for the app), `APPROUVE`, `REFUSE`, `ANNULE` (withdrawn at the desk), `DECAISSE` (money handed out) |
| `decision` | once decided: `decision` (`approve`/`refuse`), `by`, `at`, `comment`, `via` |
| `paidOutAt`, `paidOutBy` | when and by whom the money was handed out |
| `attachments[]` | photos joined at the desk (ticket, invoice, screenshot): `id`, `type`, `size`, `addedAt`, `path` — fetch the image itself at `path` (`GET /v1/disbursements/{id}/attachments/{photo id}`, same key, answers the JPEG/PNG) |
| `history[]` | every step, oldest first: `at`, `event` (`cree`, `piece` photo added, `approuve`, `refuse`, `annule`, `decaisse`), `label`, `by`, `via` (`accueil` or `application`), `note` |

**Deciding:**

```
POST /v1/disbursements/DC-0007/decision
Authorization: Bearer <MEGAKART_API_KEY>
Content-Type: application/json

{ "decision": "approve", "by": "Karim Benali", "comment": "OK, garder la facture" }
{ "decision": "refuse",  "by": "Karim Benali", "comment": "Pas de facture, redemander demain" }
```

- `decision`: `approve` or `refuse`. `by`: the name of the person deciding (required).
  `comment`: optional to approve, **required to refuse** (the desk shows it).
- `202` `{ status: "ENVOYEE", id, code, decision, pcOnline, message }`: the decision is on its way to
  the venue PC, which applies it within ~5 s when it is on (later, as soon as it is switched on,
  when it is not — `pcOnline` says which). Read the décaissement again to see its new `status`
  and `history`.
- `409`: already decided, withdrawn, or a decision is already on its way — `disbursement` gives
  its current state. `404`: unknown. `400`: see `error`.

A decision cannot be changed once applied: the history keeps who decided, when and why.

## Following a race live

`/v1/live` changes every 2 s while a race is prepared or running:

```json
{
  "state": "RUNNING", "raceId": "20260924-009", "name": "SESSION 3",
  "startedAt": 1790280012000, "remainingMs": 88000, "durationMs": 480000,
  "clockStarted": true, "rankMode": "course", "trackLengthM": 300, "updatedAt": 1790280404000,
  "drivers": [
    { "position": 1, "grid": 2, "driver": "Saad Bahja", "kart": 3, "color": 3, "laps": 11,
      "lastLapMs": 27414, "bestLapMs": 27414, "lastPassingAt": 1790280398000, "lapTimesMs": [28085, 27414] }
  ]
}
```

- `state`: `IDLE` (nothing else sent), `PREPARED` (on the grid), `RUNNING`, `FINISHED`.
- `clockStarted: false` while `RUNNING` means armed: the clock starts at the first crossing.
- `rankMode`: `course` = most laps wins; `chronos` = fastest lap wins.
- `color`: the pilot colour 1–8 — 1 `#8b5cf6`, 2 `#f5d90a`, 3 `#f97316`, 4 `#45c74a`,
  5 `#3a4048`, 6 `#2b7de9`, 7 `#e23b3b`, 8 `#e9eef4`.
- Speed on a lap: `trackLengthM / (lapMs / 1000) * 3.6` km/h.

Prefer `/v1/live/stream` (one connection, pushed on change) over polling; if you poll, every
2 s is enough — the data does not change faster.

## Drawing the karts on the circuit

`/v1/track`:

```json
{ "width": 704, "height": 268, "points": [{ "x": 91.8, "y": 191 }, …], "start": 13, "finish": 13,
  "path": "M 408 201 L 354 178 … Z", "lengthPx": 1564.2, "drawn": true, "savedAt": 1790280000000 }
```

`points` is a closed loop in a 704 × 268 box, in driving order; `start` is the index of the
point where the timing line is. `path` is the same circuit ready to draw: put it in an SVG
`<path d="…">` inside `viewBox="0 0 704 268"` and it is exactly the dashboard's line — straight
segments, starting at the timing line, closed. `drawn: false` means nobody has saved the real
circuit yet and this is a placeholder shape. **`docs/track-reference.html`** is a self-contained
page that draws the circuit the way the dashboard does (colours, widths, the start/finish line,
the karts) and animates karts with the steps below: open it in a browser, copy what you need.

The venue PC only knows when a kart crosses the line, so between crossings the position is
estimated, exactly as the MegaKart dashboard does:

1. Clock offset, once per update: `offset = Date.now() - live.updatedAt` (your clock minus the venue's).
2. For each driver: `pace = lastLapMs ?? average of the others' lastLapMs ?? 35000`.
3. `fraction = min((Date.now() - offset - lastPassingAt) / pace, 0.97)` — never past the line
   before the real crossing arrives; the next update snaps the kart back to the line.
4. Walk the loop from `points[start]`, following the order of `points`, for `fraction` of its
   total length; that is where the kart is. With the SVG path: `path.getPointAtLength(fraction * lengthPx)`.
5. Before the start (`lastPassingAt` null), line karts up behind the line in `grid` order.

## Where it runs

The MKart web service on Render (`https://mkart-7c44.onrender.com`) is the API and nothing
else: it serves `/v1` only — no dashboard, no other route (the dashboard runs on the venue PC).
`/` answers `{ "service": "MegaKart API", "health": "/v1/health" }`; anything else outside `/v1`
is a JSON 404. It needs these two environment variables:

| variable | value |
|---|---|
| `MEGAKART_API_KEY` | the key in `tools/megakart-api/api-key.txt` on the venue PC |
| `FIREBASE_SERVICE_ACCOUNT` | the whole contents of `ignore.json` on the venue PC |

Without them `/v1/health` answers 503 and says which one is missing; the rest of MKart is
unaffected. To change the key: generate a new one and update MKart and the backend.
`node tools/megakart-api/server.mjs` runs the same API on its own, for another host.
