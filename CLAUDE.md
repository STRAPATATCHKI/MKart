# MegaKart Fès — working rules

## Testing is Youssef's, not Claude's

**Never spawn agents or workflows to test. Never run background tasks, servers, or automated
browser checks. Youssef tests everything himself, in the real app.**

This overrides any default that says to fan out agents or verify with a workflow — including
ultracode. It applies to testing specifically: no subagent test passes, no headless Chrome
walkthroughs, no spun-up preview servers, no `run_in_background`.

What Claude may still run: quick foreground checks that finish on their own and touch nothing
live — syntax checks, `tsc --noEmit`, `python -m unittest`, `node --test`.

Why: this is a business running on this software. Two things went wrong on 2026-09-22 that led
to this rule. Claude restarted `bridge.mjs` from inside its session, which made a production
venue service a child of the conversation — it would have stopped when the session ended,
taking the public inscription form down with it. And repeated headless-browser runs spun
servers and browsers at the live desk while clients were being registered on it.

How to work instead: make the change, run the quick foreground checks, then say plainly what is
verified and what is not, and hand it over. Never report something as working because it should
be — say it is untested. If a long-running process is genuinely needed, write a `.bat` or a
shortcut so Youssef starts it himself.

## Ask before touching anything already running

The venue runs these, and Claude does not restart, stop or reconfigure them without asking:

| service | port | what it is |
|---|---|---|
| `bridge.mjs` | 8787 | serves the inscription form, hands sign-ups to the desk |
| `desk.mjs` | 8788 | reservations + queue API, and the dashboard itself |
| MegaKart Timing Control | 8795 | the Python chrono app; owns COM3 |

A restart is only ever safe when Youssef has said so. Note the desk API answers
`403 réservé au poste d'accueil` to anything that is not localhost — that is deliberate, since
it holds clients' names and phone numbers.

## Two more things that have bitten

`tools/apex-bridge/signup-page.mjs` is one big JS template literal: every backslash must be
doubled or the browser never sees it. `/\S+\s+\S/` once shipped as `/S+s+S/` and rejected every
real name. In the same file, `var` values (`PACKS`, `I18N`) hoist the name but not the value, so
anything read during boot must be declared above its first use.

The dashboard's circuit layout lives in `localStorage`, which is per-origin — `127.0.0.1:5190`
and `192.168.100.44:8788` each keep their own. A different track shape between two URLs is that,
not a stale build.
