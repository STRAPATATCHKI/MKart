# MegaKart data in Firebase — for the manager's app

A backend that prefers plain HTTPS with an API key can use the MegaKart API instead
(`docs/megakart-api.md`); it serves these same documents.

The venue PC sends its revenue and races to the Realtime Database of the Firebase project
**mega-karts**, under `/reports`. An app reads them from there; it never talks to the PC.

- Database: `https://mega-karts-default-rtdb.asia-southeast1.firebasedatabase.app`
- Written by: the inscription bridge on the venue PC (`tools/apex-bridge/cloud-reports.mjs`),
  from the desk (waiting list, till) and MegaKart Timing Control (races).
- Read by: signed-in accounts listed under `/staff` only. Nobody can write from outside.

## Giving an account access

1. Firebase console → **Authentication** → Sign-in method: enable **Email/Password** (once).
2. Authentication → **Users** → *Add user* (email + password). Copy its **User UID**.
3. On the venue PC, double-click `tools\apex-bridge\acces-application.bat` and paste the UID.

To take access back: `node grant-app-access.mjs --remove <UID>` in `tools\apex-bridge`.

## Conventions

| | |
|---|---|
| Money | whole dirhams (DH) |
| Times | milliseconds since 1970 (`Date.now()` style) |
| `day` | the venue's local calendar day, `YYYY-MM-DD` |
| Missing value | the field is absent or `null` |

## What is where

### `/reports/today` — the day at a glance (updated within 30 s)

| field | meaning |
|---|---|
| `day` | today, `YYYY-MM-DD` |
| `total`, `cash`, `card` | revenue today, and its split by method |
| `payments` | number of payments taken today |
| `pilotsPaid` | pilots in those payments |
| `waiting`, `pilotsWaiting` | reservations made today still waiting to pay |
| `estimated`, `unknown` | payments whose amount is estimated / unknown (see below) |
| `updatedAt` | when the PC last changed this |

### `/reports/days/{YYYY-MM-DD}` — revenue per day (all days)

`day`, `total`, `cash`, `card`, `count` (payments), `pilots`, `estimated`, `unknown`.

### `/reports/payments/{code}` — every payment (all time)

| field | meaning |
|---|---|
| `code` | reservation code, e.g. `MK-6149` |
| `day`, `paidAt` | when it was cashed |
| `amount` | dirhams collected |
| `estimated` | `true` when the amount was not typed at the till but taken from the pack price (payments taken before the till asked for the amount) |
| `method` | `cash`, `card`, `mixed` (paid two ways) or `other`; `methodLabel` is the French label |
| `cash`, `card` | the part paid in cash and the part paid by card (both set when `mixed`; they add up to `amount`) |
| `by` | the cashier's initials |
| `pack` | the pack sold (the one corrected at the counter, if it was) |
| `pilots` | number of pilots |
| `contactName`, `channel`, `status` | who booked, `enligne` or `guichet`, current status |

A payment undone at the till, or a reservation deleted, disappears from here and from the day
totals within 30 s. `amount` is `null` when neither the till nor a pack gave one (counted in
`unknown`).

### `/reports/reservations/{code}` — reservations of the last 30 days

`code`, `clientCode` (the code the phone showed the client, e.g. `AZSM`), `status`
(`EN_ATTENTE`, `AU_GUICHET`, `PAYEE`, `EN_PISTE`, `TERMINEE`, `ABSENT`), `day`, `createdAt`,
`contactName`, `channel`, `pilots`, `pilotNames`, `pack`, `expectedAmount`, and once paid
`paidAt`, `paidAmount`, `method`. Cancelled and deleted reservations are not listed.

### `/reports/races/{raceId}` — every race Timing Control saved (all time)

| field | meaning |
|---|---|
| `raceId`, `name`, `state` | e.g. `20260924-003`, `SESSION 1`, `FINISHED` |
| `day`, `startedAt`, `finishedAt`, `durationS` | when, and the booked duration in seconds |
| `drivers`, `winner`, `bestLapMs`, `bestLapBy` | summary |
| `racers[]` | in finishing order: `position`, `driver`, `kart`, `laps`, `bestLapMs`, `lastLapMs`, `lapTimesMs[]` (every lap, lap 1 first) |

