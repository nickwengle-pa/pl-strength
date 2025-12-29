import React, { useEffect, useMemo, useState } from "react";
import {
  TEAM_DEFINITIONS,
  AthleteAuthError,
  assignAthleteAccessCode,
  createAthleteAccount,
  deleteAthlete,
  deleteSession,
  defaultEquipment,
  fetchAthleteSessions,
  formatTeamLabel,
  getStoredTeamSelection,
  isAdmin,
  listRoster,
  loadProfileRemote,
  normalizePasscodeDigits,
  regenerateAthleteCode,
  saveProfile,
  fb,
  subscribeToRoleChanges,
  updateAthleteWeek,
  updateSession,
  calculateTMSuggestions,
  advanceCycle,
  type Profile,
  type RosterEntry,
  type SessionRecord,
  type Team,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { StatCardSkeleton } from "../components/LoadingSkeleton";

const LIFT_KEYS = ["bench", "squat", "deadlift"] as const;
type LiftKey = (typeof LIFT_KEYS)[number];
type Week = 1 | 2 | 3;

const emptyTmDraft = (): Record<LiftKey, string> => ({
  bench: "",
  squat: "",
  deadlift: "",
});

const emptyLiftWeekDraft = (): Record<LiftKey, Week> => ({
  bench: 1,
  squat: 1,
  deadlift: 1,
});

const emptyLiftCycleDraft = (): Record<LiftKey, number> => ({
  bench: 1,
  squat: 1,
  deadlift: 1,
});

const resolveLiftWeek = (profile: Profile | null, lift: LiftKey): Week =>
  (profile?.liftWeeks?.[lift] ?? profile?.currentWeek ?? 1) as Week;

const resolveLiftCycle = (profile: Profile | null, lift: LiftKey): number =>
  profile?.liftCycles?.[lift] ?? profile?.currentCycle ?? 1;

const formatWeight = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
};

const normalizeRoles = (roles?: string[] | null): string[] =>
  Array.from(
    new Set(
      (roles ?? [])
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter(Boolean)
    )
  );

type RoleBadgesProps = {
  roles?: string[] | null;
};

