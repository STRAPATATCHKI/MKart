// The client directory: everyone who has registered, and what they have done on track.
//
// Two sources, joined here and nowhere else:
//   - sign-ups (the bridge): who registered, their contact, the pilots they brought, the pack;
//   - saved races (Timing Control): who drove, in which kart, every lap.
//
// A sign-up and a race share no id - the chrono only knows the driver's name as it was typed at
// PREPARE - so the join is by name, normalised (case, accents, spacing). That is the honest
// limit of the data, and the page says so when two clients share a name rather than silently
// giving one of them the other's laps.

import type { Signup, SignupPlayer } from "@/lib/bridge-client";
import type { TimingSavedRace } from "@/lib/timing-client";

export type ClientSignup = {
  id: string;
  code: string;
  createdAt: string;
  /** True when this person filled the form; false when they were added as a pilot by someone. */
  registrant: boolean;
  /** Who filled the form, when it was not this person. */
  by: string | null;
  packLabel: string | null;
  packTotalMad: number | null;
  queueCode: string | null;
  pilots: number;
};

export type ClientRace = {
  raceId: string;
  raceName: string;
  /** Epoch ms; Timing Control saves seconds. */
  at: number | null;
  finished: boolean;
  position: number | null;
  field: number;
  kart: number;
  laps: number;
  bestLapMs: number | null;
  lapTimesMs: number[];
};

export type ClientRecord = {
  key: string;
  name: string;
  phone: string | null;
  email: string | null;
  age: number | null;
  color: number | null;
  signups: ClientSignup[];
  firstSeen: string;
  lastSeen: string;
  /** Newest first. */
  races: ClientRace[];
  totalLaps: number;
  bestLapMs: number | null;
  /** Other clients with the same name: their races cannot be told apart from this one's. */
  sameName: number;
};

/** "  Mohamed  ALAOUI " and "mohamed alaoui" are the same driver; "Méhdi" and "Mehdi" too. */
export function normName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

/** The last 9 digits: 0612345678, +212612345678 and 00212 6 12 34 56 78 are one phone. */
export function normPhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 6 ? digits.slice(-9) : null;
}

export function isSimulated(race: Pick<TimingSavedRace, "name">): boolean {
  return /^\s*\[sim\]/i.test(race.name ?? "");
}

type Person = { name: string; phone?: string | null; email?: string | null; age?: number | null; color?: number | null };

function players(signup: Signup): { person: Person; registrant: boolean }[] {
  const first: Person = { name: signup.name, phone: signup.phone, email: signup.email, age: signup.age, color: signup.color ?? null };
  const team = (signup.team ?? []) as SignupPlayer[];
  return [
    { person: first, registrant: true },
    ...team.filter((p) => p && p.name && p.name.trim()).map((p) => ({
      person: { name: p.name, phone: p.phone ?? null, email: p.email ?? null, age: p.age ?? null, color: p.color ?? null },
      registrant: false,
    })),
  ];
}

export function buildDirectory(signups: Signup[], races: TimingSavedRace[]): ClientRecord[] {
  const byKey = new Map<string, ClientRecord>();
  const keyByName = new Map<string, string>();       // so a name-only pilot joins a known phone

  for (const signup of signups) {
    for (const { person, registrant } of players(signup)) {
      const name = person.name.trim();
      if (!name) continue;
      const phone = normPhone(person.phone);
      const n = normName(name);
      // Same phone is the same person. Without a phone, fall back to the name - and if that
      // name already belongs to someone with a phone, it is most likely them.
      const key = phone ? `t:${phone}` : keyByName.get(n) ?? `n:${n}`;
      let rec = byKey.get(key);
      if (!rec) {
        rec = {
          key, name, phone: person.phone?.trim() || null, email: person.email?.trim() || null,
          age: person.age ?? null, color: person.color ?? null,
          signups: [], firstSeen: signup.createdAt, lastSeen: signup.createdAt,
          races: [], totalLaps: 0, bestLapMs: null, sameName: 0,
        };
        byKey.set(key, rec);
      }
      if (!keyByName.has(n)) keyByName.set(n, key);
      // Keep the freshest contact details, but never replace a known one with a blank.
      if (person.email?.trim()) rec.email = person.email.trim();
      if (person.phone?.trim()) rec.phone = person.phone.trim();
      if (person.age != null) rec.age = person.age;
      if (person.color != null) rec.color = person.color;
      if (signup.createdAt < rec.firstSeen) rec.firstSeen = signup.createdAt;
      if (signup.createdAt > rec.lastSeen) { rec.lastSeen = signup.createdAt; rec.name = name; }
      if (!rec.signups.some((s) => s.id === signup.id)) {
        rec.signups.push({
          id: signup.id, code: signup.code, createdAt: signup.createdAt, registrant,
          by: registrant ? null : signup.name,
          packLabel: signup.packLabel ?? null, packTotalMad: signup.packTotalMad ?? null,
          queueCode: signup.queueCode ?? null, pilots: 1 + (signup.team?.length ?? 0),
        });
      }
    }
  }

  const clients = [...byKey.values()];
  const byName = new Map<string, ClientRecord[]>();
  for (const c of clients) {
    const n = normName(c.name);
    byName.set(n, [...(byName.get(n) ?? []), c]);
  }
  for (const group of byName.values()) for (const c of group) c.sameName = group.length - 1;

  for (const race of races) {
    if (isSimulated(race)) continue;
    const field = race.racers.length;
    const t = race.finishedAt ?? race.startedAt ?? race.savedAt;
    for (const r of race.racers) {
      const matches = byName.get(normName(r.driver));
      if (!matches) continue;
      const entry: ClientRace = {
        raceId: race.raceId,
        raceName: race.name ?? race.raceId,
        at: t != null ? t * 1000 : null,
        finished: race.state === "FINISHED",
        position: r.position ?? null,
        field,
        kart: r.kart,
        laps: r.laps,
        bestLapMs: r.bestLapMs ?? null,
        lapTimesMs: Array.isArray(r.lapTimesMs) ? r.lapTimesMs : [],
      };
      for (const c of matches) c.races.push(entry);
    }
  }

  for (const c of clients) {
    c.races.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    c.signups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    c.totalLaps = c.races.reduce((n, r) => n + r.laps, 0);
    const bests = c.races.map((r) => r.bestLapMs).filter((v): v is number => v != null && v > 0);
    c.bestLapMs = bests.length ? Math.min(...bests) : null;
  }

  // Most recent first: the person the operator is looking for is usually today's.
  return clients.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export type ClientFilter = "tous" | "roule" | "attente";

export function filterClients(clients: ClientRecord[], filter: ClientFilter, query: string): ClientRecord[] {
  const q = normName(query);
  const digits = query.replace(/\D/g, "");
  return clients.filter((c) => {
    if (filter === "roule" && c.races.length === 0) return false;
    if (filter === "attente" && c.races.length > 0) return false;
    if (!q) return true;
    if (normName(c.name).includes(q)) return true;
    if (c.email && c.email.toLowerCase().includes(q)) return true;
    if (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits)) return true;
    return c.signups.some((s) => s.code.toLowerCase() === q || (s.queueCode ?? "").toLowerCase() === q);
  });
}
