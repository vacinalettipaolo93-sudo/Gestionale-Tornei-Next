import React, { useEffect, useState } from "react";
import { saveEventChanges } from '../services/eventDataService';
import { type Event, type Tournament } from "../types";
import { PersistenceFeedback, usePersistenceAction, useSyncedDraft } from './usePersistenceAction';

interface RegolamentoGironiPanelProps {
  event: Event;
  tournament: Tournament;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
}

const RegolamentoGironiPanel: React.FC<RegolamentoGironiPanelProps> = ({
  event,
  tournament,
  setEvents,
}) => {
    const persistence = usePersistenceAction();
  const [selectedGroupId, setSelectedGroupId] = useState(tournament.groups[0]?.id ?? "");
  const selectedGroup = tournament.groups.find((g) => g.id === selectedGroupId);
  const [rulesText, setRulesText, baselineRules] = useSyncedDraft(selectedGroup?.rules, `${tournament.id}:${selectedGroupId}`);
  const loading = persistence.saving;
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    setSuccessMsg("");
  }, [selectedGroupId]);

  const handleChangeGroup = (groupId: string) => {
    setSelectedGroupId(groupId);
  };

  const handleSaveRules = async () => {
    await persistence.run(async () => {
      if (!selectedGroup) return;

      setSuccessMsg("");
      const updatedGroups = tournament.groups.map((g) =>
        g.id === selectedGroup.id ? { ...g, rules: rulesText ?? '' } : g
      );

      await saveEventChanges({
        ...event, tournaments: event.tournaments.map(t => t.id === tournament.id ? {
          ...t, groups: t.groups.map(g => g.id === selectedGroup.id ? { ...g, rules: baselineRules } : g),
        } : t),
      }, {
        tournaments: event.tournaments.map((t) =>
          t.id === tournament.id ? { ...t, groups: updatedGroups } : t
        ),
      });

      setSuccessMsg("Regolamento salvato per il girone!");
    });
  };

  if (!selectedGroup) return <React.Fragment><PersistenceFeedback persistence={persistence} />{null}</React.Fragment>;
  return <React.Fragment><PersistenceFeedback persistence={persistence} />{(
    <div className="mb-8 bg-secondary p-6 rounded-xl shadow-md">
      <h3 className="text-xl mb-4 font-bold text-accent">Regolamenti Gironi</h3>
      <div className="flex items-center gap-4 mb-4">
        <label className="font-semibold">Scegli Girone:</label>
        <select
          value={selectedGroupId}
          onChange={(e) => handleChangeGroup(e.target.value)}
          className="bg-tertiary rounded px-3 py-2 font-bold"
        >
          {tournament.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={rulesText ?? ''}
        onChange={(e) => setRulesText(e.target.value)}
        className="w-full rounded bg-primary border p-3 min-h-[120px] mb-3"
        placeholder="Scrivi qui il regolamento per il girone selezionato..."
        disabled={loading}
      />
      <button
        onClick={handleSaveRules}
        disabled={loading}
        className="bg-highlight text-white px-4 py-2 rounded font-bold"
      >
        {loading ? "Salvando..." : "Salva regolamento per girone"}
      </button>
      {successMsg && <div className="text-green-600 mt-3 font-semibold">{successMsg}</div>}
    </div>
  )}</React.Fragment>;
};

export default RegolamentoGironiPanel;
