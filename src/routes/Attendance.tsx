import React, { useEffect, useMemo, useState } from "react";
import {
  TEAM_DEFINITIONS,
  formatTeamLabel,
  getStoredTeamSelection,
  getTeamDefinition,
  loadAttendanceSheet,
  saveAttendanceSheet,
  fetchAthleteSessions,
  listRoster,
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

const formatLastWorkout = (timestamp?: number): { text: string; isRecent: boolean } => {
  if (!timestamp) return { text: "—", isRecent: false };
  
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;
  const diff = now - timestamp;
  
  // Today
  if (diff < dayInMs) {
    return { text: "Today", isRecent: true };
  }
  
  // Yesterday
  if (diff < 2 * dayInMs) {
    return { text: "Yesterday", isRecent: true };
  }
  
  // Within last 7 days
  if (diff < 7 * dayInMs) {
    const daysAgo = Math.floor(diff / dayInMs);
    return { text: `${daysAgo}d Ago`, isRecent: true };
  }
  
  // Older - show date
  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return { text: `${month}/${day}`, isRecent: false };
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
  const [lastWorkoutDates, setLastWorkoutDates] = useState<Record<string, number>>({});
  const [sortField, setSortField] = useState<'firstName' | 'lastName' | 'number' | 'grade' | 'lastWorkout'>('lastName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

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
        const message = err?.message ?? "Could Not Load Attendance Sheets.";
        setLoadError(message);
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, isCoach, visibleTeams]);

  // Load last workout dates for all athletes
  useEffect(() => {
    if (authLoading || !isCoach) return;
    
    (async () => {
      try {
        const roster = await listRoster();
        const workoutDates: Record<string, number> = {};
        
        // Fetch last session for each athlete
        await Promise.all(
          roster.map(async (athlete) => {
            try {
              const sessions = await fetchAthleteSessions(
                athlete.uid,
                12,
                selectedTeam
              );
              if (sessions.length > 0) {
                // Get most recent session date
                const lastSession = sessions.reduce((latest, session) => 
                  (session.createdAt || 0) > (latest.createdAt || 0) ? session : latest
                );
                workoutDates[athlete.uid] = lastSession.createdAt || 0;
              }
            } catch (err) {
              // Silently skip athletes we can't load
              console.debug(`Could Not Load Sessions For ${athlete.uid}`);
            }
          })
        );
        
        setLastWorkoutDates(workoutDates);
      } catch (err) {
        console.debug('Could Not Load Workout Dates', err);
      }
    })();
  }, [authLoading, isCoach, visibleTeams, selectedTeam]);

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

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const visibleAthletes = useMemo(() => {
    const filtered = selectedSheet.athletes.filter((athlete) => athlete.level === selectedTeam);

    return [...filtered].sort((a, b) => {
      let aVal: string | number | undefined;
      let bVal: string | number | undefined;

      switch (sortField) {
        case 'firstName':
          aVal = (a.firstName || '').toLowerCase();
          bVal = (b.firstName || '').toLowerCase();
          break;
        case 'lastName':
          aVal = (a.lastName || '').toLowerCase();
          bVal = (b.lastName || '').toLowerCase();
          break;
        case 'number':
          aVal = a.number ? parseInt(a.number) : 9999;
          bVal = b.number ? parseInt(b.number) : 9999;
          break;
        case 'grade':
          aVal = a.grade ? parseInt(a.grade) : 9999;
          bVal = b.grade ? parseInt(b.grade) : 9999;
          break;
        case 'lastWorkout':
          aVal = lastWorkoutDates[a.id] || 0;
          bVal = lastWorkoutDates[b.id] || 0;
          break;
      }

      if (aVal === bVal) return 0;

      const comparison = aVal! < bVal! ? -1 : 1;
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [selectedSheet, selectedTeam, sortField, sortDirection, lastWorkoutDates]);

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
      handleSetError(team, "That Date Already Exists On This Sheet.");
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
    const confirmDelete = window.confirm("Remove This Athlete From The Sheet?");
    if (!confirmDelete) return;
    updateSheet(team, (current) => {
      const nextAthletes = current.athletes.filter((a) => a.id !== athleteId);
      const nextRecords = { ...current.records };
      delete nextRecords[athleteId];
      return { ...current, athletes: nextAthletes, records: nextRecords };
    });
    setFlash("Athlete Removed From Attendance.");
  };

  const handleAddAthlete = (event: React.FormEvent) => {
    event.preventDefault();
    const first = formDraft.firstName.trim();
    const last = formDraft.lastName.trim();
    const level = formDraft.level;
    if (!first && !last) {
      handleSetError(level, "Enter At Least A First Or Last Name.");
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
    setFlash(`Added ${first || last || "Athlete"} To ${level}.`);
    handleSetError(level, null);
  };

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(line => line.trim());

        // Skip header if it looks like a header row
        const startIndex = lines[0]?.toLowerCase().match(/first|last|name|level|team|number|grade|height|weight|position|letter/) ? 1 : 0;

        type AthleteImport = {
          id: string;
          firstName: string;
          lastName: string;
          level: Team;
          number?: string;
          grade?: string;
          height?: string;
          weight?: string;
          position?: string;
          letter?: string;
        };

        const athletesByLevel: Record<Team, AthleteImport[]> = {} as any;
        const errors: string[] = [];

        for (let i = startIndex; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          // Support both comma and tab separated
          const parts = line.includes('\t')
            ? line.split('\t').map(p => p.trim())
            : line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));

          if (parts.length < 2) {
            errors.push(`Line ${i + 1}: Need At Least First And Last Name`);
            continue;
          }

          // Parse fields: NUMBER, FIRSTNAME, LASTNAME, GRADE, TEAM, HEIGHT, WEIGHT, POSITION, LETTER
          const [
            number,
            firstName,
            lastName,
            grade,
            levelStr,
            height,
            weight,
            position,
            letter
          ] = parts;

          if (!firstName || !lastName) {
            errors.push(`Line ${i + 1}: Missing Name`);
            continue;
          }

          // Determine level
          let level: Team = selectedTeam;
          if (levelStr) {
            const normalized = levelStr.toLowerCase().trim();
            const matchedTeam = visibleTeams.find(t =>
              t.toLowerCase() === normalized ||
              formatTeamLabel(t).toLowerCase() === normalized
            );
            if (matchedTeam) {
              level = matchedTeam;
            }
          }

          const id = createId();
          if (!athletesByLevel[level]) athletesByLevel[level] = [];

          // Build athlete object, only including optional fields that have values
          const athlete: AthleteImport = {
            id,
            firstName,
            lastName,
            level,
          };
          if (number) athlete.number = number;
          if (grade) athlete.grade = grade;
          if (height) athlete.height = height;
          if (weight) athlete.weight = weight;
          if (position) athlete.position = position;
          if (letter) athlete.letter = letter;

          athletesByLevel[level].push(athlete);
        }
        
        const totalCount = Object.values(athletesByLevel).reduce((sum, arr) => sum + arr.length, 0);

        if (totalCount === 0) {
          setFlash(errors.length > 0 ? errors.join('; ') : 'No Valid Athletes Found In CSV');
          event.target.value = '';
          return;
        }

        // Add or update athletes in sheets
        let totalNew = 0;
        let totalUpdated = 0;

        Object.entries(athletesByLevel).forEach(([levelKey, athletes]) => {
          const level = levelKey as Team;
          updateSheet(level, (current) => {
            const nextAthletes = [...current.athletes];
            const nextRecords = { ...current.records };

            athletes.forEach(importedAthlete => {
              // Check if athlete already exists (match by firstName, lastName, and level)
              const existingIndex = nextAthletes.findIndex(
                a => a.firstName.toLowerCase() === importedAthlete.firstName.toLowerCase() &&
                     a.lastName.toLowerCase() === importedAthlete.lastName.toLowerCase() &&
                     a.level === importedAthlete.level
              );

              if (existingIndex >= 0) {
                // Update existing athlete's data (only include fields with values)
                const updates: Partial<typeof importedAthlete> = {};
                if (importedAthlete.number) updates.number = importedAthlete.number;
                if (importedAthlete.grade) updates.grade = importedAthlete.grade;
                if (importedAthlete.height) updates.height = importedAthlete.height;
                if (importedAthlete.weight) updates.weight = importedAthlete.weight;
                if (importedAthlete.position) updates.position = importedAthlete.position;
                if (importedAthlete.letter) updates.letter = importedAthlete.letter;

                nextAthletes[existingIndex] = {
                  ...nextAthletes[existingIndex],
                  ...updates,
                };
                totalUpdated++;
              } else {
                // Add new athlete
                nextAthletes.push(importedAthlete);

                // Initialize attendance records for new athlete
                const row: Record<string, boolean> = {};
                current.dates.forEach((date) => {
                  row[date] = false;
                });
                nextRecords[importedAthlete.id] = row;
                totalNew++;
              }
            });

            return { ...current, athletes: nextAthletes, records: nextRecords };
          });
        });

        const summary = Object.entries(athletesByLevel)
          .map(([level, athletes]) => `${athletes.length} to ${formatTeamLabel(level as Team)}`)
          .join(', ');

        const statusMsg = totalNew > 0 && totalUpdated > 0
          ? `${totalNew} New, ${totalUpdated} Updated`
          : totalNew > 0
          ? `${totalNew} New`
          : `${totalUpdated} Updated`;

        setFlash(`Imported ${totalCount} Athletes (${statusMsg}): ${summary}${errors.length > 0 ? `. ${errors.length} Errors` : ''}`);
        
      } catch (err: any) {
        setFlash(`CSV Import Error: ${err.message}`);
      }
      
      event.target.value = '';
    };
    
    reader.onerror = () => {
      setFlash('Failed To Read File');
      event.target.value = '';
    };
    
    reader.readAsText(file);
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
      setFlash(`Saved ${formatTeamLabel(team)} Attendance.`);
    } catch (err: any) {
      const message =
        err?.message ?? "Could Not Save Attendance. Try Again Shortly.";
      handleSetError(team, message);
    } finally {
      setSaving((prev) => ({ ...prev, [team]: false }));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="container py-10">
        <div className="card text-center text-gray-600">Loading Attendance…</div>
      </div>
    );
  }

  if (!isCoach) {
    return (
      <div className="container py-10">
        <div className="card space-y-3">
          <h2 className="text-xl font-semibold text-gray-800">Coach Access Required</h2>
          <p className="text-sm text-gray-600">
            Sign In With The Coach Passcode To Manage Attendance.
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
              Track Lift Day Attendance Separately For Each Football Team.
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
            {formatTeamLabel(selectedTeam)} Attendance Sheet
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleAddDate(selectedTeam)}
              disabled={selectedSaving}
            >
              Add Date
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleSave(selectedTeam)}
              disabled={!selectedDirty || selectedSaving}
            >
              {selectedSaving ? "Saving…" : "Save Attendance"}
            </button>
          </div>
        </div>

        {/* Unsaved changes reminder */}
        {selectedDirty && !selectedSaving && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-amber-600 text-lg">⚠️</span>
              <span className="text-sm font-medium text-amber-800">
                You Have Unsaved Changes. Don't Forget To Click "Save Attendance" Before Leaving!
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary text-sm px-3 py-1"
              onClick={() => handleSave(selectedTeam)}
            >
              Save Now
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th
                  className="w-48 px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('firstName')}
                >
                  <div className="flex items-center gap-1">
                    First Name
                    {sortField === 'firstName' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="w-32 px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('lastName')}
                >
                  <div className="flex items-center gap-1">
                    Last Name
                    {sortField === 'lastName' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="w-20 px-3 py-2 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('number')}
                >
                  <div className="flex items-center gap-1">
                    #
                    {sortField === 'number' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="w-20 px-3 py-2 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('grade')}
                >
                  <div className="flex items-center gap-1">
                    Grade
                    {sortField === 'grade' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="w-32 px-3 py-2 text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('lastWorkout')}
                >
                  <div className="flex items-center gap-1">
                    Last Workout
                    {sortField === 'lastWorkout' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
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
                    colSpan={selectedSheet.dates.length + 6}
                    className="px-3 py-5 text-center text-sm text-gray-500"
                  >
                    No Athletes Added Yet. Use The Form Below To Add Someone.
                  </td>
                </tr>
              ) : (
                visibleAthletes.map((athlete) => (
                  <tr key={athlete.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">
                      {athlete.firstName || "-"}
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">
                      {athlete.lastName || "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {athlete.number || "-"}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {athlete.grade || "-"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {(() => {
                        const { text, isRecent } = formatLastWorkout(lastWorkoutDates[athlete.id]);
                        return (
                          <span className={isRecent ? "font-semibold text-green-600" : "text-gray-500"}>
                            {text}
                          </span>
                        );
                      })()}
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
          <h3 className="text-sm font-semibold text-gray-700">Add Athlete To Attendance</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col text-xs font-medium text-gray-600 gap-1">
              First Name
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
              Last Name
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
              Add Athlete
            </button>
          </div>
        </form>
        
        {/* CSV Import Section */}
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-blue-900">Import From CSV/Excel</h3>
          <p className="text-xs text-blue-700">
            Upload A CSV File With Columns: <strong>Number, FirstName, LastName, Grade, Team, Height, Weight, Position, Letter</strong>
          </p>
          <p className="text-xs text-blue-600 italic">
            💡 Re-importing the full roster will update existing athletes instead of creating duplicates, making it easy to add new players.
          </p>
          <div className="flex items-center gap-3">
            <label className="btn btn-secondary cursor-pointer">
              📄 Choose CSV File
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleCSVImport}
                className="hidden"
              />
            </label>
            <span className="text-xs text-blue-600">
              Supports Comma Or Tab-Separated Values
            </span>
          </div>
          <details className="text-xs text-blue-700">
            <summary className="cursor-pointer font-medium">Example CSV Format</summary>
            <pre className="mt-2 bg-white p-2 rounded border border-blue-200 text-[10px] overflow-x-auto">
Number,FirstName,LastName,Grade,Team,Height,Weight,Position,Letter
12,John,Smith,12,varsity-football-coed,6'2",185,QB,V
45,Jane,Doe,9,jh-football-coed,5'8",140,RB,JV
23,Mike,Johnson,11,varsity-football-coed,6'0",175,WR,V
            </pre>
            <p className="mt-1 text-[10px]">
              • First Row Can Be A Header (Will Be Auto-Detected)<br />
              • Only FirstName and LastName Are Required<br />
              • All Other Fields Are Optional (Uses Selected Team If Team Not Provided)<br />
              • Supports Excel CSV Exports
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
