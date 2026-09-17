# Venue ↔ Render sync contract

One endpoint, one direction of connection. The venue pushes; commands ride back on the
response. The venue never accepts an inbound connection, so no port forwarding, no firewall
exception, and nothing to keep alive behind the router.

```
POST {MEGAKART_CLOUD_URL}/api/venue/sync
Authorization: Bearer {MEGAKART_VENUE_TOKEN}
X-Venue-Id: fes
Content-Type: application/json
```

## Request

```json
{
  "venueId": "fes",
  "cursor": 1042,
  "events": [
    { "seq": 1043, "at": "2026-09-17T18:04:11.212Z", "kind": "chrono.result", "payload": { } },
    { "seq": 1044, "at": "2026-09-17T18:04:11.980Z", "kind": "reservation.created", "payload": { } }
  ]
}
```

- `cursor` — the highest sequence the venue believes Render has. Lets the server detect a gap.
- `events` — up to 200, always in ascending `seq`. May be empty: an empty push is how the
  venue collects commands when it has nothing to report.
- `seq` is **monotonic per venue and never reused.**

## Response

```json
{
  "acked": 1044,
  "commands": [
    { "id": "c-88", "verb": "chrono.start", "payload": { "sessionId": "MK-7" } }
  ]
}
```

- `acked` — highest sequence durably stored. The venue advances its cursor to this and prunes.
  **Only acknowledge what is on disk.** Acknowledging early is how a race disappears: the
  venue deletes its copy believing Render has it.
- `commands` — optional, max 50.

## Server rules

**Deduplicate on `(venueId, seq)`.** A retry after a timeout resends the same events with the
same sequences. Without dedup, every flaky connection creates duplicate races in the history.
This is also why the venue never regenerates ids per attempt.

**Never acknowledge beyond what is persisted.** If the disk write fails, return the previous
`acked`; the venue will resend. Over-acknowledging loses data permanently, under-acknowledging
costs one replay.

**Reject an unknown or mismatched token with 401/403.** The venue treats that as terminal,
backs off, and keeps its events rather than discarding them.

**Expect events out of wall-clock order across venues, never within one.** `at` is the venue's
clock and may drift; `seq` is authoritative for ordering.

## Event kinds

| kind | when | payload |
| --- | --- | --- |
| `chrono.started` | operator opens a race window | `{ sessionId, name, startedAt, minLapMs }` |
| `chrono.progress` | throttled during a race | `{ sessionId, rows, elapsedMs }` |
| `chrono.result` | race stopped and archived | the full archive entry, incl. `integrity` |
| `reservation.created` | a booking arrives | the reservation |
| `reservation.updated` | payment, status, kart assignment | the reservation |
| `session.archived` | a GoKarts-classified session ends | the archive entry |
| `venue.heartbeat` | every ~60 s | `{ bridgeConnected, feedConnected, chronoRunning }` |

`integrity` travels with a result and must be stored with it. A race counted across a feed
outage is marked incomplete **forever**, not just while it is on screen.

## Commands (allow-list)

The venue executes only these. Anything else is logged and ignored.

```
chrono.start   chrono.stop   chrono.reclassify
reservation.upsert   reservation.status
ping
```

**Nothing that touches kart power, speed, DeHaardt or the start lights is commandable, and
never will be.** That is a design boundary, not an omission — a compromised or spoofed server
must not be able to affect anything physical. The allow-list is enforced venue-side, so
adding a verb on the server alone does nothing.

## Read path for the dashboard

Render first, Firebase second — but only for **remote** viewing.

```
remote browser ──► Render (memory, disk-backed)  ──► Firebase Hosting (bundle only)
venue browser  ──► local bridge + desk                 ← never depends on the internet
```

On site the counter, the big screen and the chrono read the venue PC. An internet outage must
never stop a till mid-Saturday, so Render is a mirror for the venue and a source only for
people away from it.

## Render notes

- A service with a disk runs **one instance** — no zero-downtime deploys. Deploy between
  sessions, never during one.
- A **free instance spins down** and cold-starts; that is fatal for live timing on race days.
- **In-memory state dies on restart.** Append to the disk as events arrive and replay on boot,
  the same discipline the venue outbox uses.

## Secrets

`MEGAKART_VENUE_TOKEN` lives in Render's environment and in the venue agent's own `.env`.
Never in the repository, never in a log line, never behind a `VITE_` prefix — anything `VITE_`
is compiled into the JavaScript served to phones and is readable by anyone.

Rotate immediately if a token ever reaches a commit: git history is public forever once pushed.