Test races named `[SIM] …` are not sent.

### `/reports/live` — the race on track (every 2 s while one runs)

`state` (`IDLE`, `PREPARED`, `RUNNING`, `FINISHED`), `updatedAt`, and while a race is prepared
or running: `raceId`, `name`, `startedAt`, `remainingMs`, `durationMs`, `clockStarted`,
`rankMode` (`course` = most laps wins, `chronos` = fastest lap wins), `trackLengthM`, and
`drivers[]` like `racers[]` above plus `grid`, `color` (pilot colour 1–8) and `lastPassingAt`
(when the kart last crossed the line). If `updatedAt` is old, the chrono or the PC is off.
How to animate the karts on the circuit from these: `docs/megakart-api.md`.

### `/reports/track` — the circuit

`width` 704, `height` 268, `points[]` (closed loop, driving order), `start` (index of the timing
line). The same drawing as the TV and the dashboard.

### `/reports/garage` — fuel and spare parts

`fuel/today` (updated within 30 s):

| field | meaning |
|---|---|
| `day` | today |
| `readingL`, `refillL`, `measuredAt` | the morning barrel reading, litres poured in since, and when it was measured |
| `stockL` | litres left now: reading + refills − everything burned since the reading (`null` before the reading) |
| `burnedSinceReadingL` | what was burned since the reading |
| `racesL`, `freeRunsL`, `totalL` | burned today by races, by karts going round outside a race (tests, warm-ups), in total |
| `capacityL`, `reserveL`, `low` | barrel size, alert level, and whether the stock is at or under it |
| `races[]` | `raceId`, `name`, `at`, `minutes`, `juniorKarts`, `gtKarts`, `litres` |
| `runs[]` | outside a race: `kart`, `transponder`, `start`, `end`, `passes`, `minutes`, `litres` |

`fuel/days/{YYYY-MM-DD}`: `racesL`, `freeRunsL`, `totalL`, `races` and `runs` (counts) for each day.

Fuel is counted from what the chrono saw: a race is its real length × each kart that did a lap;
a kart outside a race counts from its first pass to its last plus one lap; JUNIOR karts at the
junior rate, the others at the GT rate (both set on the venue's Garage page).

`parts`: `items[]` (`name`, `category`, `fits`, `unit`, `stock`, `minStock`, `low`, `unitPrice`),
`toReorder[]` (the parts at or under their minimum), `moves[]` (the last 100: `at`, `part`, `qty`,
`kind` `entree`/`sortie`, `kart`, `note`, `by`), `savedAt`.

### `/reports/meta`

`venue`, `version`, `updatedAt` — the PC writes at least every 5 minutes; an older value means
the venue PC or its bridge is off.

## Not in Firebase

Phone numbers, emails, signatures, birth dates and heights stay on the venue PC.

## Reading it (Firebase JS SDK)

```js
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getDatabase, ref, onValue, query, orderByChild, equalTo } from "firebase/database";

const app = initializeApp({ apiKey: "…", authDomain: "mega-karts.firebaseapp.com",
  databaseURL: "https://mega-karts-default-rtdb.asia-southeast1.firebasedatabase.app", projectId: "mega-karts" });
await signInWithEmailAndPassword(getAuth(app), email, password);
const db = getDatabase(app);

onValue(ref(db, "reports/today"), (s) => console.log(s.val()));            // live revenue
onValue(ref(db, "reports/live"), (s) => console.log(s.val()));             // live race
const day = query(ref(db, "reports/payments"), orderByChild("day"), equalTo("2026-09-24"));
onValue(day, (s) => console.log(s.val()));                                  // one day's payments
```

`payments`, `reservations` and `races` are indexed on `day` (and on `paidAt`, `createdAt`,
`startedAt`), so queries by day or by date range are fast.
