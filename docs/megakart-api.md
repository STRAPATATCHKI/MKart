# MegaKart API — for the app's backend

Read-only HTTPS access to MegaKart Fès: revenue, payments, reservations, every race lap by
lap, and the race on track live. The venue PC pushes its data to Firebase; this API
(`tools/megakart-api/api.mjs`, served by the MKart service on Render) serves it behind one key.
It cannot write anything, and it cannot reach sign-ups, phone numbers, emails or signatures.

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
| Times | milliseconds since 1970, venue PC clock |
| `day` | the venue's local calendar day, `YYYY-MM-DD` |
| Missing | the field is absent or `null` |

Errors are JSON `{ "error": "…" }` with 400 (bad parameter), 401 (key), 404, 502 (Firebase
unreachable, retry).

## Endpoints

| GET | returns |
|---|---|
| `/v1/health` | `{ ok, venue, dataUpdatedAt }` — no key. `dataUpdatedAt` older than ~5 min means the venue PC is off |
| `/v1/today` | the day at a glance: `day, total, cash, card, payments, pilotsPaid, waiting, pilotsWaiting, estimated, unknown, updatedAt` |
| `/v1/days?from=&to=` | revenue per day, oldest first; without dates, the last 31 days with sales |
| `/v1/payments?day=` or `?from=&to=` | payments, newest first (default: today) |
| `/v1/reservations?day=` or `?from=&to=` | reservations of the last 30 days, newest first (default: today) |
| `/v1/races?day=` or `?from=&to=` | races, newest first (default: today); `&laps=0` drops the lap lists |
| `/v1/races/{raceId}` | one race, every lap |
| `/v1/live` | the race on track now (see below) |
| `/v1/live/stream` | the same, pushed as Server-Sent Events (`event: live`) whenever it changes |
| `/v1/track` | the circuit drawing |

Field-by-field descriptions of payments, days, reservations and races are in
`docs/firebase-reports.md` — the API returns those documents unchanged, as arrays.

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
{ "width": 704, "height": 268, "points": [{ "x": 91.8, "y": 191 }, …], "start": 13, "finish": 13 }
```

`points` is a closed loop in a 704 × 268 box, in driving order; `start` is the index of the
point where the timing line is. The venue PC only knows when a kart crosses the line, so
between crossings the position is estimated, exactly as the MegaKart dashboard does:

1. Clock offset, once per update: `offset = Date.now() - live.updatedAt` (your clock minus the venue's).
2. For each driver: `pace = lastLapMs ?? average of the others' lastLapMs ?? 35000`.
3. `fraction = min((Date.now() - offset - lastPassingAt) / pace, 0.97)` — never past the line
   before the real crossing arrives; the next update snaps the kart back to the line.
4. Walk the loop from `points[start]`, following the order of `points`, for `fraction` of its
   total length; that is where the kart is.
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