function RoleBadges({ roles }: RoleBadgesProps) {
  const normalized = normalizeRoles(roles);
  if (!normalized.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {normalized.map((role) => {
        const label = role === "admin" ? "Admin" : role === "coach" ? "Coach" : role;
        const pillClass =
          role === "admin"
            ? "border border-purple-200 bg-purple-50 text-purple-700"
            : role === "coach"
            ? "border border-brand-200 bg-brand-50 text-brand-700"
            : "border border-gray-200 bg-gray-50 text-gray-600";
        return (
          <span
            key={role}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${pillClass}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function Roster() {
  const [rows, setRows] = useState<RosterEntry[]>([]);
  const [err, setErr] = useState<string|undefined>();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [deleteUid, setDeleteUid] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailSessions, setDetailSessions] = useState<SessionRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [tmDraft, setTmDraft] = useState<Record<LiftKey, string>>(() => emptyTmDraft());
  const [liftWeekDraft, setLiftWeekDraft] = useState<Record<LiftKey, Week>>(() =>
    emptyLiftWeekDraft()
  );
  const [liftCycleDraft, setLiftCycleDraft] = useState<Record<LiftKey, number>>(() =>
    emptyLiftCycleDraft()
  );
  const [tmSaving, setTmSaving] = useState<LiftKey | null>(null);
  const [cycleAdvancing, setCycleAdvancing] = useState(false);
  const [tmSuggestions, setTmSuggestions] = useState<Record<string, number> | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionDraft, setEditSessionDraft] = useState<Partial<SessionRecord>>({});
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionDeleting, setSessionDeleting] = useState<string | null>(null);
  const { setActiveAthlete, isCoach } = useActiveAthlete();
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [coachTeam, setCoachTeam] = useState<Team | null>(null);
  const [coachLevelFilter, setCoachLevelFilter] = useState<"varsity" | "juniorHigh" | "both">("both");
  const [adminCoachFilter, setAdminCoachFilter] = useState<Team | "all">("all");
  const [adminAthleteFilter, setAdminAthleteFilter] = useState<Team | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [addAthleteOpen, setAddAthleteOpen] = useState(false);
  const [addAthleteDraft, setAddAthleteDraft] = useState<{
    firstName: string;
    lastName: string;
    team: Team | "";
    code: string;
  }>({ firstName: "", lastName: "", team: "", code: "" });
  const [addAthleteError, setAddAthleteError] = useState<string | null>(null);
  const [addAthleteSaving, setAddAthleteSaving] = useState(false);
  const [teamFilter, setTeamFilter] = useState<Team | "all">("all");
  const [sortField, setSortField] = useState<"firstName" | "lastName" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const currentUid = fb.auth?.currentUser?.uid ?? null;
  const [activityMap, setActivityMap] = useState<Record<string, { lastWorkout?: number; weekCount: number }>>({});
  const [loadingActivity, setLoadingActivity] = useState(false);
  const coachTeamFilter = !isAdminUser ? coachTeam ?? null : null;
  const activeTeamSelection = coachTeam ?? getStoredTeamSelection();

  const handleSort = (field: "firstName" | "lastName") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const resolveAddAthleteTeam = (): Team | "" => {
    if (!isAdminUser && coachTeam) return coachTeam;
    if (teamFilter !== "all") return teamFilter;
    if (adminAthleteFilter !== "all") return adminAthleteFilter;
    return getStoredTeamSelection();
  };

  const openAddAthlete = () => {
    setAddAthleteDraft({
      firstName: "",
      lastName: "",
      team: resolveAddAthleteTeam(),
      code: "",
    });
    setAddAthleteError(null);
    setAddAthleteOpen(true);
  };

  const closeAddAthlete = () => {
    setAddAthleteOpen(false);
    setAddAthleteError(null);
  };

  const handleAddAthlete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (addAthleteSaving) return;

    const safeFirst = addAthleteDraft.firstName.trim().replace(/\s+/g, " ");
    const safeLast = addAthleteDraft.lastName.trim().replace(/\s+/g, " ");
    const digits = normalizePasscodeDigits(addAthleteDraft.code);

    if (!safeFirst || !safeLast) {
      setAddAthleteError("Enter first and last name.");
      return;
    }
    if (!addAthleteDraft.team) {
      setAddAthleteError("Select a team before saving.");
      return;
    }
    if (digits.length !== 4) {
      setAddAthleteError("Access code must be 4 digits.");
      return;
    }

    setAddAthleteSaving(true);
    setAddAthleteError(null);

    try {
      const { profile } = await createAthleteAccount({
        firstName: safeFirst,
        lastName: safeLast,
        passcodeDigits: digits,
        team: addAthleteDraft.team as Team,
      });

      setRows((prev) => {
        const nextEntry: RosterEntry = {
          uid: profile.uid,
          firstName: profile.firstName,
          lastName: profile.lastName,
          team: profile.team,
          teamScopes: profile.teamScopes,
          teamAnchor: profile.teamAnchor,
          unit: profile.unit,
          accessCode: profile.accessCode ?? null,
          roles: [],
        };
        const existingIndex = prev.findIndex((row) => row.uid === profile.uid);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], ...nextEntry };
          return next;
        }
        return [nextEntry, ...prev];
      });

      setFlash({
        kind: "success",
        text: `${profile.firstName} ${profile.lastName} added to the roster.`,
      });
      closeAddAthlete();
    } catch (err: any) {
      if (err instanceof AthleteAuthError) {
        if (err.code === "auth/wrong-password") {
          setAddAthleteError("That code does not match the existing athlete account.");
        } else if (err.code === "athlete-code/taken") {
          setAddAthleteError("That code is already used by another athlete.");
        } else if (err.code === "athlete-code/unavailable") {
          setAddAthleteError("We could not reserve that code. Try again in a moment.");
        } else if (err.code === "auth/unavailable") {
          setAddAthleteError("Firebase auth is unavailable.");
        } else {
          setAddAthleteError(err.message || "Failed to add athlete.");
        }
      } else {
        setAddAthleteError(err?.message ?? "Failed to add athlete.");
      }
    } finally {
      setAddAthleteSaving(false);
    }
  };

  useEffect(() => {
    (async () => {
      try { setRows(await listRoster()); }
      catch (e:any) { setErr(e?.message || String(e)); }
    })();
  }, []);

  // Load activity data for athletes
  useEffect(() => {
    if (rows.length === 0) return;
    
    const athleteUids = rows
      .filter(r => !r.roles?.includes('coach') && !r.roles?.includes('admin'))
      .map(r => r.uid);
    
    if (athleteUids.length === 0) return;
    
    let active = true;
    setLoadingActivity(true);
    
    (async () => {
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const activity: Record<string, { lastWorkout?: number; weekCount: number }> = {};
      
      await Promise.all(
        athleteUids.map(async (uid) => {
          try {
            const sessions = await fetchAthleteSessions(
              uid,
              12,
              activeTeamSelection || undefined
            );
            const recentSessions = sessions.filter(s => (s.createdAt || 0) >= oneWeekAgo);
            const lastWorkout = sessions.length > 0 
              ? Math.max(...sessions.map(s => s.createdAt || 0)) 
              : undefined;
            activity[uid] = { lastWorkout, weekCount: recentSessions.length };
          } catch (err) {
            activity[uid] = { weekCount: 0 };
          }
        })
      );
      
      if (active) {
        setActivityMap(activity);
        setLoadingActivity(false);
      }
    })();
    
    return () => { active = false; };
  }, [rows, activeTeamSelection]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const flag = await isAdmin();
        if (active) setIsAdminUser(flag);
      } catch (err) {
        console.warn("Failed to resolve admin status", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      setIsAdminUser(roles.includes("admin"));
    });
    return unsubscribe;
  }, []);

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

  const handleRegenerate = async (row: RosterEntry) => {
    if (!row.uid) return;

    const input = window.prompt(
      `Enter a 4-digit code for ${row.firstName ?? "this athlete"}.\nLeave blank to auto-generate a new code.`,
      ""
    );
    if (input === null) return;

    const trimmed = input.trim();
    if (trimmed && !/^\d{4}$/.test(trimmed)) {
      alert("Codes must be exactly 4 digits (for example, 1234).");
      return;
    }

    setBusyUid(row.uid);
    try {
      let nextCode: string | null = null;
      let source: "remote" | "local" = "remote";

      if (trimmed) {
        const result = await assignAthleteAccessCode(row.uid, trimmed);
        if (result.status === "taken") {
          setFlash({
            kind: "error",
            text: "That code is already used by another athlete. Try a different four-digit code.",
          });
          return;
        }
        if (result.status === "unavailable") {
          setFlash({
            kind: "error",
            text: "We could not reserve that code. Check Firestore permissions and try again.",
          });
          return;
        }
        nextCode = result.code;
        source = result.source;
      } else {
        nextCode = await regenerateAthleteCode(row.uid);
      }

      if (!nextCode) {
        setFlash({
          kind: "error",
          text: "A code was not generated. Try again.",
        });
        return;
      }

      setRows((prev) =>
        prev.map((r) => (r.uid === row.uid ? { ...r, accessCode: nextCode } : r))
      );
      if (detailProfile?.uid === row.uid) {
        setDetailProfile((prev) =>
          prev ? { ...prev, accessCode: nextCode ?? null } : prev
        );
      }
      setFlash({
        kind: "success",
        text:
          source === "local"
            ? `Code ${nextCode} assigned locally. Remote sync will apply once permissions are available.`
            : `Code ${nextCode} assigned.`,
      });
    } catch (e: any) {
      const message =
        e?.message ?? "Could not set a new code. Try again in a moment.";
      console.error("Failed to assign athlete code", e);
      setFlash({ kind: "error", text: message });
    } finally {
      setBusyUid(null);
    }
  };

  const handleDelete = async (row: RosterEntry, kind: "athlete" | "coach" = "athlete") => {
    if (!row.uid) return;

    if (currentUid && row.uid === currentUid) {
      alert("You cannot remove your own account from the roster while signed in.");
      return;
    }

    const label =
      kind === "coach"
        ? `Remove ${row.firstName ?? "this coach"}? This will revoke access and queue account deletion.`
        : `Delete ${row.firstName ?? "this athlete"} from roster? This clears their profile and sessions.`;
    const confirmDelete = window.confirm(label);
    if (!confirmDelete) return;

    setDeleteUid(row.uid);
    try {
      await deleteAthlete(row.uid);
      setRows((prev) => prev.filter((r) => r.uid !== row.uid));
      if (selectedUid === row.uid) {
        setSelectedUid(null);
        setDetailProfile(null);
        setDetailSessions([]);
        setDetailModalOpen(false);
      }
      setFlash({
        kind: "success",
        text:
          kind === "coach"
            ? `${row.firstName ?? "Coach"} removed. Auth account will be deleted shortly.`
            : `${row.firstName ?? "Athlete"} removed.`,
      });
    } catch (e: any) {
      const message =
        e?.message ?? "Could not delete athlete. Try again in a moment.";
      setFlash({ kind: "error", text: message });
    } finally {
      setDeleteUid(null);
    }
  };

  useEffect(() => {
    if (!detailProfile) {
      setTmDraft(emptyTmDraft());
      setLiftWeekDraft(emptyLiftWeekDraft());
      setLiftCycleDraft(emptyLiftCycleDraft());
      return;
    }
    setTmDraft(() => {
      const draft = emptyTmDraft();
      for (const lift of LIFT_KEYS) {
        const value = detailProfile.tm?.[lift];
        if (typeof value === "number" && Number.isFinite(value)) {
          draft[lift] = String(value);
        }
      }
      return draft;
    });
    setLiftWeekDraft(() => {
      const draft = emptyLiftWeekDraft();
      for (const lift of LIFT_KEYS) {
        draft[lift] = resolveLiftWeek(detailProfile, lift);
      }
      return draft;
    });
    setLiftCycleDraft(() => {
      const draft = emptyLiftCycleDraft();
      for (const lift of LIFT_KEYS) {
        draft[lift] = resolveLiftCycle(detailProfile, lift);
      }
      return draft;
    });
  }, [detailProfile]);

  const handleTmDraftChange = (lift: LiftKey, value: string) => {
    setTmDraft((prev) => ({ ...prev, [lift]: value }));
  };

  const handleLiftWeekChange = (lift: LiftKey, value: Week) => {
    setLiftWeekDraft((prev) => ({ ...prev, [lift]: value }));
  };

  const handleLiftCycleChange = (lift: LiftKey, value: number) => {
    const next = Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
    setLiftCycleDraft((prev) => ({ ...prev, [lift]: next }));
  };

  const handleSaveTm = async (lift: LiftKey) => {
    if (!detailProfile) return;
    const raw = (tmDraft[lift] ?? "").trim();
    const nextValue = raw === "" ? null : Number(raw);
    if (nextValue !== null && (!Number.isFinite(nextValue) || Number.isNaN(nextValue) || nextValue < 0)) {
      setFlash({ kind: "error", text: "Enter a valid training max before saving." });
      return;
    }
    const nextWeek = liftWeekDraft[lift] ?? 1;
    const nextCycle = liftCycleDraft[lift] ?? 1;
    if (nextWeek !== 1 && nextWeek !== 2 && nextWeek !== 3) {
      setFlash({ kind: "error", text: "Week must be 1, 2, or 3." });
      return;
    }
    if (!Number.isFinite(nextCycle) || nextCycle < 1) {
      setFlash({ kind: "error", text: "Cycle must be 1 or higher." });
      return;
    }
    setTmSaving(lift);
    try {
      const nextTm: NonNullable<Profile["tm"]> = { ...(detailProfile.tm ?? {}) };
      if (nextValue === null) {
        delete nextTm[lift];
      } else {
        nextTm[lift] = nextValue;
      }
      const hasAny = LIFT_KEYS.some((key) => typeof nextTm[key] === "number" && Number.isFinite(nextTm[key] as number));
      const nextLiftWeeks = { ...(detailProfile.liftWeeks ?? {}) };
      const nextLiftCycles = { ...(detailProfile.liftCycles ?? {}) };
      nextLiftWeeks[lift] = nextWeek;
      nextLiftCycles[lift] = Math.floor(nextCycle);
      const updatedProfile: Profile = {
        ...detailProfile,
        tm: hasAny ? nextTm : undefined,
        liftWeeks: nextLiftWeeks,
        liftCycles: nextLiftCycles,
        currentWeek: nextWeek,
        currentCycle: Math.floor(nextCycle),
      };
      await saveProfile(updatedProfile, { skipLocal: true });
      setDetailProfile(updatedProfile);
      setFlash({
        kind: "success",
        text: nextValue === null
          ? `${lift.charAt(0).toUpperCase() + lift.slice(1)} training max cleared.`
          : `${lift.charAt(0).toUpperCase() + lift.slice(1)} training max saved.`,
      });
    } catch (e: any) {
      setFlash({
        kind: "error",
        text: e?.message ?? "Could not save training max. Try again.",
      });
    } finally {
      setTmSaving(null);
    }
  };

  const handleEditSession = (session: SessionRecord) => {
    if (!session.id) return;
    if (!LIFT_KEYS.includes(session.lift as LiftKey)) {
      setFlash({ kind: "error", text: "Legacy lift sessions can be deleted but not edited." });
      return;
    }
    setEditingSessionId(session.id);
    setEditSessionDraft({
      week: session.week,
      lift: session.lift,
      cycle: session.cycle ?? 1,
      amrap: { ...session.amrap },
    });
  };

  const handleCancelEditSession = () => {
    setEditingSessionId(null);
    setEditSessionDraft({});
  };

  const handleSaveSession = async (sessionId: string) => {
    if (!detailProfile?.uid) return;
    const nextWeek = editSessionDraft.week;
    const nextCycle = editSessionDraft.cycle;
    const nextLift = editSessionDraft.lift;
    if (nextWeek && nextWeek !== 1 && nextWeek !== 2 && nextWeek !== 3) {
      setFlash({ kind: "error", text: "Week must be 1, 2, or 3." });
      return;
    }
    if (typeof nextCycle === "number" && (!Number.isFinite(nextCycle) || nextCycle < 1)) {
      setFlash({ kind: "error", text: "Cycle must be 1 or higher." });
      return;
    }
    if (nextLift && !LIFT_KEYS.includes(nextLift as LiftKey)) {
      setFlash({ kind: "error", text: "Choose bench, squat, or deadlift." });
      return;
    }
    setSessionSaving(true);
    try {
      await updateSession(detailProfile.uid, sessionId, editSessionDraft);
      setDetailSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, ...editSessionDraft } : s
        )
      );
      setFlash({ kind: "success", text: "Session updated." });
      setEditingSessionId(null);
    } catch (err: any) {
      setFlash({ kind: "error", text: err?.message ?? "Failed to update session." });
    } finally {
      setSessionSaving(false);
    }
  };

  const handleDeleteSession = async (session: SessionRecord) => {
    if (!detailProfile?.uid || !session.id) return;
    if (!confirm("Delete this session? This cannot be undone.")) return;
    setSessionDeleting(session.id);
    try {
      await deleteSession(detailProfile.uid, session.id);
      setDetailSessions((prev) => prev.filter((entry) => entry.id !== session.id));
      setFlash({ kind: "success", text: "Session deleted." });
      if (editingSessionId === session.id) {
        setEditingSessionId(null);
        setEditSessionDraft({});
      }
    } catch (err: any) {
      setFlash({ kind: "error", text: err?.message ?? "Failed to delete session." });
    } finally {
      setSessionDeleting(null);
    }
  };

  const liftSummaries = useMemo(() => {
    const buckets: Record<LiftKey, SessionRecord[]> = {
      bench: [],
      squat: [],
      deadlift: [],
    };
    for (const session of detailSessions) {
      const lift = session.lift as LiftKey;
      if (LIFT_KEYS.includes(lift)) {
        buckets[lift].push(session);
      }
    }
    return LIFT_KEYS.map((lift) => {
      const sessions = buckets[lift];
      const latest = sessions[0];
      let bestEst: { value: number; unit: SessionRecord["unit"] } | null = null;
      for (const entry of sessions) {
        if (typeof entry.est1rm === "number" && Number.isFinite(entry.est1rm)) {
          if (!bestEst || entry.est1rm > bestEst.value) {
            bestEst = { value: entry.est1rm, unit: entry.unit };
          }
        }
      }
      return {
        lift,
        label: lift.charAt(0).toUpperCase() + lift.slice(1),
        tm: detailProfile?.tm?.[lift],
        bestEst,
        latest,
        totalSessions: sessions.length,
      };
    });
  }, [detailProfile, detailSessions]);

  const isCoachRow = (row: RosterEntry) => {
    const roles = normalizeRoles(row.roles);
    return roles.includes("coach") || roles.includes("admin");
  };

  const getRowTeams = (row: RosterEntry): Team[] => {
    if (row.teamScopes && row.teamScopes.length > 0) return row.teamScopes;
    return row.team ? [row.team] : [];
  };

  const coachRows = useMemo(
    () => rows.filter(isCoachRow),
    [rows]
  );
  const athleteRows = useMemo(
    () => rows.filter((row) => !isCoachRow(row)),
    [rows]
  );

  const filteredCoachRows = useMemo(() => {
    let rows = coachRows;
    if (!isAdminUser && coachTeamFilter) {
      // For coaches: filter by sport/program, then optionally by level
      const coachTeamDef = TEAM_DEFINITIONS.find(def => def.id === coachTeamFilter);
      if (coachTeamDef) {
        rows = rows.filter((row) => {
          const rowTeams = getRowTeams(row);
          if (rowTeams.length === 0) return false;
          return rowTeams.some((teamId) => {
            const rowTeamDef = TEAM_DEFINITIONS.find(def => def.id === teamId);
            if (!rowTeamDef) return false;
            // Must match sport and program
            const matchesSportProgram = rowTeamDef.sport === coachTeamDef.sport &&
                                        rowTeamDef.program === coachTeamDef.program;
            if (!matchesSportProgram) return false;
            // Apply level filter
            if (coachLevelFilter === "both") return true;
            return rowTeamDef.level === coachLevelFilter;
          });
        });
      }
    }
    if (isAdminUser && adminCoachFilter !== "all") {
      rows = rows.filter((row) => getRowTeams(row).includes(adminCoachFilter));
    }
    return rows;
  }, [coachRows, coachTeamFilter, isAdminUser, adminCoachFilter, coachLevelFilter]);

  const filteredAthleteRows = useMemo(() => {
    let rows = athleteRows;
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      rows = rows.filter((row) => {
        const fullName = `${row.firstName || ""} ${row.lastName || ""}`.toLowerCase();
        return fullName.includes(query) || row.uid.toLowerCase().includes(query);
      });
    }
    
    // Apply team filter (for admins or when explicitly set)
    if (teamFilter !== "all") {
      rows = rows.filter((row) => getRowTeams(row).includes(teamFilter));
    }
    
    if (!isAdminUser && coachTeamFilter) {
      // For coaches: filter by sport/program, then optionally by level
      const coachTeamDef = TEAM_DEFINITIONS.find(def => def.id === coachTeamFilter);
      if (coachTeamDef) {
        rows = rows.filter((row) => {
          const rowTeams = getRowTeams(row);
          if (rowTeams.length === 0) return false;
          return rowTeams.some((teamId) => {
            const rowTeamDef = TEAM_DEFINITIONS.find(def => def.id === teamId);
            if (!rowTeamDef) return false;
            // Must match sport and program
            const matchesSportProgram = rowTeamDef.sport === coachTeamDef.sport &&
                                        rowTeamDef.program === coachTeamDef.program;
            if (!matchesSportProgram) return false;
            // Apply level filter
            if (coachLevelFilter === "both") return true;
            return rowTeamDef.level === coachLevelFilter;
          });
        });
      }
    }
    if (isAdminUser && adminAthleteFilter !== "all") {
      rows = rows.filter((row) => getRowTeams(row).includes(adminAthleteFilter));
    }
    
    // Apply sorting
    if (sortField) {
      rows = [...rows].sort((a, b) => {
        let aVal = "";
        let bVal = "";
        
        if (sortField === "firstName") {
          aVal = (a.firstName || "").toLowerCase();
          bVal = (b.firstName || "").toLowerCase();
        } else if (sortField === "lastName") {
          aVal = (a.lastName || "").toLowerCase();
          bVal = (b.lastName || "").toLowerCase();
        }
        
        if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
        if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }
    
    return rows;
  }, [athleteRows, coachTeamFilter, isAdminUser, adminAthleteFilter, coachLevelFilter, searchQuery, teamFilter, sortField, sortDirection]);

  const selectedRow = useMemo(
    () => filteredAthleteRows.find((row) => row.uid === selectedUid) ?? null,
    [filteredAthleteRows, selectedUid]
  );

  useEffect(() => {
    if (
      selectedUid &&
      !filteredAthleteRows.some((row) => row.uid === selectedUid)
    ) {
      setSelectedUid(null);
      setDetailProfile(null);
      setDetailSessions([]);
      setDetailError(null);
      setDetailLoading(false);
      setDetailModalOpen(false);
    }
  }, [filteredAthleteRows, selectedUid]);

  useEffect(() => {
    if (!selectedUid) {
      setDetailProfile(null);
      setDetailSessions([]);
      setDetailError(null);
      setTmDraft(emptyTmDraft());
      setDetailModalOpen(false);
      return;
    }
    setDetailModalOpen(true);
    let active = true;
    setDetailLoading(true);
    setDetailError(null);
    (async () => {
      try {
        const [profile, sessions] = await Promise.all([
          loadProfileRemote(selectedUid),
          fetchAthleteSessions(
            selectedUid,
            12,
            activeTeamSelection || undefined
          ),
        ]);
        if (!active) return;
        const resolvedProfile: Profile = profile
          ? profile
          : {
              uid: selectedUid,
              firstName: selectedRow?.firstName ?? "",
              lastName: selectedRow?.lastName ?? "",
              unit: selectedRow?.unit ?? "lb",
              team: selectedRow?.team,
              accessCode: selectedRow?.accessCode ?? null,
              tm: undefined,
              equipment: defaultEquipment(),
            };
        setDetailProfile(resolvedProfile);
        if (isCoach) {
          setActiveAthlete({
            uid: resolvedProfile.uid,
            firstName: resolvedProfile.firstName ?? undefined,
            lastName: resolvedProfile.lastName ?? undefined,
            team: activeTeamSelection || resolvedProfile.team || null,
            unit: resolvedProfile.unit,
          });
        }
        setDetailSessions(sessions);
        
        // Calculate TM suggestions if on Week 3
        if (resolvedProfile.currentWeek === 3) {
          const suggestions = await calculateTMSuggestions(selectedUid);
          if (active) setTmSuggestions(suggestions);
        } else {
          setTmSuggestions(null);
        }
      } catch (err: any) {
        if (!active) return;
        setDetailError(err?.message ?? "Could not load athlete data.");
        setDetailProfile(null);
        setDetailSessions([]);
      } finally {
        if (active) setDetailLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [filteredAthleteRows, isCoach, selectedRow, selectedUid, setActiveAthlete, activeTeamSelection]);

  const detailHeader = (
    <div>
      <h3 className="text-lg font-semibold">
        Review: {detailProfile?.firstName} {detailProfile?.lastName}
      </h3>
      {selectedRow?.roles && <RoleBadges roles={selectedRow.roles} />}
    </div>
  );

  const detailBody = (
    <>
      {detailLoading && (
        <div className="space-y-3">
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
      )}

      {detailError && !detailLoading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {detailError}
        </div>
      )}

      {!detailLoading && !detailError && detailProfile && (
        <>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm text-gray-600">Team</div>
            <div className="text-base font-semibold text-gray-900">
              {formatTeamLabel(activeTeamSelection || detailProfile.team, "-")}
            </div>
            <div className="mt-2 text-sm text-gray-600">Unit</div>
            <div className="text-base font-semibold text-gray-900">
              {detailProfile.unit}
            </div>
            <div className="mt-2 text-sm text-gray-600">Sign-in code</div>
            <div className="font-mono text-base text-gray-900">
              {detailProfile.accessCode ?? "-"}
            </div>
          </div>

          {/* Cycle Advancement */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 mt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-indigo-900">
                  Training Cycle
                </div>
                <div className="text-xs text-indigo-700 mt-1">
                  Manage weekly progression and cycle advancement
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-indigo-700 font-medium">Current Week:</span>
                {[1, 2, 3].map((week) => (
                  <button
                    key={week}
                    onClick={async () => {
                      if (cycleAdvancing) return;
                      setCycleAdvancing(true);
                      try {
                        await updateAthleteWeek(detailProfile.uid, week as 1 | 2 | 3);
                        const updated = await loadProfileRemote(detailProfile.uid);
                        if (updated) {
                          setDetailProfile(updated);
                          // Recalculate suggestions if moving to Week 3
                          if (week === 3) {
                            const suggestions = await calculateTMSuggestions(detailProfile.uid);
                            setTmSuggestions(suggestions);
                          } else {
                            setTmSuggestions(null);
                          }
                        }
                      } catch (err: any) {
                        alert(err?.message ?? "Failed to update week");
                      } finally {
                        setCycleAdvancing(false);
                      }
                    }}
                    disabled={cycleAdvancing}
                    className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                      (detailProfile.currentWeek ?? 1) === week
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-indigo-700 border border-indigo-300 hover:bg-indigo-100"
                    } ${cycleAdvancing ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    Week {week}
                  </button>
                ))}
              </div>
            </div>

            {/* TM Increase Suggestions after Week 3 */}
            {tmSuggestions && Object.keys(tmSuggestions).length > 0 && (
              <div className="mt-4 pt-4 border-t border-indigo-200">
                <div className="text-sm font-semibold text-indigo-900 mb-2">
                  Suggested Training Max Increases
                </div>
                <div className="grid gap-2 grid-cols-2 md:grid-cols-4 mb-3">
                  {(["bench", "squat", "deadlift"] as const).map((lift) => {
                    const suggestion = tmSuggestions[lift];
                    if (!suggestion) return null;
                    const current = detailProfile.tm?.[lift] ?? 0;
                    const newTM = current + suggestion;
                    return (
                      <div key={lift} className="bg-white rounded-lg border border-indigo-200 p-2">
                        <div className="text-xs text-indigo-700 font-medium capitalize">
                          {lift}
                        </div>
                        <div className="text-sm text-gray-900 mt-1">
                          {current} ƒ+' <span className="font-semibold text-green-600">{newTM}</span>
                        </div>
                        <div className="text-xs text-gray-500">+{suggestion} {detailProfile.unit}</div>
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={async () => {
                    if (cycleAdvancing) return;
                    if (!confirm(`Advance ${detailProfile.firstName} to Week 1 with new TMs?`)) return;
                    setCycleAdvancing(true);
                    try {
                      await advanceCycle(detailProfile.uid, tmSuggestions);
                      const updated = await loadProfileRemote(detailProfile.uid);
                      if (updated) {
                        setDetailProfile(updated);
                        setTmSuggestions(null);
                      }
                      alert("Cycle advanced successfully!");
                    } catch (err: any) {
                      alert(err?.message ?? "Failed to advance cycle");
                    } finally {
                      setCycleAdvancing(false);
                    }
                  }}
                  disabled={cycleAdvancing}
                  className="w-full sm:w-auto px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cycleAdvancing ? "Advancing..." : "Start Next Cycle"}
                </button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 mt-4">
            <div className="flex flex-col gap-1 mb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-gray-700">
                Lift Summary &amp; Quick Edit
              </div>
              <div className="text-xs text-gray-500">
                Review recent logs and adjust training max numbers on the fly.
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs sm:text-sm">
                <thead className="text-gray-600">
                  <tr>
                    <th className="p-2 text-left">Lift</th>
                    <th className="p-2 text-left">Cycle</th>
                    <th className="p-2 text-left">Week</th>
                    <th className="p-2 text-left">Training Max</th>
                    <th className="p-2 text-left">Best Est 1RM</th>
                    <th className="p-2 text-left">Last Session</th>
                    <th className="p-2 text-left">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {liftSummaries.map((summary) => {
                    const draftValue = tmDraft[summary.lift];
                    const draftWeek = liftWeekDraft[summary.lift] ?? 1;
                    const draftCycle = liftCycleDraft[summary.lift] ?? 1;
                    const isSaving = tmSaving === summary.lift;
                    const latest = summary.latest;
                    const latestMeta = latest
                      ? [`C${latest.cycle ?? 1} W${latest.week}`, latest.pr ? "PR" : ""]
                          .filter(Boolean)
                          .join(" / ")
                      : "";
                    return (
                      <tr key={summary.lift} className="border-t">
                        <td className="p-2 capitalize font-medium text-gray-800">
                          {summary.label}
                        </td>
                        <td className="p-2">
                          <input
                            type="number"
                            min={1}
                            step="1"
                            className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                            value={draftCycle}
                            onChange={(event) =>
                              handleLiftCycleChange(summary.lift, Number(event.target.value))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <select
                            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                            value={draftWeek}
                            onChange={(event) =>
                              handleLiftWeekChange(summary.lift, Number(event.target.value) as Week)
                            }
                          >
                            {[1, 2, 3].map((week) => (
                              <option key={week} value={week}>
                                {week}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="1"
                              className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                              value={draftValue}
                              onChange={(event) =>
                                handleTmDraftChange(summary.lift, event.target.value)
                              }
                              placeholder="--"
                            />
                            <span className="text-xs text-gray-500">
                              {detailProfile.unit}
                            </span>
                          </div>
                        </td>
                        <td className="p-2">
                          {summary.bestEst
                            ? `${formatWeight(summary.bestEst.value)} ${summary.bestEst.unit}`
                            : "-"}
                        </td>
                        <td className="p-2">
                          {latest ? (
                            <div className="space-y-0.5 text-xs text-gray-600">
                              <div className="font-medium text-gray-800">
                                {latest.createdAt
                                  ? new Date(latest.createdAt).toLocaleDateString()
                                  : "-"}
                              </div>
                              <div>
                                {latest.amrap?.weight ?? 0} {latest.unit} x{" "}
                                {latest.amrap?.reps ?? 0}
                              </div>
                              {latestMeta && (
                                <div className="text-gray-500">{latestMeta}</div>
                              )}
                              <div className="text-gray-400">
                                Logs: {summary.totalSessions}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-0.5 text-xs text-gray-400">
                              <div>No sessions yet</div>
                              <div>Logs: {summary.totalSessions}</div>
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          <button
                            type="button"
                            className="btn px-3 py-1 text-xs"
                            disabled={isSaving || !detailProfile}
                            onClick={() => handleSaveTm(summary.lift)}
                          >
                            {isSaving ? "Saving..." : "Save"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">
              Recent Sessions
            </h4>
            {detailSessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                No logged sessions yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="p-2 text-left">Date</th>
                      <th className="p-2 text-left">Lift</th>
                      <th className="p-2 text-left">Cycle / Week</th>
                      <th className="p-2 text-left">AMRAP</th>
                      <th className="p-2 text-left">Est 1RM</th>
                      <th className="p-2 text-left">PR</th>
                      {isCoach && <th className="p-2 text-left">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detailSessions.slice(0, 8).map((session) => {
                      const isEditing = editingSessionId === session.id;
                      const isLegacyLift = !LIFT_KEYS.includes(session.lift as LiftKey);
                      const isDeleting = sessionDeleting === session.id;
                      const canEdit = !isLegacyLift && Boolean(session.id);
                      return (
                        <tr key={session.id ?? session.createdAt} className="border-t">
                          <td className="p-2 text-xs text-gray-600">
                            {session.createdAt
                              ? new Date(session.createdAt).toLocaleDateString()
                              : "-"}
                          </td>
                          <td className="p-2 capitalize">
                            {isEditing ? (
                              <select
                                className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                                value={editSessionDraft.lift}
                                onChange={(e) =>
                                  setEditSessionDraft((prev) => ({
                                    ...prev,
                                    lift: e.target.value as any,
                                  }))
                                }
                              >
                                {LIFT_KEYS.map((k) => (
                                  <option key={k} value={k}>
                                    {k}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              session.lift
                            )}
                          </td>
                          <td className="p-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  className="w-12 rounded border border-gray-300 px-1 py-0.5 text-xs"
                                  value={editSessionDraft.cycle ?? 1}
                                  onChange={(e) =>
                                    setEditSessionDraft((prev) => ({
                                      ...prev,
                                      cycle: Number(e.target.value),
                                    }))
                                  }
                                />
                                <select
                                  className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                                  value={editSessionDraft.week}
                                  onChange={(e) =>
                                    setEditSessionDraft((prev) => ({
                                      ...prev,
                                      week: Number(e.target.value) as any,
                                    }))
                                  }
                                >
                                  {[1, 2, 3].map((w) => (
                                    <option key={w} value={w}>
                                      Week {w}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ) : (
                              `Cycle ${session.cycle ?? 1} / Week ${session.week}`
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            {isEditing ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  className="w-12 rounded border border-gray-300 px-1 py-0.5 text-xs"
                                  value={editSessionDraft.amrap?.weight ?? 0}
                                  onChange={(e) =>
                                    setEditSessionDraft((prev) => ({
                                      ...prev,
                                      amrap: {
                                        weight: Number(e.target.value),
                                        reps: prev.amrap?.reps ?? 0,
                                      },
                                    }))
                                  }
                                />
                                <span>{session.unit} x</span>
                                <input
                                  type="number"
                                  className="w-10 rounded border border-gray-300 px-1 py-0.5 text-xs"
                                  value={editSessionDraft.amrap?.reps ?? 0}
                                  onChange={(e) =>
                                    setEditSessionDraft((prev) => ({
                                      ...prev,
                                      amrap: {
                                        weight: prev.amrap?.weight ?? 0,
                                        reps: Number(e.target.value),
                                      },
                                    }))
                                  }
                                />
                              </div>
                            ) : (
                              `${session.amrap?.weight ?? 0} ${session.unit} x ${
                                session.amrap?.reps ?? 0
                              }`
                            )}
                          </td>
                          <td className="p-2 font-semibold">
                            {session.est1rm
                              ? `${session.est1rm} ${session.unit}`
                              : "-"}
                          </td>
                          <td className="p-2 text-green-600">
                            {session.pr ? "PR" : "-"}
                          </td>
                          {isCoach && (
                            <td className="p-2">
                              {isEditing ? (
                                <div className="flex gap-1">
                                  <button
                                    className="btn px-2 py-0.5 text-[10px] bg-green-50 text-green-700 border-green-200"
                                    onClick={() => handleSaveSession(session.id!)}
                                    disabled={sessionSaving}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className="btn px-2 py-0.5 text-[10px] bg-gray-50 text-gray-600 border-gray-200"
                                    onClick={handleCancelEditSession}
                                    disabled={sessionSaving}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-1">
                                  {canEdit && (
                                    <button
                                      className="btn px-2 py-0.5 text-[10px]"
                                      onClick={() => handleEditSession(session)}
                                      disabled={sessionSaving || isDeleting}
                                    >
                                      Edit
                                    </button>
                                  )}
                                  <button
                                    className="btn px-2 py-0.5 text-[10px] bg-rose-50 text-rose-700 border-rose-200"
                                    onClick={() => handleDeleteSession(session)}
                                    disabled={sessionSaving || isDeleting}
                                  >
                                    {isDeleting ? "Deleting..." : "Delete"}
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );

  if (err) {
    return (
      <div className="container py-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-2">Roster</h3>
          <div className="text-sm text-red-700">Error: {err}</div>
          <p className="text-sm mt-2">
            If this says "Missing or insufficient permissions", create Firestore <code>{'roles/{uid}'}</code> with <code>{"{ roles: [\"coach\"], updatedAt: serverTimestamp() }"}</code>, then publish rules.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      {flash && (
        <div
          className={`rounded-2xl border px-3 py-2 text-sm ${
            flash.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h3 className="text-lg font-semibold">Coaches</h3>
          {!isAdminUser && coachTeam && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-600">Level:</span>
              <div className="inline-flex rounded-lg border border-gray-200 p-1 gap-1">
                <button
                  onClick={() => setCoachLevelFilter("varsity")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    coachLevelFilter === "varsity"
                      ? "bg-brand-500 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Varsity
                </button>
                <button
                  onClick={() => setCoachLevelFilter("juniorHigh")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    coachLevelFilter === "juniorHigh"
                      ? "bg-brand-500 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Junior High
                </button>
                <button
                  onClick={() => setCoachLevelFilter("both")}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    coachLevelFilter === "both"
                      ? "bg-brand-500 text-white"
                      : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  Both
                </button>
              </div>
            </div>
          )}
          {isAdminUser && (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              <span>Filter by team</span>
              <select
                className="field !text-xs"
                value={adminCoachFilter}
                onChange={(event) => setAdminCoachFilter(event.target.value as Team | "all")}
              >
                <option value="all">All teams</option>
                {TEAM_DEFINITIONS.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">First</th>
                <th className="p-2 text-left">Last</th>
                <th className="p-2 text-left">Access</th>
                <th className="p-2 text-left">Team</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCoachRows.map((r) => {
                const rolesList = normalizeRoles(r.roles);
                const admin = rolesList.includes("admin");
                return (
                  <tr
                    key={r.uid}
                    className={`border-t ${admin ? "bg-purple-50/60" : ""}`}
                  >
                    <td className="p-2 font-medium text-gray-800">{r.firstName || "-"}</td>
                    <td className="p-2">{r.lastName || "-"}</td>
                    <td className="p-2">
                      <RoleBadges roles={r.roles} />
                    </td>
                    <td className="p-2">{formatTeamLabel(r.team, "-")}</td>
                    <td className="p-2">
                      {isAdminUser ? (
                        <button
                          type="button"
                          className="btn btn-sm text-xs text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() => handleDelete(r, "coach")}
                          disabled={deleteUid === r.uid}
                        >
                          {deleteUid === r.uid ? "Removing..." : "Remove"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Admin only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredCoachRows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={5}>
                    No coaches found for the selected team.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Athletes</h3>
              <p className="text-xs text-gray-500">
                Click a row to review recent sessions and TM numbers.
              </p>
            </div>
            {(isCoach || isAdminUser) && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={openAddAthlete}
                disabled={addAthleteSaving}
              >
                Add athlete
              </button>
            )}
          </div>

          {/* Search and Filter Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            {/* Search Box */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search athletes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 pl-10 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Team Filter */}
            {isAdminUser && (
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600 font-medium">Team:</label>
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value as Team | "all")}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="all">All Teams</option>
                  {TEAM_DEFINITIONS.map((def) => (
                    <option key={def.id} value={def.id}>
                      {def.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Level Filter for Coaches */}
            {!isAdminUser && coachTeam && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-600 font-medium">Level:</span>
                <div className="inline-flex rounded-lg border border-gray-200 p-1 gap-1">
                  <button
                    onClick={() => setCoachLevelFilter("varsity")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      coachLevelFilter === "varsity"
                        ? "bg-brand-500 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    Varsity
                  </button>
                  <button
                    onClick={() => setCoachLevelFilter("juniorHigh")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      coachLevelFilter === "juniorHigh"
                        ? "bg-brand-500 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    Junior High
                  </button>
                  <button
                    onClick={() => setCoachLevelFilter("both")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      coachLevelFilter === "both"
                        ? "bg-brand-500 text-white"
                        : "text-gray-600 hover:bg-gray-100"
                    }`}
                  >
                    Both
                  </button>
                </div>
              </div>
            )}

            {/* Admin Athlete Filter */}
            {isAdminUser && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <span>Filter</span>
                <select
                  className="field !text-xs"
                  value={adminAthleteFilter}
                  onChange={(event) => setAdminAthleteFilter(event.target.value as Team | "all")}
                >
                  <option value="all">All teams</option>
                  {TEAM_DEFINITIONS.map((definition) => (
                    <option key={definition.id} value={definition.id}>
                      {definition.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {addAthleteOpen && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
              <form className="space-y-4" onSubmit={handleAddAthlete}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-emerald-900">
                      Add athlete
                    </div>
                    <div className="text-xs text-emerald-700">
                      Use the same sign-in code so they can log in later.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm text-xs"
                    onClick={closeAddAthlete}
                    disabled={addAthleteSaving}
                  >
                    Close
                  </button>
                </div>

                {addAthleteError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {addAthleteError}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    First name
                    <input
                      className="field"
                      value={addAthleteDraft.firstName}
                      onChange={(event) =>
                        setAddAthleteDraft((prev) => ({
                          ...prev,
                          firstName: event.target.value,
                        }))
                      }
                      placeholder="First name"
                      disabled={addAthleteSaving}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    Last name
                    <input
                      className="field"
                      value={addAthleteDraft.lastName}
                      onChange={(event) =>
                        setAddAthleteDraft((prev) => ({
                          ...prev,
                          lastName: event.target.value,
                        }))
                      }
                      placeholder="Last name"
                      disabled={addAthleteSaving}
                    />
                  </label>
                </div>

                <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    Team
                    <select
                      className="field"
                      value={addAthleteDraft.team}
                      onChange={(event) =>
                        setAddAthleteDraft((prev) => ({
                          ...prev,
                          team: event.target.value as Team | "",
                        }))
                      }
                      disabled={addAthleteSaving}
                    >
                      <option value="">Select a team</option>
                      {TEAM_DEFINITIONS.map((definition) => (
                        <option key={definition.id} value={definition.id}>
                          {definition.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    4-digit code
                    <input
                      className="field text-center font-semibold tracking-widest"
                      type="tel"
                      value={addAthleteDraft.code}
                      onChange={(event) =>
                        setAddAthleteDraft((prev) => ({
                          ...prev,
                          code: normalizePasscodeDigits(event.target.value),
                        }))
                      }
                      placeholder="1234"
                      inputMode="numeric"
                      maxLength={4}
                      disabled={addAthleteSaving}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={addAthleteSaving}
                  >
                    {addAthleteSaving ? "Saving..." : "Add athlete"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={closeAddAthlete}
                    disabled={addAthleteSaving}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Results Count */}
        {(searchQuery || teamFilter !== "all") && (
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{filteredAthleteRows.length}</span> athlete{filteredAthleteRows.length !== 1 ? 's' : ''}
            {searchQuery && <> matching "{searchQuery}"</>}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th 
                  className="p-2 text-left cursor-pointer hover:bg-gray-100 transition select-none"
                  onClick={() => handleSort("firstName")}
                >
                  <div className="flex items-center gap-1">
                    First
                    {sortField === "firstName" && (
                      <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th 
                  className="p-2 text-left cursor-pointer hover:bg-gray-100 transition select-none"
                  onClick={() => handleSort("lastName")}
                >
                  <div className="flex items-center gap-1">
                    Last
                    {sortField === "lastName" && (
                      <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th className="p-2 text-left">Team</th>
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">This Week</th>
                <th className="p-2 text-left">Last Workout</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAthleteRows.map((r, index) => {
                const selected = selectedUid === r.uid;
                const rowKey = r.uid ? `${r.uid}-${index}` : `row-${index}`;
                const activity = activityMap[r.uid];
                return (
                  <tr
                    key={rowKey}
                    className={`border-t cursor-pointer transition ${
                      selected ? "bg-brand-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setSelectedUid(r.uid);
                      setDetailModalOpen(true);
                      if (isCoach && r.uid) {
                        setActiveAthlete({
                          uid: r.uid,
                          firstName: r.firstName ?? undefined,
                          lastName: r.lastName ?? undefined,
                          team: activeTeamSelection || r.team || null,
                          unit: r.unit ?? undefined,
                        });
                      }
                    }}
                  >
                    <td className="p-2">{r.firstName || "-"}</td>
                    <td className="p-2">{r.lastName || "-"}</td>
                    <td className="p-2">{formatTeamLabel(r.team, "-")}</td>
                    <td className="p-2 font-mono text-xs">{r.accessCode ?? "-"}</td>
                    <td className="p-2">
                      {loadingActivity ? (
                        <span className="text-gray-400 text-xs">...</span>
                      ) : activity?.weekCount ? (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-700">
                          {activity.weekCount} workout{activity.weekCount !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-gray-600">
                      {loadingActivity ? (
                        <span className="text-gray-400">...</span>
                      ) : activity?.lastWorkout ? (
                        new Date(activity.lastWorkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn px-3 py-1 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRegenerate(r);
                          }}
                          disabled={busyUid === r.uid || deleteUid === r.uid}
                        >
                          {busyUid === r.uid ? "Working..." : "Set code"}
                        </button>
                        <button
                          type="button"
                          className="btn px-3 py-1 text-xs text-red-700 border-red-300 hover:bg-red-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(r);
                          }}
                          disabled={deleteUid === r.uid || busyUid === r.uid}
                        >
                          {deleteUid === r.uid ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredAthleteRows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={7}>
                    No athletes found for the selected team.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUid && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            {detailHeader}
            <button
              type="button"
              className="btn text-xs md:text-sm"
              onClick={() => {
                setSelectedUid(null);
                setDetailModalOpen(false);
              }}
            >
              Close
            </button>
          </div>

          {detailBody}
        </div>
      )}

      {detailModalOpen && selectedUid && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4"
          onClick={() => setDetailModalOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="card w-full max-w-5xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              {detailHeader}
              <button
                type="button"
                className="btn text-xs md:text-sm"
                onClick={() => setDetailModalOpen(false)}
              >
                Close
              </button>
            </div>
            {detailBody}
          </div>
        </div>
      )}
    </div>
  );
}
