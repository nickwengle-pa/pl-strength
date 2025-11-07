import React, { useEffect, useMemo, useState } from "react";
import {
  TEAM_DEFINITIONS,
  formatTeamLabel,
  getStoredTeamSelection,
  getTeamDefinition,
  loadAttendanceSheet,
  saveAttendanceSheet,
  type AttendanceSheet,
  type Team,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

const ALL_TEAMS: Team[] = TEAM_DEFINITIONS.map((definition) => definition.id as Team);
const DEFAULT_FOOTBALL_TEAMS: Team[] = TEAM_DEFINITIONS.filter(
  (definition) => definition.sport === "football" && definition.program === "coed"
).map((definition) => definition.id as Team);
const FALLBACK_TEAMS: Team[] =
  DEFAULT_FOOTBALL_TEAMS.length > 0 ? DEFAULT_FOOTBALL_TEAMS : ALL_TEAMS;

const createEmptySheet = (team: Team): AttendanceSheet => ({
  team,
  dates: [],
  athletes: [],
  records: {},
  updatedAt: undefined,
});

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const random = Math.random().toString(16).slice(2);
  return `ath-${Date.now().toString(16)}-${random}`;
};

const formatDateInput = (value: Date): string => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  const year = local.getFullYear();
  const month = `${local.getMonth() + 1}`.padStart(2, "0");
  const day = `${local.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const nextAvailableDate = (existing: string[]): string => {
  const today = new Date();
  for (let offset = 0; offset < 14; offset += 1) {
    const probe = new Date(today);
    probe.setDate(today.getDate() + offset);
    const candidate = formatDateInput(probe);
    if (!existing.includes(candidate)) {
      return candidate;
    }
  }
  return formatDateInput(today);
};

type TeamMap<T> = Record<Team, T>;

const buildTeamMap = <T,>(builder: (team: Team) => T): TeamMap<T> =>
  ALL_TEAMS.reduce((acc, team) => {
    acc[team] = builder(team);
    return acc;
  }, {} as TeamMap<T>);

const DEFAULT_TEAM: Team = FALLBACK_TEAMS[0] ?? ALL_TEAMS[0];

export default function Attendance() {
  const { loading: authLoading, isCoach } = useActiveAthlete();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<TeamMap<AttendanceSheet>>(() =>
    buildTeamMap((team) => createEmptySheet(team))
  );
  const [dirty, setDirty] = useState<TeamMap<boolean>>(() =>
    buildTeamMap(() => false)
  );
  const [saving, setSaving] = useState<TeamMap<boolean>>(() =>
    buildTeamMap(() => false)
  );
  const [teamErrors, setTeamErrors] = useState<TeamMap<string | null>>(() =>
    buildTeamMap(() => null)
  );
  const [selectedTeam, setSelectedTeam] = useState<Team>(DEFAULT_TEAM);
  const [flash, setFlash] = useState<string | null>(null);
  const [formDraft, setFormDraft] = useState<{
    firstName: string;
    lastName: string;
    level: Team;
  }>({ firstName: "", lastName: "", level: DEFAULT_TEAM });
  const [coachTeam, setCoachTeam] = useState<Team | null>(null);

  const visibleTeamDefs = useMemo(() => {
    if (coachTeam) {
      const definition = getTeamDefinition(coachTeam);
      if (definition) {
        return TEAM_DEFINITIONS.filter(
          (candidate) =>
            candidate.sport === definition.sport &&
            candidate.program === definition.program
        );
      }
    }
    return TEAM_DEFINITIONS.filter(
      (candidate) => candidate.sport === "football" && candidate.program === "coed"
    );
  }, [coachTeam]);

  const visibleTeams: Team[] = useMemo(() => {
    const mapped = visibleTeamDefs.map((definition) => definition.id as Team);
    return mapped.length > 0 ? mapped : FALLBACK_TEAMS;
  }, [visibleTeamDefs]);

  useEffect(() => {
    if (!visibleTeams.includes(selectedTeam)) {
      setSelectedTeam(visibleTeams[0]);
    }
  }, [visibleTeams, selectedTeam]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readTeam = () => {
      const stored = getStoredTeamSelection();
      setCoachTeam(stored || null);
    };
    readTeam();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pl-strength-team") {
        const normalized = getStoredTeamSelection();
        setCoachTeam(normalized || null);
      }
    };
    const handleCustom = (_event: Event) => readTeam();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pl-team-change", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pl-team-change", handleCustom);
    };
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isCoach) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const targets = visibleTeams.length > 0 ? visibleTeams : FALLBACK_TEAMS;
        const entries = await Promise.all(
          targets.map(async (team) => {
            const sheet = await loadAttendanceSheet(team);
            return [team, sheet] as const;
          })
        );
        setSheets((prev) => {
          const next = { ...prev };
          entries.forEach(([team, sheet]) => {
            next[team] = sheet;
          });
          return next;
        });
        setDirty((prev) => {
          const next = { ...prev };
          targets.forEach((team) => {
            next[team] = false;
          });
          return next;
        });
        setTeamErrors((prev) => {
          const next = { ...prev };
          targets.forEach((team) => {
            next[team] = null;
          });
          return next;
        });
      } catch (err: any) {
        const message = err?.message ?? "Could not load attendance sheets.";
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, isCoach, visibleTeams]);

  useEffect(() => {
    setFormDraft((prev) => ({
      ...prev,
      level: selectedTeam,
    }));
  }, [selectedTeam]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const selectedSheet = sheets[selectedTeam];
  const selectedError = teamErrors[selectedTeam];
  const selectedDirty = dirty[selectedTeam];
  const selectedSaving = saving[selectedTeam];

  const visibleAthletes = useMemo(
    () =>
      selectedSheet.athletes.filter((athlete) => athlete.level === selectedTeam),
    [selectedSheet, selectedTeam]
  );

  const handleSetError = (team: Team, message: string | null) => {
    setTeamErrors((prev) => ({
      ...prev,
      [team]: message,
    }));
  };

  const updateSheet = (team: Team, updater: (sheet: AttendanceSheet) => AttendanceSheet) => {
    setSheets((prev) => ({
      ...prev,
      [team]: updater(prev[team]),
    }));
    setDirty((prev) => ({
      ...prev,
      [team]: true,
    }));
  };

  const handleAddDate = (team: Team) => {
    const sheet = sheets[team];
    const newDate = nextAvailableDate(sheet.dates);
    updateSheet(team, (current) => {
      if (current.dates.includes(newDate)) {
        return current;
      }
      const nextDates = [...current.dates, newDate];
      const nextRecords = { ...current.records };
      current.athletes.forEach((athlete) => {
        const row = { ...(nextRecords[athlete.id] ?? {}) };
        row[newDate] = row[newDate] ?? false;
        nextRecords[athlete.id] = row;
      });
      return { ...current, dates: nextDates, records: nextRecords };
    });
    handleSetError(team, null);
  };

  const handleRemoveDate = (team: Team, date: string) => {
    updateSheet(team, (current) => {
      if (!current.dates.includes(date)) return current;
      const nextDates = current.dates.filter((d) => d !== date);
      const nextRecords: AttendanceSheet["records"] = {};
      Object.entries(current.records).forEach(([athleteId, row]) => {
        const nextRow = { ...row };
        delete nextRow[date];
        nextDates.forEach((d) => {
          if (!(d in nextRow)) nextRow[d] = false;
        });
        nextRecords[athleteId] = nextRow;
      });
      return { ...current, dates: nextDates, records: nextRecords };
    });
    handleSetError(team, null);
  };

  const handleDateChange = (team: Team, index: number, value: string) => {
    const next = value.trim();
    const currentDate = sheets[team].dates[index];
    if (!currentDate) return;
    if (!next) {
      handleRemoveDate(team, currentDate);
      return;
    }
    if (sheets[team].dates.some((date, idx) => date === next && idx !== index)) {
      handleSetError(team, "That date already exists on this sheet.");
      return;
    }
    updateSheet(team, (current) => {
      const nextDates = [...current.dates];
      nextDates[index] = next;
      const nextRecords: AttendanceSheet["records"] = {};
      Object.entries(current.records).forEach(([athleteId, row]) => {
        const existing = { ...row };
        if (existing[currentDate] !== undefined) {
          const valueForDate = existing[currentDate];
          delete existing[currentDate];
          existing[next] = valueForDate;
        } else if (!(next in existing)) {
          existing[next] = false;
        }
        nextRecords[athleteId] = existing;
      });
      return { ...current, dates: nextDates, records: nextRecords };
    });
    handleSetError(team, null);
  };

  const handleToggle = (team: Team, athleteId: string, date: string) => {
    updateSheet(team, (current) => {
      const nextRecords = { ...current.records };
      const row = { ...(nextRecords[athleteId] ?? {}) };
      row[date] = !row[date];
      nextRecords[athleteId] = row;
      return { ...current, records: nextRecords };
    });
  };

  const handleRemoveAthlete = (team: Team, athleteId: string) => {
    const confirmDelete = window.confirm("Remove this athlete from the sheet?");
    if (!confirmDelete) return;
    updateSheet(team, (current) => {
      const nextAthletes = current.athletes.filter((a) => a.id !== athleteId);
      const nextRecords = { ...current.records };
      delete nextRecords[athleteId];
      return { ...current, athletes: nextAthletes, records: nextRecords };
    });
    setFlash("Athlete removed from attendance.");
  };

  const handleAddAthlete = (event: React.FormEvent) => {
    event.preventDefault();
    const first = formDraft.firstName.trim();
    const last = formDraft.lastName.trim();
    const level = formDraft.level;
    if (!first && !last) {
      handleSetError(level, "Enter at least a first or last name.");
      return;
    }
    const id = createId();
    updateSheet(level, (current) => {
      const nextAthletes = [
        ...current.athletes,
        { id, firstName: first, lastName: last, level },
      ];
      const nextRecords = { ...current.records };
      const row: Record<string, boolean> = {};
      current.dates.forEach((date) => {
        row[date] = false;
      });
      nextRecords[id] = row;
      return { ...current, athletes: nextAthletes, records: nextRecords };
    });
    setFormDraft({ firstName: "", lastName: "", level: selectedTeam });
    setFlash(`Added ${first || last || "athlete"} to ${level}.`);
    handleSetError(level, null);
  };

  const handleSave = async (team: Team) => {
    setSaving((prev) => ({ ...prev, [team]: true }));
    handleSetError(team, null);
    try {
      await saveAttendanceSheet(sheets[team]);
      const fresh = await loadAttendanceSheet(team);
      setSheets((prev) => ({
        ...prev,
        [team]: fresh,
      }));
      setDirty((prev) => ({ ...prev, [team]: false }));
      setFlash(`Saved ${formatTeamLabel(team)} attendance.`);
    } catch (err: any) {
      const message =
        err?.message ?? "Could not save attendance. Try again shortly.";
      handleSetError(team, message);
    } finally {
      setSaving((prev) => ({ ...prev, [team]: false }));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container py-10">
        <div className="card text-center text-gray-600">Loading attendance�?�</div>
      </div>
    );
  }

  if (!isCoach) {
    return (
      <div className="container py-10">
        <div className="card space-y-3">
          <h2 className="text-xl font-semibold text-gray-800">Coach access required</h2>
          <p className="text-sm text-gray-600">
            Sign in with the coach passcode to manage attendance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Attendance</h1>
            <p className="text-sm text-gray-600">
              Track lift day attendance separately for each football team.
            </p>
          </div>
          <div className="flex gap-2">
            {visibleTeams.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => setSelectedTeam(team)}
                className={[
                  "rounded-xl px-4 py-2 text-sm font-medium transition",
                  selectedTeam === team
                    ? "bg-brand-600 text-white shadow-sm"
                    : "border border-gray-200 bg-white text-gray-700 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700",
                ].join(" ")}
              >
                {formatTeamLabel(team)}
              </button>
            ))}
          </div>
        </div>

        {loadError && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
            {loadError}
          </div>
        )}
        {flash && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
            {flash}
          </div>
        )}
        {selectedError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            {selectedError}
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800">
            {formatTeamLabel(selectedTeam)} attendance sheet
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleAddDate(selectedTeam)}
              disabled={selectedSaving}
            >
              Add date
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSave(selectedTeam)}
              disabled={!selectedDirty || selectedSaving}
            >
              {selectedSaving ? "Saving…" : "Save attendance"}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th className="w-48 px-3 py-2 text-left font-medium text-gray-700">
                  Athlete
                </th>
                {selectedSheet.dates.map((date, index) => (
                  <th key={date} className="px-2 py-2 text-center text-xs font-semibold text-gray-600">
                    <div className="flex flex-col items-center gap-1">
                      <input
                        type="date"
                        value={date}
                        onChange={(event) =>
                          handleDateChange(selectedTeam, index, event.target.value)
                        }
                        className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        className="text-xs text-rose-500 hover:text-rose-600"
                        onClick={() => handleRemoveDate(selectedTeam, date)}
                        disabled={selectedSaving}
                      >
                        Remove
                      </button>
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-gray-500 text-xs font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleAthletes.length === 0 ? (
                <tr>
                  <td
                    colSpan={selectedSheet.dates.length + 2}
                    className="px-3 py-5 text-center text-sm text-gray-500"
                  >
                    No athletes added yet. Use the form below to add someone.
                  </td>
                </tr>
              ) : (
                visibleAthletes.map((athlete) => (
                  <tr key={athlete.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">
                      {[athlete.firstName, athlete.lastName].filter(Boolean).join(" ")}
                    </td>
                    {selectedSheet.dates.map((date) => (
                      <td key={date} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          checked={Boolean(selectedSheet.records[athlete.id]?.[date])}
                          onChange={() => handleToggle(selectedTeam, athlete.id, date)}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        className="text-xs font-medium text-rose-500 hover:text-rose-600"
                        onClick={() => handleRemoveAthlete(selectedTeam, athlete.id)}
                        disabled={selectedSaving}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <form className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3" onSubmit={handleAddAthlete}>
          <h3 className="text-sm font-semibold text-gray-700">Add athlete to attendance</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col text-xs font-medium text-gray-600 gap-1">
              First name
              <input
                className="field"
                value={formDraft.firstName}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, firstName: event.target.value }))
                }
                placeholder="Jordan"
              />
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-600 gap-1">
              Last name
              <input
                className="field"
                value={formDraft.lastName}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, lastName: event.target.value }))
                }
                placeholder="Taylor"
              />
            </label>
          </div>
          <label className="flex flex-col text-xs font-medium text-gray-600 gap-1 md:w-48">
            Level
            <select
              className="field"
              value={formDraft.level}
              onChange={(event) =>
                setFormDraft((prev) => ({
                  ...prev,
                  level: event.target.value as Team,
                }))
              }
            >
              {visibleTeams.map((team) => (
                <option key={team} value={team}>
                  {formatTeamLabel(team)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end">
            <button type="submit" className="btn btn-primary">
              Add athlete
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
