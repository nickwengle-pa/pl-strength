import React, { useEffect, useMemo, useState, useCallback } from "react";
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
  loadAttendanceSheet,
  loadProfileRemote,
  normalizePasscodeDigits,
  regenerateAthleteCode,
  saveProfile,
  saveSession,
  fb,
  subscribeToRoleChanges,
  subscribeToTeamSessions,
  updateSession,
  backfillCreatedAtDates,
  type Profile,
  type RosterEntry,
  type SessionRecord,
  type Team,
} from "../lib/db";
import { roundToPlate } from "../lib/tm";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { StatCardSkeleton } from "../components/LoadingSkeleton";
import { useDevice } from "../lib/device";
import { useToast } from "../context/ToastContext";
import { ConfirmModal } from "../components/ConfirmModal";

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

const hasLiftWeekMap = (profile: Profile | null): boolean =>
  Boolean(profile?.liftWeeks && Object.keys(profile.liftWeeks).length > 0);

const resolveLiftWeek = (profile: Profile | null, lift: LiftKey): Week => {
  const direct = profile?.liftWeeks?.[lift];
  if (direct === 1 || direct === 2 || direct === 3) return direct;
  if (!hasLiftWeekMap(profile)) {
    const fallback = profile?.currentWeek;
    if (fallback === 1 || fallback === 2 || fallback === 3) return fallback;
  }
  return 1;
};

const formatWeight = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
};

const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

const toLocalDateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const showToast = useToast();
  const [deleteConfirm, setDeleteConfirm] = useState<{ row: RosterEntry; kind: "coach" | "athlete" } | null>(null);
  const device = useDevice();
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
  const [tmSaving, setTmSaving] = useState<LiftKey | null>(null);
  const [detailAttendance, setDetailAttendance] = useState<{ present: number; total: number; dates: { date: string; present: boolean }[] } | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editSessionDraft, setEditSessionDraft] = useState<Partial<SessionRecord>>({});
  const [sessionSaving, setSessionSaving] = useState(false);
  const [sessionDeleting, setSessionDeleting] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState({ firstName: "", lastName: "" });
  const [nameSaving, setNameSaving] = useState(false);
  const [logSessionOpen, setLogSessionOpen] = useState(false);
  const [logSessionDraft, setLogSessionDraft] = useState<{
    lift: LiftKey;
    week: Week;
    cycle: number;
    amrapWeight: string;
    amrapReps: string;
  }>({ lift: "bench", week: 1, cycle: 1, amrapWeight: "", amrapReps: "" });
  const [logSessionSaving, setLogSessionSaving] = useState(false);
  const [profilePanelOpen, setProfilePanelOpen] = useState(false);
  const [profileEditDraft, setProfileEditDraft] = useState<Partial<Profile>>({});
  const [profileSaving, setProfileSaving] = useState(false);
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
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillResult, setBackfillResult] = useState<{ updated: number; skipped: number; errors: number } | null>(null);
  const [teamFilter, setTeamFilter] = useState<Team | "all">("all");
  const [sortField, setSortField] = useState<"firstName" | "lastName" | "lastWorkout" | null>("lastName");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showAthleteTableOnMobile, setShowAthleteTableOnMobile] = useState(false);
  const currentUid = fb.auth?.currentUser?.uid ?? null;
  const [activityMap, setActivityMap] = useState<Record<string, { lastWorkout?: number; weekCount: number }>>({});
  const [loadingActivity, setLoadingActivity] = useState(false);
  const isMobileLayout = device.isMobile || (device.isTouch && !device.isDesktop);
  const useMobileAthleteCards = isMobileLayout && !showAthleteTableOnMobile;
  const coachTeamFilter = !isAdminUser ? coachTeam ?? null : null;
  const activeTeamSelection = coachTeam ?? getStoredTeamSelection();

  const handleSort = (field: "firstName" | "lastName" | "lastWorkout") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection(field === "lastWorkout" ? "desc" : "asc");
    }
  };
  const applySortSelection = (value: string) => {
    const [field, direction] = value.split(":");
    if (field !== "firstName" && field !== "lastName" && field !== "lastWorkout") return;
    if (direction !== "asc" && direction !== "desc") return;
    setSortField(field);
    setSortDirection(direction);
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

  const handleBackfillDates = async () => {
    if (backfillRunning) return;
    setBackfillRunning(true);
    setBackfillResult(null);
    try {
      const result = await backfillCreatedAtDates();
      setBackfillResult(result);
      if (result.updated > 0) {
        const updated = await listRoster();
        setRows(updated);
      }
    } catch (error) {
      console.error("Backfill error:", error);
      setBackfillResult({ updated: 0, skipped: 0, errors: 1 });
    } finally {
      setBackfillRunning(false);
    }
  };

  const handleAddAthlete = async (event: React.FormEvent) => {
    event.preventDefault();
    if (addAthleteSaving) return;

    const safeFirst = addAthleteDraft.firstName.trim().replace(/\s+/g, " ");
    const safeLast = addAthleteDraft.lastName.trim().replace(/\s+/g, " ");
    const digits = normalizePasscodeDigits(addAthleteDraft.code);

    if (!safeFirst || !safeLast) {
      setAddAthleteError("Enter First And Last Name.");
      return;
    }
    if (!addAthleteDraft.team) {
      setAddAthleteError("Select A Team Before Saving.");
      return;
    }
    if (digits.length !== 4) {
      setAddAthleteError("Access Code Must Be 4 Digits.");
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
          createdAt: profile.createdAt,
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
        text: `${profile.firstName} ${profile.lastName} Added To The Roster.`,
      });
      closeAddAthlete();
    } catch (err: any) {
      if (err instanceof AthleteAuthError) {
        if (err.code === "auth/wrong-password") {
          setAddAthleteError("That Code Does Not Match The Existing Athlete Account.");
        } else if (err.code === "athlete-code/taken") {
          setAddAthleteError("That Code Is Already Used By Another Athlete.");
        } else if (err.code === "athlete-code/unavailable") {
          setAddAthleteError("We Could Not Reserve That Code. Try Again In A Moment.");
        } else if (err.code === "auth/unavailable") {
          setAddAthleteError("Firebase Auth Is Unavailable.");
        } else {
          setAddAthleteError(err.message || "Failed To Add Athlete.");
        }
      } else {
        setAddAthleteError(err?.message ?? "Failed To Add Athlete.");
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

  // Real-time subscription to team sessions for live activity updates
  const [liveSessionFeed, setLiveSessionFeed] = useState<Array<SessionRecord & { athleteId: string }>>([]);
  
  useEffect(() => {
    if (!isCoach && !isAdminUser) {
      setLiveSessionFeed([]);
      return;
    }
    const team = activeTeamSelection as Team | undefined;
    if (!team) return;
    
    // Subscribe to last 24 hours of team sessions
    const unsubscribe = subscribeToTeamSessions(
      team,
      (sessions) => {
        setLiveSessionFeed(sessions);
        
        // Update activity map with new sessions
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        setActivityMap((prev) => {
          const next = { ...prev };
          sessions.forEach((session) => {
            const uid = session.athleteId;
            const createdAt = session.createdAt || 0;
            const existing = next[uid] || { weekCount: 0 };
            
            // Update last workout if this is more recent
            if (!existing.lastWorkout || createdAt > existing.lastWorkout) {
              next[uid] = {
                ...existing,
                lastWorkout: createdAt,
              };
            }
          });
          return next;
        });
      },
      { count: 100, since: Date.now() - 24 * 60 * 60 * 1000 }
    );
    
    return unsubscribe;
  }, [activeTeamSelection, isCoach, isAdminUser]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    if (!isMobileLayout) {
      setShowAthleteTableOnMobile(false);
    }
  }, [isMobileLayout]);

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
      `Enter A 4-Digit Code For ${row.firstName ?? "This Athlete"}.\nLeave Blank To Auto-Generate A New Code.`,
      ""
    );
    if (input === null) return;

    const trimmed = input.trim();
    if (trimmed && !/^\d{4}$/.test(trimmed)) {
      showToast("Codes must be exactly 4 digits (for example, 1234).", "warning");
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
            text: "That Code Is Already Used By Another Athlete. Try A Different Four-Digit Code.",
          });
          return;
        }
        if (result.status === "unavailable") {
          setFlash({
            kind: "error",
            text: "We Could Not Reserve That Code. Check Firestore Permissions And Try Again.",
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
          text: "A Code Was Not Generated. Try Again.",
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
            ? `Code ${nextCode} Assigned Locally. Remote Sync Will Apply Once Permissions Are Available.`
            : `Code ${nextCode} Assigned.`,
      });
    } catch (e: any) {
      const message =
        e?.message ?? "Could Not Set A New Code. Try Again In A Moment.";
      console.error("Failed to assign athlete code", e);
      setFlash({ kind: "error", text: message });
    } finally {
      setBusyUid(null);
    }
  };

  const handleDelete = async (row: RosterEntry, kind: "athlete" | "coach" = "athlete") => {
    if (!row.uid) return;

    if (!isAdminUser) {
      setFlash({
        kind: "error",
        text: "Admin Access Required To Delete Athletes Or Coaches.",
      });
      return;
    }

    if (currentUid && row.uid === currentUid) {
      showToast("You cannot remove your own account from the roster while signed in.", "error");
      return;
    }

    setDeleteConfirm({ row, kind });
  }

  async function doDelete(row: RosterEntry, kind: "coach" | "athlete") {
    setDeleteConfirm(null);
    setDeleteUid(row.uid);
    try {
      const result = await deleteAthlete(row.uid);
      setRows((prev) => prev.filter((r) => r.uid !== row.uid));
      if (selectedUid === row.uid) {
        setSelectedUid(null);
        setDetailProfile(null);
        setDetailSessions([]);
        setDetailModalOpen(false);
      }
      const baseText =
        kind === "coach"
          ? `${row.firstName ?? "Coach"} Removed. Auth Account Will Be Deleted Shortly.`
          : `${row.firstName ?? "Athlete"} Removed.`;
      if (result.status === "partial") {
        setFlash({
          kind: "error",
          text: `${baseText} Cleanup Issue: ${result.warnings.join(", ")}.`,
        });
      } else {
        setFlash({
          kind: "success",
          text: baseText,
        });
      }
    } catch (e: any) {
      let message =
        e?.message ?? "Could Not Delete Athlete. Try Again In A Moment.";
      if (e?.code === "permission-denied") {
        message =
          "Missing Permissions. Ensure Your Account Has An Admin Role In Firestore (roles/{uid}).";
      }
      setFlash({ kind: "error", text: message });
    } finally {
      setDeleteUid(null);
    }
  };

  useEffect(() => {
    if (!detailProfile) {
      setProfileEditDraft({});
      setProfilePanelOpen(false);
      return;
    }
    setProfileEditDraft({
      height: detailProfile.height,
      weight: detailProfile.weight,
      graduationYear: detailProfile.graduationYear,
      dash40: detailProfile.dash40,
      benchRepsWeight: detailProfile.benchRepsWeight ?? 185,
      benchReps: detailProfile.benchReps,
      broadJumpFt: detailProfile.broadJumpFt,
      broadJumpIn: detailProfile.broadJumpIn,
      verticalJump: detailProfile.verticalJump,
      threeCone: detailProfile.threeCone,
      shuttle: detailProfile.shuttle,
    });
  }, [detailProfile?.uid]);

  useEffect(() => {
    if (!detailProfile) {
      setTmDraft(emptyTmDraft());
      setLiftWeekDraft(emptyLiftWeekDraft());
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
        const latest = detailSessions.find((session) => session.lift === lift);
        if (latest && (latest.week === 1 || latest.week === 2 || latest.week === 3)) {
          draft[lift] = latest.week;
        } else {
          draft[lift] = resolveLiftWeek(detailProfile, lift);
        }
      }
      return draft;
    });
  }, [detailProfile, detailSessions]);

  const handleTmDraftChange = (lift: LiftKey, value: string) => {
    setTmDraft((prev) => ({ ...prev, [lift]: value }));
  };

  const handleLiftWeekChange = (lift: LiftKey, value: Week) => {
    setLiftWeekDraft((prev) => ({ ...prev, [lift]: value }));
  };

  const handleSaveTm = async (lift: LiftKey) => {
    if (!detailProfile) return;
    const raw = (tmDraft[lift] ?? "").trim();
    const nextValue = raw === "" ? null : Number(raw);
    if (nextValue !== null && (!Number.isFinite(nextValue) || Number.isNaN(nextValue) || nextValue < 0)) {
      setFlash({ kind: "error", text: "Enter A Valid Training Max Before Saving." });
      return;
    }
    const nextWeek = liftWeekDraft[lift] ?? 1;
    const nextCycle = detailProfile.liftCycles?.[lift] ?? detailProfile.currentCycle ?? 1;
    if (nextWeek !== 1 && nextWeek !== 2 && nextWeek !== 3) {
      setFlash({ kind: "error", text: "Week Must Be 1, 2, Or 3." });
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
      await saveProfile(updatedProfile, { skipLocal: true, requireRemote: true });
      setDetailProfile(updatedProfile);
      setFlash({
        kind: "success",
        text: nextValue === null
          ? `${lift.charAt(0).toUpperCase() + lift.slice(1)} Training Max Cleared.`
          : `${lift.charAt(0).toUpperCase() + lift.slice(1)} Training Max Saved.`,
      });
    } catch (e: any) {
      setFlash({
        kind: "error",
        text: e?.message ?? "Could Not Save Training Max. Try Again.",
      });
    } finally {
      setTmSaving(null);
    }
  };

  const handleEditSession = (session: SessionRecord) => {
    if (!session.id) return;
    if (!LIFT_KEYS.includes(session.lift as LiftKey)) {
      setFlash({ kind: "error", text: "Legacy Lift Sessions Can Be Deleted But Not Edited." });
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
      setFlash({ kind: "error", text: "Week Must Be 1, 2, Or 3." });
      return;
    }
    if (typeof nextCycle === "number" && (!Number.isFinite(nextCycle) || nextCycle < 1)) {
      setFlash({ kind: "error", text: "Cycle Must Be 1 Or Higher." });
      return;
    }
    if (nextLift && !LIFT_KEYS.includes(nextLift as LiftKey)) {
      setFlash({ kind: "error", text: "Choose Bench, Squat, Or Deadlift." });
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
      setFlash({ kind: "success", text: "Session Updated." });
      setEditingSessionId(null);
    } catch (err: any) {
      setFlash({ kind: "error", text: err?.message ?? "Failed To Update Session." });
    } finally {
      setSessionSaving(false);
    }
  };

  const handleDeleteSession = async (session: SessionRecord) => {
    if (!detailProfile?.uid || !session.id) return;
    if (!confirm("Delete This Session? This Cannot Be Undone.")) return;
    setSessionDeleting(session.id);
    try {
      await deleteSession(detailProfile.uid, session.id);
      setDetailSessions((prev) => prev.filter((entry) => entry.id !== session.id));
      setFlash({ kind: "success", text: "Session Deleted." });
      if (editingSessionId === session.id) {
        setEditingSessionId(null);
        setEditSessionDraft({});
      }
    } catch (err: any) {
      setFlash({ kind: "error", text: err?.message ?? "Failed To Delete Session." });
    } finally {
      setSessionDeleting(null);
    }
  };

  const handleStartEditName = () => {
    if (!detailProfile) return;
    setNameDraft({ firstName: detailProfile.firstName ?? "", lastName: detailProfile.lastName ?? "" });
    setEditingName(true);
  };

  const handleCancelEditName = () => {
    setEditingName(false);
    setNameDraft({ firstName: "", lastName: "" });
  };

  const handleSaveName = async () => {
    if (!detailProfile) return;
    const first = nameDraft.firstName.trim().replace(/\s+/g, " ");
    const last = nameDraft.lastName.trim().replace(/\s+/g, " ");
    if (!first || !last) {
      setFlash({ kind: "error", text: "First and last name are required." });
      return;
    }
    setNameSaving(true);
    try {
      const updated: Profile = { ...detailProfile, firstName: first, lastName: last };
      await saveProfile(updated, { skipLocal: true, requireRemote: true });
      setDetailProfile(updated);
      setRows((prev) =>
        prev.map((r) => r.uid === detailProfile.uid ? { ...r, firstName: first, lastName: last } : r)
      );
      setEditingName(false);
      setFlash({ kind: "success", text: "Name updated." });
    } catch (e: any) {
      setFlash({ kind: "error", text: e?.message ?? "Failed to update name." });
    } finally {
      setNameSaving(false);
    }
  };

  const parseMetricNum = (v: unknown, integer = false): number | undefined => {
    const n = Number(v);
    if (!Number.isFinite(n)) return undefined;
    if (String(v).trim() === "") return undefined;
    return integer ? Math.floor(n) : n;
  };

  const handleSaveProfileMetrics = async () => {
    if (!detailProfile) return;
    setProfileSaving(true);
    try {
      const updated: Profile = {
        ...detailProfile,
        height: parseMetricNum(profileEditDraft.height),
        weight: parseMetricNum(profileEditDraft.weight),
        graduationYear: parseMetricNum(profileEditDraft.graduationYear, true),
        dash40: parseMetricNum(profileEditDraft.dash40),
        benchRepsWeight: [135, 185, 225].includes(Number(profileEditDraft.benchRepsWeight))
          ? Number(profileEditDraft.benchRepsWeight)
          : undefined,
        benchReps: parseMetricNum(profileEditDraft.benchReps, true),
        broadJumpFt: parseMetricNum(profileEditDraft.broadJumpFt, true),
        broadJumpIn: parseMetricNum(profileEditDraft.broadJumpIn, true),
        verticalJump: parseMetricNum(profileEditDraft.verticalJump),
        threeCone: parseMetricNum(profileEditDraft.threeCone),
        shuttle: parseMetricNum(profileEditDraft.shuttle),
      };
      await saveProfile(updated, { skipLocal: true, requireRemote: true });
      setDetailProfile(updated);
      setFlash({ kind: "success", text: "Profile updated." });
    } catch (e: any) {
      setFlash({ kind: "error", text: e?.message ?? "Failed to update profile." });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleLogSession = async () => {
    if (!detailProfile) return;
    const weight = Number(logSessionDraft.amrapWeight);
    const reps = Number(logSessionDraft.amrapReps);
    if (!Number.isFinite(weight) || weight < 0) {
      setFlash({ kind: "error", text: "Enter a valid AMRAP weight." });
      return;
    }
    if (!Number.isFinite(reps) || reps < 0 || !Number.isInteger(reps)) {
      setFlash({ kind: "error", text: "Enter a valid rep count." });
      return;
    }
    const tm = detailProfile.tm?.[logSessionDraft.lift];
    if (!tm) {
      setFlash({ kind: "error", text: "This athlete has no training max set for this lift." });
      return;
    }
    const est1rm = reps > 0 ? Math.round(weight * (1 + reps / 30)) : weight;
    setLogSessionSaving(true);
    try {
      await saveSession(
        {
          lift: logSessionDraft.lift,
          week: logSessionDraft.week,
          cycle: logSessionDraft.cycle,
          unit: detailProfile.unit ?? "lb",
          tm,
          warmups: [],
          work: [],
          amrap: { weight, reps },
          est1rm,
          team: activeTeamSelection || detailProfile.team,
        },
        detailProfile.uid
      );
      const refreshed = await fetchAthleteSessions(detailProfile.uid, 12, activeTeamSelection || undefined);
      setDetailSessions(refreshed);
      setLogSessionOpen(false);
      setLogSessionDraft({ lift: "bench", week: 1, cycle: 1, amrapWeight: "", amrapReps: "" });
      setFlash({ kind: "success", text: "Session logged." });
    } catch (e: any) {
      setFlash({ kind: "error", text: e?.message ?? "Failed to log session." });
    } finally {
      setLogSessionSaving(false);
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
      const coachTeamDef = TEAM_DEFINITIONS.find(def => def.id === coachTeamFilter);
      if (coachTeamDef) {
        rows = rows.filter((row) => {
          // Always show admins regardless of sport
          if (normalizeRoles(row.roles).includes("admin")) return true;
          const rowTeams = getRowTeams(row);
          if (rowTeams.length === 0) return false;
          return rowTeams.some((teamId) => {
            const rowTeamDef = TEAM_DEFINITIONS.find(def => def.id === teamId);
            if (!rowTeamDef) return false;
            // Match by sport only — basketball coaches see all basketball coaches
            if (rowTeamDef.sport !== coachTeamDef.sport) return false;
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
        if (sortField === "lastWorkout") {
          const aVal = activityMap[a.uid]?.lastWorkout ?? null;
          const bVal = activityMap[b.uid]?.lastWorkout ?? null;

          // Keep athletes with no workout date at the end for both directions.
          if (aVal === null && bVal !== null) return 1;
          if (aVal !== null && bVal === null) return -1;
          if (aVal !== null && bVal !== null && aVal !== bVal) {
            return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
          }
        } else {
          const aVal =
            sortField === "firstName"
              ? (a.firstName || "").toLowerCase()
              : (a.lastName || "").toLowerCase();
          const bVal =
            sortField === "firstName"
              ? (b.firstName || "").toLowerCase()
              : (b.lastName || "").toLowerCase();

          if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
          if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
        }

        // Stable tiebreaker to avoid row jumping.
        const aLast = (a.lastName || "").toLowerCase();
        const bLast = (b.lastName || "").toLowerCase();
        if (aLast < bLast) return -1;
        if (aLast > bLast) return 1;
        const aFirst = (a.firstName || "").toLowerCase();
        const bFirst = (b.firstName || "").toLowerCase();
        if (aFirst < bFirst) return -1;
        if (aFirst > bFirst) return 1;
        return 0;
      });
    }
    
    return rows;
  }, [athleteRows, coachTeamFilter, isAdminUser, adminAthleteFilter, coachLevelFilter, searchQuery, teamFilter, sortField, sortDirection, activityMap]);

  const latestSessionDateKey = useMemo(() => {
    let latestWorkout = 0;
    for (const row of filteredAthleteRows) {
      const ts = activityMap[row.uid]?.lastWorkout;
      if (typeof ts === "number" && Number.isFinite(ts) && ts > latestWorkout) {
        latestWorkout = ts;
      }
    }
    return latestWorkout > 0 ? toLocalDateKey(latestWorkout) : null;
  }, [filteredAthleteRows, activityMap]);

  const selectedRow = useMemo(
    () => filteredAthleteRows.find((row) => row.uid === selectedUid) ?? null,
    [filteredAthleteRows, selectedUid]
  );

  const handleSelectAthlete = useCallback(
    (row: RosterEntry) => {
      if (!row.uid) return;
      setSelectedUid(row.uid);
      setDetailModalOpen(true);
      if (isCoach) {
        setActiveAthlete({
          uid: row.uid,
          firstName: row.firstName ?? undefined,
          lastName: row.lastName ?? undefined,
          team: activeTeamSelection || row.team || null,
          unit: row.unit ?? undefined,
        });
      }
    },
    [activeTeamSelection, isCoach, setActiveAthlete]
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

        // Load attendance breakdown
        const team = activeTeamSelection || resolvedProfile.team;
        if (team) {
          try {
            const sheet = await loadAttendanceSheet(team);
            const athlete = sheet.athletes.find((a) => a.uid === selectedUid);
            if (athlete && active) {
              const records = sheet.records[athlete.id] ?? {};
              const sortedDates = [...sheet.dates].sort((a, b) => b.localeCompare(a));
              const dateEntries = sortedDates.map((d) => ({ date: d, present: records[d] === true }));
              const present = dateEntries.filter((d) => d.present).length;
              setDetailAttendance({ present, total: sheet.dates.length, dates: dateEntries });
            } else if (active) {
              setDetailAttendance(null);
            }
          } catch {
            if (active) setDetailAttendance(null);
          }
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
    <div className="space-y-1">
      {editingName ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="border rounded-xl px-2 py-1 text-sm w-28"
            value={nameDraft.firstName}
            onChange={(e) => setNameDraft((p) => ({ ...p, firstName: e.target.value }))}
            placeholder="First"
          />
          <input
            className="border rounded-xl px-2 py-1 text-sm w-32"
            value={nameDraft.lastName}
            onChange={(e) => setNameDraft((p) => ({ ...p, lastName: e.target.value }))}
            placeholder="Last"
          />
          <button
            className="btn px-3 py-1 text-xs bg-green-50 text-green-700 border-green-200"
            onClick={handleSaveName}
            disabled={nameSaving}
          >
            {nameSaving ? "Saving..." : "Save"}
          </button>
          <button
            className="btn px-3 py-1 text-xs"
            onClick={handleCancelEditName}
            disabled={nameSaving}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold">
            Review: {detailProfile?.firstName} {detailProfile?.lastName}
          </h3>
          {isCoach && detailProfile && (
            <button
              className="text-xs text-brand-600 hover:text-brand-800 underline"
              onClick={handleStartEditName}
            >
              Edit Name
            </button>
          )}
        </div>
      )}
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
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2 text-sm">
            <span className="text-gray-500">Team: <span className="font-semibold text-gray-900">{formatTeamLabel(activeTeamSelection || detailProfile.team, "-")}</span></span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Unit: <span className="font-semibold text-gray-900">{detailProfile.unit ?? "-"}</span></span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Code: <span className="font-mono font-semibold text-gray-900">{detailProfile.accessCode ?? "-"}</span></span>
            <span className="text-gray-300">|</span>
            <span className="text-gray-500">Created: <span className="font-semibold text-gray-900">{detailProfile.createdAt ? new Date(detailProfile.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-"}</span></span>
          </div>

          {/* Athlete Profile & Combine Metrics */}
          {(isCoach || isAdminUser) && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 mt-3">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-2.5 text-left"
                onClick={() => setProfilePanelOpen((v) => !v)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-sm font-semibold text-violet-900">Athlete Profile &amp; Combine Metrics</span>
                  {!profilePanelOpen && (
                    <span className="text-xs text-violet-600 truncate hidden sm:block">
                      {[
                        detailProfile.height != null && `${detailProfile.height}${detailProfile.unit === "kg" ? "cm" : "in"}`,
                        detailProfile.weight != null && `${detailProfile.weight}${detailProfile.unit}`,
                        detailProfile.dash40 != null && `${detailProfile.dash40}s 40yd`,
                        detailProfile.benchReps != null && `${detailProfile.benchReps}r@${detailProfile.benchRepsWeight ?? 185}`,
                        (detailProfile.broadJumpFt != null || detailProfile.broadJumpIn != null) &&
                          `${detailProfile.broadJumpFt ?? 0}'${detailProfile.broadJumpIn ?? 0}" BJ`,
                        detailProfile.verticalJump != null && `${detailProfile.verticalJump}" VJ`,
                        detailProfile.threeCone != null && `${detailProfile.threeCone}s 3cone`,
                        detailProfile.shuttle != null && `${detailProfile.shuttle}s shuttle`,
                      ].filter(Boolean).join(" · ") || "No data yet"}
                    </span>
                  )}
                </div>
                <span className="text-violet-500 text-xs ml-2 flex-shrink-0">{profilePanelOpen ? "▲ Close" : "▼ Edit"}</span>
              </button>

              {profilePanelOpen && (
                <div className="px-4 pb-4 space-y-4 border-t border-violet-200 pt-3">
                  {/* Basic measurements */}
                  <div>
                    <div className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-2">Measurements</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Height ({detailProfile.unit === "kg" ? "cm" : "in"})</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.height ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, height: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder={detailProfile.unit === "kg" ? "e.g. 178" : "e.g. 70"}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Weight ({detailProfile.unit})</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.weight ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, weight: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder={detailProfile.unit === "kg" ? "e.g. 82" : "e.g. 185"}
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Grad Year</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="numeric"
                          value={profileEditDraft.graduationYear ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, graduationYear: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 2026"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Combine metrics */}
                  <div>
                    <div className="text-xs font-semibold text-violet-700 uppercase tracking-wide mb-2">Combine Metrics</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">40-Yd Dash (sec)</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.dash40 ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, dash40: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 4.52"
                        />
                      </label>

                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Bench Press Reps</span>
                        <div className="flex gap-1">
                          <select
                            className="border rounded-lg px-1.5 py-1.5 text-sm flex-shrink-0"
                            value={profileEditDraft.benchRepsWeight ?? 185}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, benchRepsWeight: Number(e.target.value) }))}
                          >
                            <option value={135}>135</option>
                            <option value={185}>185</option>
                            <option value={225}>225</option>
                          </select>
                          <input
                            className="border rounded-lg px-2 py-1.5 text-sm w-full"
                            inputMode="numeric"
                            value={profileEditDraft.benchReps ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, benchReps: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="Reps"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Broad Jump</span>
                        <div className="flex gap-1 items-center">
                          <input
                            className="border rounded-lg px-2 py-1.5 text-sm w-full"
                            inputMode="numeric"
                            value={profileEditDraft.broadJumpFt ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, broadJumpFt: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="ft"
                          />
                          <span className="text-xs text-gray-400 flex-shrink-0">ft</span>
                          <input
                            className="border rounded-lg px-2 py-1.5 text-sm w-full"
                            inputMode="numeric"
                            value={profileEditDraft.broadJumpIn ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, broadJumpIn: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="in"
                          />
                          <span className="text-xs text-gray-400 flex-shrink-0">in</span>
                        </div>
                      </div>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Vertical Jump (in)</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.verticalJump ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, verticalJump: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 28.5"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">3-Cone (sec)</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.threeCone ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, threeCone: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 7.04"
                        />
                      </label>

                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium text-gray-700">Shuttle (sec)</span>
                        <input
                          className="border rounded-lg px-2 py-1.5 text-sm"
                          inputMode="decimal"
                          value={profileEditDraft.shuttle ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, shuttle: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 4.14"
                        />
                      </label>
                    </div>
                  </div>

                  <button
                    className="btn btn-primary text-sm px-4 py-1.5"
                    onClick={handleSaveProfileMetrics}
                    disabled={profileSaving}
                  >
                    {profileSaving ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Attendance Breakdown */}
          {detailAttendance && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-emerald-900">
                  Attendance
                </div>
                <div className="text-sm font-bold text-emerald-700">
                  {detailAttendance.present} / {detailAttendance.total}
                </div>
              </div>
              {detailAttendance.total > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-emerald-700 mb-1">
                    <span>{Math.round((detailAttendance.present / detailAttendance.total) * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-emerald-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${(detailAttendance.present / detailAttendance.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              {detailAttendance.dates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {detailAttendance.dates.map((entry) => (
                    <span
                      key={entry.date}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        entry.present
                          ? "bg-emerald-100 text-emerald-700 border border-emerald-300"
                          : "bg-red-50 text-red-600 border border-red-200"
                      }`}
                      title={entry.date}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${entry.present ? "bg-emerald-500" : "bg-red-400"}`} />
                      {new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

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
                    const isSaving = tmSaving === summary.lift;
                    const latest = summary.latest;
                    const isRemax = latest?.type === "remax";
                    const latestMeta = latest
                      ? isRemax
                        ? ""
                        : [`C${latest.cycle ?? 1} W${latest.week}`, latest.pr ? "PR" : ""]
                            .filter(Boolean)
                            .join(" / ")
                      : "";
                    return (
                      <tr key={summary.lift} className="border-t">
                        <td className="p-2 capitalize font-medium text-gray-800">
                          {summary.label}
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
                            ? `${formatWeight(
                                roundToPlate(
                                  summary.bestEst.value,
                                  summary.bestEst.unit,
                                  summary.bestEst.unit === "lb" ? 5 : 2.5
                                )
                              )} ${summary.bestEst.unit}`
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
                              {isRemax ? (
                                <>
                                  <div className="font-semibold text-purple-700">Remax</div>
                                  <div>
                                    Est 1RM:{" "}
                                    {latest.est1rm
                                      ? `${roundToPlate(latest.est1rm, latest.unit, latest.unit === "lb" ? 5 : 2.5)} ${latest.unit}`
                                      : "-"}
                                  </div>
                                  <div>
                                    TM:{" "}
                                    {latest.tm
                                      ? `${latest.tm} ${latest.unit}`
                                      : "-"}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div>
                                    {latest.amrap?.weight ?? 0} {latest.unit} x{" "}
                                    {latest.amrap?.reps ?? 0}
                                  </div>
                                  {latestMeta && (
                                    <div className="text-gray-500">{latestMeta}</div>
                                  )}
                                </>
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

          {isCoach && (
            <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-indigo-900">Log Session for Athlete</div>
                <button
                  className="text-xs text-indigo-600 hover:text-indigo-800 underline"
                  onClick={() => setLogSessionOpen((v) => !v)}
                >
                  {logSessionOpen ? "Cancel" : "+ Log Session"}
                </button>
              </div>
              {logSessionOpen && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-indigo-800">Lift</span>
                      <select
                        className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        value={logSessionDraft.lift}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, lift: e.target.value as LiftKey }))}
                      >
                        {LIFT_KEYS.map((k) => (
                          <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-indigo-800">Week</span>
                      <select
                        className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        value={logSessionDraft.week}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, week: Number(e.target.value) as Week }))}
                      >
                        {[1, 2, 3].map((w) => <option key={w} value={w}>Week {w}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-indigo-800">Cycle</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        value={logSessionDraft.cycle}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, cycle: Number(e.target.value) }))}
                      />
                    </label>
                    <div />
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-indigo-800">AMRAP Weight ({detailProfile?.unit})</span>
                      <input
                        type="number"
                        min={0}
                        className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        value={logSessionDraft.amrapWeight}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, amrapWeight: e.target.value }))}
                        placeholder="e.g. 185"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-indigo-800">AMRAP Reps</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="rounded-lg border border-indigo-300 bg-white px-2 py-1 text-sm"
                        value={logSessionDraft.amrapReps}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, amrapReps: e.target.value }))}
                        placeholder="e.g. 5"
                      />
                    </label>
                  </div>
                  <button
                    className="btn btn-primary text-sm px-4 py-1.5"
                    onClick={handleLogSession}
                    disabled={logSessionSaving}
                  >
                    {logSessionSaving ? "Saving..." : "Save Session"}
                  </button>
                </div>
              )}
            </div>
          )}

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
                            ) : session.type === "remax" ? (
                              <span className="inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">
                                Remax
                              </span>
                            ) : (
                              `Cycle ${session.cycle ?? 1} / Week ${session.week}`
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            {session.type === "remax" ? (
                              (session.amrap?.weight ?? 0) > 0
                                ? `${session.amrap?.weight ?? 0} ${session.unit} × ${session.amrap?.reps ?? 0}`
                                : "-"
                            ) : isEditing ? (
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
                              ? `${roundToPlate(
                                  session.est1rm,
                                  session.unit,
                                  session.unit === "lb" ? 5 : 2.5
                                )} ${session.unit}`
                              : "-"}
                            {session.type === "remax" && session.tm ? (
                              <div className="text-xs font-normal text-gray-500">
                                TM: {session.tm} {session.unit}
                              </div>
                            ) : null}
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
            If This Says "Missing Or Insufficient Permissions", Create Firestore <code>{'roles/{uid}'}</code> With <code>{"{ roles: [\"coach\"], updatedAt: serverTimestamp() }"}</code>, Then Publish Rules.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <ConfirmModal
        isOpen={deleteConfirm !== null}
        title={deleteConfirm?.kind === "coach" ? "Remove Coach" : "Delete Athlete"}
        message={
          deleteConfirm?.kind === "coach"
            ? `Remove ${deleteConfirm.row.firstName ?? "this coach"}? This will revoke access and queue account deletion.`
            : `Delete ${deleteConfirm?.row.firstName ?? "this athlete"} from roster? This clears their profile and sessions.`
        }
        confirmLabel="Delete"
        onConfirm={() => deleteConfirm && doDelete(deleteConfirm.row, deleteConfirm.kind)}
        onCancel={() => setDeleteConfirm(null)}
        variant="danger"
      />
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

      <div className="card !py-2 !px-3">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
          <h3 className="text-sm font-semibold text-gray-700">Coaches <span className="text-xs font-normal text-gray-400">({filteredCoachRows.length})</span></h3>
          {!isAdminUser && coachTeam && (
            <div className="flex items-center gap-1">
              <div className="inline-flex rounded border border-gray-200 p-0.5 gap-0.5">
                <button
                  onClick={() => setCoachLevelFilter("varsity")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    coachLevelFilter === "varsity"
                      ? "bg-brand-500 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  Varsity
                </button>
                <button
                  onClick={() => setCoachLevelFilter("juniorHigh")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    coachLevelFilter === "juniorHigh"
                      ? "bg-brand-500 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  JH
                </button>
                <button
                  onClick={() => setCoachLevelFilter("both")}
                  className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
                    coachLevelFilter === "both"
                      ? "bg-brand-500 text-white"
                      : "text-gray-500 hover:bg-gray-100"
                  }`}
                >
                  All
                </button>
              </div>
            </div>
          )}
          {isAdminUser && (
            <label className="flex items-center gap-1 text-[10px] text-gray-500">
              <select
                className="field !text-[10px] !py-0.5 !px-1"
                value={adminCoachFilter}
                onChange={(event) => setAdminCoachFilter(event.target.value as Team | "all")}
              >
                <option value="all">All Teams</option>
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
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                <th className="py-1 px-1.5 text-left font-medium">Name</th>
                <th className="py-1 px-1.5 text-left font-medium">Access</th>
                <th className="py-1 px-1.5 text-left font-medium">Team</th>
                {isAdminUser && <th className="py-1 px-1.5 text-left font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {filteredCoachRows.map((r) => {
                const rolesList = normalizeRoles(r.roles);
                const admin = rolesList.includes("admin");
                return (
                  <tr
                    key={r.uid}
                    className={`border-t border-gray-100 ${admin ? "bg-purple-50/40" : ""}`}
                  >
                    <td className="py-1 px-1.5 font-medium text-gray-700">{r.firstName || "-"} {r.lastName || ""}</td>
                    <td className="py-1 px-1.5">
                      <RoleBadges roles={r.roles} />
                    </td>
                    <td className="py-1 px-1.5 text-gray-500">{formatTeamLabel(r.team, "-")}</td>
                    {isAdminUser && (
                      <td className="py-1 px-1.5">
                        <button
                          type="button"
                          className="text-[10px] text-red-600 hover:text-red-800"
                          onClick={() => handleDelete(r, "coach")}
                          disabled={deleteUid === r.uid}
                        >
                          {deleteUid === r.uid ? "..." : "Remove"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filteredCoachRows.length === 0 && (
                <tr>
                  <td className="py-1 px-1.5 text-gray-400" colSpan={isAdminUser ? 4 : 3}>
                    No coaches found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Live Activity Feed */}
      {liveSessionFeed.length > 0 && (
        <div className="card !py-2 !px-3">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
            </span>
            <h3 className="text-sm font-semibold text-gray-700">Live Activity</h3>
            <span className="text-[10px] text-gray-400">{liveSessionFeed.length} session{liveSessionFeed.length !== 1 ? "s" : ""} today</span>
          </div>
          <div className="overflow-x-auto max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-[10px] text-gray-400 uppercase tracking-wide">
                  <th className="py-1 px-1.5 text-left font-medium">Athlete</th>
                  <th className="py-1 px-1.5 text-left font-medium">Lift</th>
                  <th className="py-1 px-1.5 text-center font-medium">Wk</th>
                  <th className="py-1 px-1.5 text-right font-medium">AMRAP</th>
                  <th className="py-1 px-1.5 text-right font-medium">Est 1RM</th>
                  <th className="py-1 px-1.5 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {liveSessionFeed.slice(0, 20).map((session, idx) => {
                  const athlete = rows.find(r => r.uid === session.athleteId);
                  const name = athlete
                    ? `${athlete.firstName} ${athlete.lastName}`.trim()
                    : session.athleteId.slice(0, 8);
                  const timeAgo = session.createdAt
                    ? formatTimeAgo(session.createdAt)
                    : "";
                  const liftColor =
                    session.lift === "squat" ? "bg-red-500"
                    : session.lift === "bench" ? "bg-blue-500"
                    : "bg-green-600";
                  return (
                    <tr
                      key={`${session.id}-${idx}`}
                      className="border-t border-gray-100 hover:bg-gray-50/60 transition-colors"
                    >
                      <td className="py-1 px-1.5 font-medium text-gray-700 whitespace-nowrap">
                        {name}
                        {session.pr && <span className="ml-1 text-yellow-500 text-[10px]" title="PR">&#9733;</span>}
                      </td>
                      <td className="py-1 px-1.5 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${liftColor}`}></span>
                          <span className="capitalize text-gray-600">{session.lift}</span>
                        </span>
                      </td>
                      <td className="py-1 px-1.5 text-center text-gray-500">{session.week}</td>
                      <td className="py-1 px-1.5 text-right text-gray-600 tabular-nums whitespace-nowrap">
                        {session.amrap ? `${session.amrap.weight}×${session.amrap.reps}` : "-"}
                      </td>
                      <td className="py-1 px-1.5 text-right font-medium text-gray-700 tabular-nums">
                        {session.est1rm ? Math.round(session.est1rm) : "-"}
                      </td>
                      <td className="py-1 px-1.5 text-right text-gray-400 whitespace-nowrap">{timeAgo}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Athletes</h3>
              <p className="text-xs text-gray-500">
                Click A Row To Review Recent Sessions And TM Numbers.
              </p>
            </div>
            {(isCoach || isAdminUser) && (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={openAddAthlete}
                  disabled={addAthleteSaving}
                >
                  Add Athlete
                </button>
                {isAdminUser && (
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={handleBackfillDates}
                    disabled={backfillRunning}
                  >
                    {backfillRunning ? "Backfilling..." : "Backfill Dates"}
                  </button>
                )}
                {isMobileLayout && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setShowAthleteTableOnMobile((prev) => !prev)}
                  >
                    {showAthleteTableOnMobile
                      ? "Mobile Card View"
                      : "Desktop Table View"}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Backfill Result */}
          {backfillResult && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <strong>Backfill Complete:</strong> {backfillResult.updated} updated, {backfillResult.skipped} skipped
              {backfillResult.errors > 0 && `, ${backfillResult.errors} errors`}
            </div>
          )}

          {/* Search and Filter Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
            {/* Search Box */}
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <input
                  id="athlete-search"
                  name="search"
                  type="text"
                  placeholder="Search Athletes..."
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
                <label htmlFor="roster-team-filter" className="text-xs text-gray-600 font-medium">Team:</label>
                <select
                  id="roster-team-filter"
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

            {(isCoach || isAdminUser) && (
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <span>Sort</span>
                <select
                  className="field !text-xs"
                  value={`${sortField ?? "lastName"}:${sortDirection}`}
                  onChange={(event) => applySortSelection(event.target.value)}
                >
                  <option value="lastName:asc">Last (A-Z)</option>
                  <option value="lastName:desc">Last (Z-A)</option>
                  <option value="firstName:asc">First (A-Z)</option>
                  <option value="firstName:desc">First (Z-A)</option>
                  <option value="lastWorkout:desc">Last Workout (Newest)</option>
                  <option value="lastWorkout:asc">Last Workout (Oldest)</option>
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
                  <label htmlFor="add-athlete-firstname" className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    First name
                    <input
                      id="add-athlete-firstname"
                      name="firstName"
                      type="text"
                      autoComplete="given-name"
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
                  <label htmlFor="add-athlete-lastname" className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    Last name
                    <input
                      id="add-athlete-lastname"
                      name="lastName"
                      type="text"
                      autoComplete="family-name"
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
                  <label htmlFor="add-athlete-team" className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    Team
                    <select
                      id="add-athlete-team"
                      name="team"
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
                  <label htmlFor="add-athlete-code" className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                    4-digit code
                    <input
                      id="add-athlete-code"
                      name="accessCode"
                      className="field text-center font-semibold tracking-widest"
                      type="tel"
                      autoComplete="off"
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

        {useMobileAthleteCards && (
          <div className="space-y-2">
            {filteredAthleteRows.map((r, index) => {
              const selected = selectedUid === r.uid;
              const rowKey = r.uid ? `${r.uid}-${index}` : `row-${index}`;
              const activity = activityMap[r.uid];
              const lastWorkoutDateKey =
                typeof activity?.lastWorkout === "number" && Number.isFinite(activity.lastWorkout)
                  ? toLocalDateKey(activity.lastWorkout)
                  : null;
              const loggedCurrentLift = Boolean(
                latestSessionDateKey &&
                lastWorkoutDateKey &&
                latestSessionDateKey === lastWorkoutDateKey
              );
              const joinedLabel = r.createdAt
                ? new Date(r.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "2-digit",
                  })
                : "-";
              const lastWorkoutLabel = loadingActivity
                ? "..."
                : activity?.lastWorkout
                ? new Date(activity.lastWorkout).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : "-";
              return (
                <div
                  key={rowKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectAthlete(r)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelectAthlete(r);
                    }
                  }}
                  className={`rounded-xl border p-3 shadow-sm transition ${
                    selected
                      ? "border-brand-300 bg-brand-50/40"
                      : "border-gray-200 bg-white hover:border-brand-200"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-900">
                        {r.firstName || "-"} {r.lastName || "-"}
                      </div>
                      <div className="text-xs text-gray-500">
                        {formatTeamLabel(r.team, "-")}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {loggedCurrentLift ? (
                        <span
                          className="inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400 shadow-[0_0_7px_2px_rgba(52,211,153,0.55)]"
                          title={
                            latestSessionDateKey
                              ? `Session logged on ${latestSessionDateKey}`
                              : "Session logged"
                          }
                        />
                      ) : (
                        <span className="text-[11px] text-gray-400">No Lift</span>
                      )}
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-700">
                        {r.accessCode ?? "--"}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                    <div>
                      Joined: <span className="font-medium text-gray-700">{joinedLabel}</span>
                    </div>
                    <div>
                      Last: <span className="font-medium text-gray-700">{lastWorkoutLabel}</span>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn px-3 py-1 text-xs"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSelectAthlete(r);
                      }}
                    >
                      Review
                    </button>
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
                    {isAdminUser ? (
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
                    ) : (
                      <span className="self-center text-xs text-gray-400">Admin Only</span>
                    )}
                  </div>
                </div>
              );
            })}
            {filteredAthleteRows.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-500">
                No athletes found for the selected team.
              </div>
            )}
          </div>
        )}

        {!useMobileAthleteCards && (
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
                <th className="p-2 text-left">Joined</th>
                <th className="p-2 text-left text-xs font-semibold">Current Lift</th>
                <th
                  className="p-2 text-left cursor-pointer hover:bg-gray-100 transition select-none"
                  onClick={() => handleSort("lastWorkout")}
                >
                  <div className="flex items-center gap-1">
                    Last Workout
                    {sortField === "lastWorkout" && (
                      <span className="text-xs">{sortDirection === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAthleteRows.map((r, index) => {
                const selected = selectedUid === r.uid;
                const rowKey = r.uid ? `${r.uid}-${index}` : `row-${index}`;
                const activity = activityMap[r.uid];
                const lastWorkoutDateKey =
                  typeof activity?.lastWorkout === "number" && Number.isFinite(activity.lastWorkout)
                    ? toLocalDateKey(activity.lastWorkout)
                    : null;
                const loggedCurrentLift = Boolean(
                  latestSessionDateKey &&
                  lastWorkoutDateKey &&
                  latestSessionDateKey === lastWorkoutDateKey
                );
                return (
                  <tr
                    key={rowKey}
                    className={`border-t cursor-pointer transition ${
                      selected ? "bg-brand-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => handleSelectAthlete(r)}
                  >
                    <td className="p-2">{r.firstName || "-"}</td>
                    <td className="p-2">{r.lastName || "-"}</td>
                    <td className="p-2">{formatTeamLabel(r.team, "-")}</td>
                    <td className="p-2 font-mono text-xs">{r.accessCode ?? "-"}</td>
                    <td className="p-2 text-xs text-gray-600">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "2-digit",
                          })
                        : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="p-2 text-center">
                      {loggedCurrentLift ? (
                        <span
                          className="inline-flex h-3.5 w-3.5 rounded-full bg-emerald-400 shadow-[0_0_7px_2px_rgba(52,211,153,0.55)]"
                          title={
                            latestSessionDateKey
                              ? `Session logged on ${latestSessionDateKey}`
                              : "Session logged"
                          }
                        />
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
                        {isAdminUser ? (
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
                        ) : (
                          <span className="text-xs text-gray-400">Admin Only</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredAthleteRows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={8}>
                    No athletes found for the selected team.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        )}
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
