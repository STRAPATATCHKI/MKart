"use client";

// RECORD DE LA PISTE — on Statistiques: the official record the TV and the souvenirs show,
// editable here, with any saved lap that beat it offered for confirmation in one click.
// Confirmation stays a human decision: a lap can be "faster" because a transponder was carried
// past the loop, and only the venue knows which laps were real.

import { useState } from "react";
import { Check, Pencil, Trophy } from "lucide-react";
import { useTrackRecord } from "@/hooks/use-track-record";
import { useSavedRaces } from "@/hooks/use-saved-races";
import { fmtRecord, parseLap, recordCandidates } from "@/lib/track-record";

export function TrackRecordCard() {
  const { record, source, saving, error, save } = useTrackRecord(30_000);
  const { races } = useSavedRaces();
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState("");
  const [driver, setDriver] = useState("");
  const parsed = parseLap(time);
  const candidates = recordCandidates(races, record);

  const open = () => { setTime(fmtRecord(record.lapMs)); setDriver(record.driver ?? ""); setEditing(true); };
  const submit = async () => {
    if (parsed == null) return;
    if (await save({ lapMs: parsed, driver: driver.trim() || null })) setEditing(false);
  };
  const day = (ms: number | null) => (ms == null ? "" : new Date(ms).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }));

  return (
    <section className="tr-card" aria-label="Record de la piste">
      <div className="tr-main">
        <span className="tr-kicker"><Trophy size={15} /> RECORD DE LA PISTE</span>
        <strong>{fmtRecord(record.lapMs)}</strong>
        <small>
          {record.driver ?? "Détenteur non renseigné"}
          {record.setAt ? ` · depuis le ${new Date(record.setAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })}` : ""}
        </small>
        <p className="tr-note">
          Affiché sur l’écran TV et dans les souvenirs QR.
          {source === "default" ? " Valeur de départ : pas encore enregistrée sur le poste d’accueil." : ""}
        </p>
        {!editing && <button type="button" className="secondary-button" onClick={open}><Pencil size={14} /> Modifier le record</button>}
      </div>

      {editing && (
        <form className="tr-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <label><span>Temps</span>
            <input className={"cat-in" + (time && parsed == null ? " is-bad" : "")} value={time} onChange={(e) => setTime(e.target.value)}
              placeholder="23.594" inputMode="decimal" autoFocus />
            {time && parsed == null && <small className="cat-err">Un temps de tour, ex. 23.594 ou 1:02.300</small>}
          </label>
          <label><span>Détenteur <em>(facultatif)</em></span>
            <input className="cat-in" value={driver} maxLength={40} onChange={(e) => setDriver(e.target.value)} placeholder="Nom du pilote" />
          </label>
          <div className="tr-actions">
            <button type="button" className="secondary-button" onClick={() => setEditing(false)}>Annuler</button>
            <button type="submit" className="primary-button" disabled={parsed == null || saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
          </div>
        </form>
      )}

      {candidates.length > 0 && (
        <div className="tr-candidates">
          <h3>Tours plus rapides que le record</h3>
          <p className="tr-note">À valider seulement si le tour est réel (un transpondeur passé à la main peut sembler rapide).</p>
          <ul>
            {candidates.map((c) => (
              <li key={`${c.driver}-${c.lapMs}-${c.at}`}>
                <span><b>{fmtRecord(c.lapMs)}</b> {c.driver} · kart {c.kart} · {c.raceName}{c.at ? ` · ${day(c.at)}` : ""}</span>
                <button type="button" className="primary-button" disabled={saving}
                  onClick={() => void save({ lapMs: c.lapMs, driver: c.driver })}><Check size={14} /> Valider comme record</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="cat-err tr-error">{error}</p>}
    </section>
  );
}
