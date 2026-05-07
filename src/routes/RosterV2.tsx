import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  TEAM_DEFINITIONS,
  AthleteAuthError,
  assignAthleteAccessCode,
  createAthleteAccount,
  deleteAthlete,
  deleteSession,
  defaultEquipment,
  defaultReportSettings,
  fetchAthleteSessions,
  formatTeamLabel,
  getStoredTeamSelection,
  isAdmin,
  listRoster,
  loadAttendanceSheet,
  loadProfileRemote,
  loadReportSettings,
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
  type ReportSettings,
  type RosterEntry,
  type SessionRecord,
  type Team,
} from "../lib/db";
import {
  brandedFooterHtml,
  brandedHeaderHtml,
  escapeHtml,
  pageSizeCss,
  printHtmlInIframe,
  sharedReportStyles,
} from "../lib/reportHtml";
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
            ? "border border-purple-500/40 bg-purple-500/10 text-purple-300"
            : role === "coach"
            ? "border border-v2-info-600/50 bg-v2-info-600/10 text-v2-info-300"
            : "border border-v2-surface-700 bg-v2-surface-800 text-v2-ink-300";
        return (
          <span
            key={role}
            className={`rounded-v2-sm px-2 py-0.5 text-[10px] font-v2-heading font-semibold uppercase tracking-[0.18em] ${pillClass}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

// V2 Section label with accent line
function V2SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-px w-5 bg-v2-info-600" />
      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.22em] text-v2-info-300 font-semibold">
        {children}
      </span>
    </div>
  );
}

// Month-grid calendar of attendance dates. Each session date is colored
// green (present) or red (missed); days with no session render as a faint gap.
function AttendanceCalendar({
  dates,
}: {
  dates: { date: string; present: boolean }[];
}) {
  type MonthCell = {
    key: string;
    year: number;
    month: number;
    label: string;
    map: Map<string, boolean>;
  };
  const months: MonthCell[] = useMemo(() => {
    const byMonth = new Map<string, MonthCell>();
    for (const entry of dates) {
      const [yStr, mStr, dStr] = entry.date.split("-");
      const year = Number(yStr);
      const month = Number(mStr) - 1;
      if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
      const key = `${year}-${String(month).padStart(2, "0")}`;
      let bucket = byMonth.get(key);
      if (!bucket) {
        const label = new Date(year, month, 1).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
        });
        bucket = { key, year, month, label, map: new Map() };
        byMonth.set(key, bucket);
      }
      bucket.map.set(dStr, entry.present);
    }
    return Array.from(byMonth.values()).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
  }, [dates]);

  if (months.length === 0) return null;

  const weekdayLabels = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {months.map((m) => {
        const firstDayOfWeek = new Date(m.year, m.month, 1).getDay();
        const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
        const cells: Array<{ day: number | null; present: boolean | null }> = [];
        for (let i = 0; i < firstDayOfWeek; i += 1) {
          cells.push({ day: null, present: null });
        }
        for (let day = 1; day <= daysInMonth; day += 1) {
          const key = String(day).padStart(2, "0");
          const present = m.map.has(key) ? (m.map.get(key) ?? null) : null;
          cells.push({ day, present });
        }
        // pad to full weeks
        while (cells.length % 7 !== 0) {
          cells.push({ day: null, present: null });
        }
        return (
          <div key={m.key} className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 p-1.5 inline-block">
            <div className="font-v2-heading uppercase tracking-[0.14em] text-[9px] text-v2-ink-300 font-semibold mb-1">
              {m.label}
            </div>
            <div className="grid grid-cols-7 gap-px text-center" style={{ width: "max-content" }}>
              {weekdayLabels.map((label, idx) => (
                <div
                  key={`wd-${idx}`}
                  className="font-v2-mono tabular-nums text-[7px] uppercase tracking-[0.1em] text-v2-ink-500 w-4"
                >
                  {label}
                </div>
              ))}
              {cells.map((cell, idx) => {
                if (cell.day === null) {
                  return <div key={`p-${idx}`} className="w-4 h-4" />;
                }
                const base =
                  "w-4 h-4 flex items-center justify-center rounded-sm font-v2-mono tabular-nums text-[8px] font-semibold border";
                let cls: string;
                if (cell.present === true) {
                  cls = "bg-v2-success-600/25 text-v2-success-300 border-v2-success-600/50";
                } else if (cell.present === false) {
                  cls = "bg-v2-danger-600/20 text-v2-danger-300 border-v2-danger-600/50";
                } else {
                  cls = "bg-v2-surface-900 text-v2-ink-600 border-v2-surface-800";
                }
                return (
                  <div key={`d-${m.key}-${cell.day}`} className={`${base} ${cls}`}>
                    {cell.day}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// V2 input classes
const v2FieldClass =
  "bg-v2-surface-950 border border-v2-surface-700 text-v2-ink-100 rounded-v2-sm px-3 py-2 text-v2-sm font-v2-body placeholder:text-v2-ink-500 focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 focus:border-v2-info-500 transition-colors duration-v2-quick";

const v2BtnClass =
  "inline-flex items-center justify-center min-h-touch px-4 py-2 rounded-v2-sm font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold bg-v2-surface-800 border border-v2-surface-700 text-v2-ink-100 hover:bg-v2-surface-700 focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 transition-colors duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed";

const v2BtnPrimaryClass =
  "inline-flex items-center justify-center min-h-touch px-4 py-2 rounded-v2-sm font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold bg-v2-info-600 border border-v2-info-600 text-white hover:bg-v2-info-500 focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 transition-colors duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed";

const v2BtnCtaClass =
  "inline-flex items-center justify-center min-h-touch px-4 py-2 rounded-v2-sm font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold bg-v2-accent-700 border border-v2-accent-700 text-white hover:bg-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 transition-colors duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed";

const v2BtnDangerClass =
  "inline-flex items-center justify-center min-h-touch px-3 py-1.5 rounded-v2-sm font-v2-heading text-[10px] uppercase tracking-[0.16em] font-semibold bg-transparent border border-v2-danger-600/60 text-v2-danger-300 hover:bg-v2-danger-600/10 focus:outline-none focus:ring-2 focus:ring-v2-danger-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 transition-colors duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed";

const v2BtnSmClass =
  "inline-flex items-center justify-center min-h-[32px] px-3 py-1 rounded-v2-sm font-v2-heading text-[10px] uppercase tracking-[0.16em] font-semibold bg-v2-surface-800 border border-v2-surface-700 text-v2-ink-100 hover:bg-v2-surface-700 focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 transition-colors duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed";

export default function RosterV2() {
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
  const [attendanceView, setAttendanceView] = useState<"chips" | "calendar">("chips");
  const [exportingReport, setExportingReport] = useState(false);
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
      const refreshed = await fetchAthleteSessions(detailProfile.uid, 500, activeTeamSelection || undefined);
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

  // Starting Point: earliest session per lift (sessions are stored desc, so the
  // last entry per bucket is the oldest). Captures the AMRAP weight/reps the
  // athlete first logged for each major lift, plus the overall start date.
  const startingPoints = useMemo(() => {
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
    const perLift = LIFT_KEYS.map((lift) => {
      const sessions = buckets[lift];
      const earliest = sessions.length ? sessions[sessions.length - 1] : null;
      return {
        lift,
        label: lift.charAt(0).toUpperCase() + lift.slice(1),
        earliest,
      };
    });
    let startedAt: number | null = null;
    for (const session of detailSessions) {
      const ts = session.createdAt ?? null;
      if (typeof ts === "number" && Number.isFinite(ts)) {
        if (startedAt === null || ts < startedAt) startedAt = ts;
      }
    }
    if (startedAt === null && typeof detailProfile?.createdAt === "number") {
      startedAt = detailProfile.createdAt;
    }
    return { perLift, startedAt };
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
            500,
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

  const buildAthleteReportHtml = (settings: ReportSettings): string => {
    if (!detailProfile) return "";
    const profile = detailProfile;
    const fullName = `${profile.firstName ?? ""} ${profile.lastName ?? ""}`.trim() || "Athlete";
    const teamLabel = profile.team ? formatTeamLabel(profile.team) : "";
    const generatedAt = new Date().toLocaleString();

    const identityRows: Array<[string, string]> = [];
    if (teamLabel) identityRows.push(["Team", teamLabel]);
    if (profile.graduationYear) identityRows.push(["Grad Year", String(profile.graduationYear)]);
    if (profile.height) identityRows.push(["Height", String(profile.height)]);
    if (profile.weight) identityRows.push(["Weight", String(profile.weight)]);
    if (profile.unit) identityRows.push(["Unit", profile.unit.toUpperCase()]);
    const identityHtml = identityRows.length
      ? `<table class="kv"><tbody>${identityRows
          .map(
            ([k, v]) =>
              `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`
          )
          .join("")}</tbody></table>`
      : "";

    const startedDate = startingPoints.startedAt
      ? new Date(startingPoints.startedAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : "Unknown";
    const startingRowsHtml = startingPoints.perLift
      .map((entry) => {
        const s = entry.earliest;
        if (!s) {
          return `<tr><td>${escapeHtml(entry.label)}</td><td>—</td><td>—</td><td>—</td></tr>`;
        }
        const dateStr = s.createdAt
          ? new Date(s.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "";
        return `<tr>
          <td>${escapeHtml(entry.label)}</td>
          <td>${escapeHtml(String(s.tm ?? 0))} ${escapeHtml(s.unit ?? "")}</td>
          <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
          <td>${escapeHtml(dateStr)}</td>
        </tr>`;
      })
      .join("");

    const currentRowsHtml = liftSummaries
      .map((summary) => {
        const tm = summary.tm ?? 0;
        const bestEst = summary.bestEst
          ? `${summary.bestEst.value.toFixed(1)} ${summary.bestEst.unit}`
          : "—";
        const lastDate = summary.latest?.createdAt
          ? new Date(summary.latest.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—";
        return `<tr>
          <td>${escapeHtml(summary.label)}</td>
          <td>${escapeHtml(String(tm))}</td>
          <td>${escapeHtml(bestEst)}</td>
          <td>${escapeHtml(String(summary.totalSessions))}</td>
          <td>${escapeHtml(lastDate)}</td>
        </tr>`;
      })
      .join("");

    const attendancePct = detailAttendance && detailAttendance.total > 0
      ? Math.round((detailAttendance.present / detailAttendance.total) * 100)
      : null;
    const attendanceSummaryHtml = detailAttendance
      ? `<p><strong>Sessions Attended:</strong> ${detailAttendance.present} / ${detailAttendance.total}${attendancePct !== null ? ` (${attendancePct}%)` : ""}</p>`
      : `<p><em>No attendance data.</em></p>`;

    const prSessions = detailSessions.filter((s) => s.pr);
    const prRowsHtml = prSessions
      .slice(0, 25)
      .map((s) => {
        const dateStr = s.createdAt
          ? new Date(s.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—";
        return `<tr>
          <td>${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(s.lift ?? "")}</td>
          <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
          <td>${escapeHtml(s.est1rm ? s.est1rm.toFixed(1) : "—")}</td>
        </tr>`;
      })
      .join("");
    const prSectionHtml = prSessions.length
      ? `<h2>Personal Records</h2>
         <table>
           <thead><tr><th>Date</th><th>Lift</th><th>AMRAP</th><th>Est 1RM</th></tr></thead>
           <tbody>${prRowsHtml}</tbody>
         </table>`
      : "";

    const sessionRowsHtml = detailSessions
      .map((s) => {
        const dateStr = s.createdAt
          ? new Date(s.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "—";
        const cycleWeek =
          s.cycle != null && s.week != null ? `C${s.cycle} W${s.week}` : "";
        return `<tr>
          <td>${escapeHtml(dateStr)}</td>
          <td>${escapeHtml(s.lift ?? "")}</td>
          <td>${escapeHtml(cycleWeek)}</td>
          <td>${escapeHtml(String(s.amrap?.weight ?? 0))} ${escapeHtml(s.unit ?? "")} × ${escapeHtml(String(s.amrap?.reps ?? 0))}</td>
          <td>${escapeHtml(s.est1rm ? s.est1rm.toFixed(1) : "—")}</td>
          <td>${s.pr ? "★" : ""}</td>
        </tr>`;
      })
      .join("");

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(fullName)} — Athlete Report</title>
    <style>
      @page { size: ${pageSizeCss(settings)}; margin: 0.2in 0.5in; }
      ${sharedReportStyles}
      body { margin: 0; }
      table.kv { width: auto; }
      table.kv th { background: #f8fafc; font-weight: 600; text-align: left; min-width: 90px; }
      .meta { display: flex; gap: 18px; flex-wrap: wrap; margin: 6px 0 14px 0; font-size: 12px; color: #4b5563; }
      .section { margin-bottom: 16px; }
    </style>
  </head>
  <body>
    ${brandedHeaderHtml(settings)}
    <h1>${escapeHtml(fullName)}</h1>
    <div class="meta">
      ${teamLabel ? `<span><strong>Team:</strong> ${escapeHtml(teamLabel)}</span>` : ""}
      <span><strong>Started:</strong> ${escapeHtml(startedDate)}</span>
      <span><strong>Generated:</strong> ${escapeHtml(generatedAt)}</span>
    </div>

    ${identityHtml ? `<div class="section">${identityHtml}</div>` : ""}

    <div class="section">
      <h2>Starting Point</h2>
      <table>
        <thead><tr><th>Lift</th><th>Starting TM</th><th>Starting AMRAP</th><th>First Logged</th></tr></thead>
        <tbody>${startingRowsHtml}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Now</h2>
      <table>
        <thead><tr><th>Lift</th><th>Current TM</th><th>Best Est 1RM</th><th>Total Sessions</th><th>Last Session</th></tr></thead>
        <tbody>${currentRowsHtml}</tbody>
      </table>
    </div>

    <div class="section">
      <h2>Attendance</h2>
      ${attendanceSummaryHtml}
    </div>

    ${prSectionHtml ? `<div class="section">${prSectionHtml}</div>` : ""}

    <div class="section">
      <h2>Session Log</h2>
      <table>
        <thead><tr><th>Date</th><th>Lift</th><th>Cycle/Week</th><th>AMRAP</th><th>Est 1RM</th><th>PR</th></tr></thead>
        <tbody>${sessionRowsHtml}</tbody>
      </table>
    </div>

    ${brandedFooterHtml(settings)}
  </body>
</html>`;
  };

  const handleExportAthleteReport = async () => {
    if (!detailProfile || exportingReport) return;
    const team = activeTeamSelection || detailProfile.team;
    setExportingReport(true);
    try {
      const settings = team
        ? await loadReportSettings(team).catch(() => defaultReportSettings(team))
        : defaultReportSettings();
      const html = buildAthleteReportHtml(settings);
      if (!html) {
        setFlash({ kind: "error", text: "No athlete data to export." });
        return;
      }
      await printHtmlInIframe(html);
    } catch (err: any) {
      setFlash({ kind: "error", text: err?.message ?? "Could not generate report." });
    } finally {
      setExportingReport(false);
    }
  };

  const detailHeader = (
    <div className="space-y-2">
      {editingName ? (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${v2FieldClass} w-32`}
            value={nameDraft.firstName}
            onChange={(e) => setNameDraft((p) => ({ ...p, firstName: e.target.value }))}
            placeholder="First"
          />
          <input
            className={`${v2FieldClass} w-36`}
            value={nameDraft.lastName}
            onChange={(e) => setNameDraft((p) => ({ ...p, lastName: e.target.value }))}
            placeholder="Last"
          />
          <button
            className={v2BtnPrimaryClass}
            onClick={handleSaveName}
            disabled={nameSaving}
          >
            {nameSaving ? "Saving..." : "Save"}
          </button>
          <button
            className={v2BtnClass}
            onClick={handleCancelEditName}
            disabled={nameSaving}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <V2SectionLabel>Athlete Review</V2SectionLabel>
          <h3 className="font-v2-heading text-v2-xl font-semibold text-v2-ink-50 uppercase tracking-tight">
            {detailProfile?.firstName} {detailProfile?.lastName}
          </h3>
          {isCoach && detailProfile && (
            <button
              className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-info-300 hover:text-v2-info-200 underline underline-offset-4"
              onClick={handleStartEditName}
            >
              Edit Name
            </button>
          )}
          {isCoach && detailProfile && (
            <button
              className={v2BtnPrimaryClass}
              onClick={handleExportAthleteReport}
              disabled={exportingReport}
            >
              {exportingReport ? "Generating..." : "Generate Report"}
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
        <div className="rounded-v2-md border border-v2-danger-600/60 bg-v2-danger-600/10 px-4 py-3 text-v2-sm text-v2-danger-300 font-v2-body">
          {detailError}
        </div>
      )}

      {!detailLoading && !detailError && detailProfile && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 px-4 py-3 text-v2-sm font-v2-body">
            <span className="text-v2-ink-400">
              <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] mr-2">Team</span>
              <span className="font-semibold text-v2-ink-50">{formatTeamLabel(activeTeamSelection || detailProfile.team, "-")}</span>
            </span>
            <span className="h-4 w-px bg-v2-surface-700" />
            <span className="text-v2-ink-400">
              <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] mr-2">Unit</span>
              <span className="font-semibold text-v2-ink-50 font-v2-mono tabular-nums">{detailProfile.unit ?? "-"}</span>
            </span>
            <span className="h-4 w-px bg-v2-surface-700" />
            <span className="text-v2-ink-400">
              <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] mr-2">Code</span>
              <span className="font-v2-mono tabular-nums font-semibold text-v2-info-300">{detailProfile.accessCode ?? "-"}</span>
            </span>
            <span className="h-4 w-px bg-v2-surface-700" />
            <span className="text-v2-ink-400">
              <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] mr-2">Created</span>
              <span className="font-semibold text-v2-ink-50 font-v2-mono tabular-nums">{detailProfile.createdAt ? new Date(detailProfile.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "-"}</span>
            </span>
          </div>

          {/* Athlete Profile & Combine Metrics */}
          {(isCoach || isAdminUser) && (
            <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 mt-4">
              <button
                type="button"
                className="w-full flex items-center justify-between px-4 py-3 text-left min-h-touch focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 rounded-v2-md transition-colors duration-v2-quick hover:bg-v2-surface-800/50"
                onClick={() => setProfilePanelOpen((v) => !v)}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <V2SectionLabel>Profile &amp; Combine</V2SectionLabel>
                  {!profilePanelOpen && (
                    <span className="text-v2-xs text-v2-ink-400 truncate hidden sm:block font-v2-mono tabular-nums">
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
                <span className="text-v2-info-300 text-v2-xs ml-2 flex-shrink-0 font-v2-heading uppercase tracking-[0.18em]">{profilePanelOpen ? "Close" : "Edit"}</span>
              </button>

              {profilePanelOpen && (
                <div className="px-4 pb-4 space-y-5 border-t border-v2-surface-800 pt-4">
                  {/* Basic measurements */}
                  <div>
                    <div className="mb-3"><V2SectionLabel>Measurements</V2SectionLabel></div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Height ({detailProfile.unit === "kg" ? "cm" : "in"})</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.height ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, height: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder={detailProfile.unit === "kg" ? "e.g. 178" : "e.g. 70"}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Weight ({detailProfile.unit})</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.weight ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, weight: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder={detailProfile.unit === "kg" ? "e.g. 82" : "e.g. 185"}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Grad Year</span>
                        <input
                          className={v2FieldClass}
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
                    <div className="mb-3"><V2SectionLabel>Combine Metrics</V2SectionLabel></div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">40-Yd Dash (sec)</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.dash40 ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, dash40: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 4.52"
                        />
                      </label>

                      <div className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Bench Press Reps</span>
                        <div className="flex gap-1.5">
                          <select
                            className={`${v2FieldClass} flex-shrink-0 w-20`}
                            value={profileEditDraft.benchRepsWeight ?? 185}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, benchRepsWeight: Number(e.target.value) }))}
                          >
                            <option value={135}>135</option>
                            <option value={185}>185</option>
                            <option value={225}>225</option>
                          </select>
                          <input
                            className={`${v2FieldClass} w-full`}
                            inputMode="numeric"
                            value={profileEditDraft.benchReps ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, benchReps: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="Reps"
                          />
                        </div>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Broad Jump</span>
                        <div className="flex gap-1.5 items-center">
                          <input
                            className={`${v2FieldClass} w-full`}
                            inputMode="numeric"
                            value={profileEditDraft.broadJumpFt ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, broadJumpFt: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="ft"
                          />
                          <span className="text-v2-xs text-v2-ink-500 flex-shrink-0 font-v2-mono">ft</span>
                          <input
                            className={`${v2FieldClass} w-full`}
                            inputMode="numeric"
                            value={profileEditDraft.broadJumpIn ?? ""}
                            onChange={(e) => setProfileEditDraft((p) => ({ ...p, broadJumpIn: e.target.value === "" ? undefined : Number(e.target.value) }))}
                            placeholder="in"
                          />
                          <span className="text-v2-xs text-v2-ink-500 flex-shrink-0 font-v2-mono">in</span>
                        </div>
                      </div>

                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Vertical Jump (in)</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.verticalJump ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, verticalJump: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 28.5"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">3-Cone (sec)</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.threeCone ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, threeCone: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 7.04"
                        />
                      </label>

                      <label className="flex flex-col gap-1.5">
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Shuttle (sec)</span>
                        <input
                          className={v2FieldClass}
                          inputMode="decimal"
                          value={profileEditDraft.shuttle ?? ""}
                          onChange={(e) => setProfileEditDraft((p) => ({ ...p, shuttle: e.target.value === "" ? undefined : Number(e.target.value) }))}
                          placeholder="e.g. 4.14"
                        />
                      </label>
                    </div>
                  </div>

                  <button
                    className={v2BtnPrimaryClass}
                    onClick={handleSaveProfileMetrics}
                    disabled={profileSaving}
                  >
                    {profileSaving ? "Saving..." : "Save Profile"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Starting Point */}
          {(startingPoints.startedAt || startingPoints.perLift.some((p) => p.earliest)) && (
            <div className="rounded-v2-md border border-v2-info-600/40 bg-v2-surface-900 p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <V2SectionLabel>Starting Point</V2SectionLabel>
                {startingPoints.startedAt && (
                  <div className="font-v2-mono tabular-nums text-v2-xs text-v2-ink-300">
                    Started {new Date(startingPoints.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </div>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {startingPoints.perLift.map((entry) => {
                  const s = entry.earliest;
                  const weight = s?.amrap?.weight ?? 0;
                  const reps = s?.amrap?.reps ?? 0;
                  const tm = s?.tm ?? 0;
                  return (
                    <div
                      key={entry.lift}
                      className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 p-3"
                    >
                      <div className="font-v2-heading uppercase tracking-[0.16em] text-v2-xs text-v2-ink-400 font-semibold mb-1.5">
                        {entry.label}
                      </div>
                      {s ? (
                        <>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-v2-heading uppercase tracking-[0.12em] text-[9px] text-v2-ink-500 font-semibold">TM</span>
                              <span className="font-v2-mono tabular-nums text-v2-base font-semibold text-v2-ink-50">
                                {tm} <span className="text-[10px] text-v2-ink-400">{s.unit}</span>
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="font-v2-heading uppercase tracking-[0.12em] text-[9px] text-v2-ink-500 font-semibold">AMRAP</span>
                              <span className="font-v2-mono tabular-nums text-v2-base font-semibold text-v2-ink-50">
                                {weight} <span className="text-[10px] text-v2-ink-400">{s.unit}</span> <span className="text-v2-sm text-v2-ink-400">×{reps}</span>
                              </span>
                            </div>
                          </div>
                          <div className="font-v2-mono tabular-nums text-[10px] text-v2-ink-500 mt-1.5 pt-1.5 border-t border-v2-surface-800">
                            {s.createdAt
                              ? new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                              : ""}
                          </div>
                        </>
                      ) : (
                        <div className="font-v2-mono tabular-nums text-v2-sm text-v2-ink-500">—</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Attendance Breakdown */}
          {detailAttendance && (
            <div className="rounded-v2-md border border-v2-success-600/40 bg-v2-surface-900 p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <V2SectionLabel>Attendance</V2SectionLabel>
                <div className="flex items-center gap-3">
                  <div className="inline-flex rounded-v2-sm border border-v2-surface-700 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setAttendanceView("chips")}
                      className={`px-2.5 py-1 text-[10px] font-v2-heading uppercase tracking-[0.14em] font-semibold transition-colors duration-v2-quick ${
                        attendanceView === "chips"
                          ? "bg-v2-info-600 text-white"
                          : "bg-v2-surface-900 text-v2-ink-300 hover:bg-v2-surface-800"
                      }`}
                    >
                      Chips
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttendanceView("calendar")}
                      className={`px-2.5 py-1 text-[10px] font-v2-heading uppercase tracking-[0.14em] font-semibold transition-colors duration-v2-quick border-l border-v2-surface-700 ${
                        attendanceView === "calendar"
                          ? "bg-v2-info-600 text-white"
                          : "bg-v2-surface-900 text-v2-ink-300 hover:bg-v2-surface-800"
                      }`}
                    >
                      Calendar
                    </button>
                  </div>
                  <div className="font-v2-mono tabular-nums text-v2-base font-semibold text-v2-success-300">
                    {detailAttendance.present} / {detailAttendance.total}
                  </div>
                </div>
              </div>
              {detailAttendance.total > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-v2-xs text-v2-ink-400 mb-1.5 font-v2-mono tabular-nums">
                    <span>{Math.round((detailAttendance.present / detailAttendance.total) * 100)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-v2-surface-800 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-v2-success-600 transition-all duration-v2-quick"
                      style={{ width: `${(detailAttendance.present / detailAttendance.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
              {detailAttendance.dates.length > 0 && attendanceView === "chips" && (
                <div className="flex flex-wrap gap-1.5">
                  {detailAttendance.dates.map((entry) => (
                    <span
                      key={entry.date}
                      className={`inline-flex items-center gap-1 rounded-v2-sm px-2 py-0.5 text-[10px] font-v2-mono tabular-nums border ${
                        entry.present
                          ? "bg-v2-success-600/10 text-v2-success-300 border-v2-success-600/40"
                          : "bg-v2-danger-600/10 text-v2-danger-300 border-v2-danger-600/40"
                      }`}
                      title={entry.date}
                    >
                      <span className={`inline-block h-1.5 w-1.5 rounded-full ${entry.present ? "bg-v2-success-600" : "bg-v2-danger-600"}`} />
                      {new Date(`${entry.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  ))}
                </div>
              )}
              {detailAttendance.dates.length > 0 && attendanceView === "calendar" && (
                <AttendanceCalendar dates={detailAttendance.dates} />
              )}
            </div>
          )}

          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 p-4 mt-4">
            <div className="flex flex-col gap-1 mb-4 sm:flex-row sm:items-center sm:justify-between">
              <V2SectionLabel>Lift Summary &amp; Quick Edit</V2SectionLabel>
              <div className="text-v2-xs text-v2-ink-400 font-v2-body">
                Review recent logs and adjust training max numbers on the fly.
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-v2-sm border-collapse">
                <thead>
                  <tr className="bg-v2-surface-900 border-b border-v2-surface-800">
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Lift</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Week</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Training Max</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Best Est 1RM</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Last Session</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Action</th>
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
                      <tr key={summary.lift} className="border-t border-v2-surface-800 hover:bg-v2-surface-800/50 transition-colors duration-v2-quick">
                        <td className="px-3 py-2 capitalize font-v2-heading font-semibold text-v2-ink-50 uppercase tracking-[0.12em] text-v2-sm">
                          {summary.label}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            className={`${v2FieldClass} py-1.5`}
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
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              step="1"
                              className={`${v2FieldClass} w-24 font-v2-mono tabular-nums py-1.5`}
                              value={draftValue}
                              onChange={(event) =>
                                handleTmDraftChange(summary.lift, event.target.value)
                              }
                              placeholder="--"
                            />
                            <span className="text-v2-xs text-v2-ink-500 font-v2-mono">
                              {detailProfile.unit}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 font-v2-mono tabular-nums text-v2-ink-100">
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
                        <td className="px-3 py-2">
                          {latest ? (
                            <div className="space-y-0.5 text-v2-xs text-v2-ink-300 font-v2-body">
                              <div className="font-v2-mono tabular-nums font-semibold text-v2-ink-100">
                                {latest.createdAt
                                  ? new Date(latest.createdAt).toLocaleDateString()
                                  : "-"}
                              </div>
                              {isRemax ? (
                                <>
                                  <div className="font-v2-heading uppercase tracking-[0.18em] text-purple-300 font-semibold">Remax</div>
                                  <div className="font-v2-mono tabular-nums">
                                    Est 1RM:{" "}
                                    {latest.est1rm
                                      ? `${roundToPlate(latest.est1rm, latest.unit, latest.unit === "lb" ? 5 : 2.5)} ${latest.unit}`
                                      : "-"}
                                  </div>
                                  <div className="font-v2-mono tabular-nums">
                                    TM:{" "}
                                    {latest.tm
                                      ? `${latest.tm} ${latest.unit}`
                                      : "-"}
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="font-v2-mono tabular-nums">
                                    {latest.amrap?.weight ?? 0} {latest.unit} x{" "}
                                    {latest.amrap?.reps ?? 0}
                                  </div>
                                  {latestMeta && (
                                    <div className="text-v2-ink-500 font-v2-mono tabular-nums">{latestMeta}</div>
                                  )}
                                </>
                              )}
                              <div className="text-v2-ink-500 font-v2-mono tabular-nums">
                                Logs: {summary.totalSessions}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-0.5 text-v2-xs text-v2-ink-500 font-v2-body">
                              <div>No sessions yet</div>
                              <div className="font-v2-mono tabular-nums">Logs: {summary.totalSessions}</div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className={v2BtnSmClass}
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
            <div className="rounded-v2-md border border-v2-info-600/40 bg-v2-surface-900 p-4 mt-4">
              <div className="flex items-center justify-between mb-3">
                <V2SectionLabel>Log Session For Athlete</V2SectionLabel>
                <button
                  className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-info-300 hover:text-v2-info-200 underline underline-offset-4"
                  onClick={() => setLogSessionOpen((v) => !v)}
                >
                  {logSessionOpen ? "Cancel" : "+ Log Session"}
                </button>
              </div>
              {logSessionOpen && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Lift</span>
                      <select
                        className={v2FieldClass}
                        value={logSessionDraft.lift}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, lift: e.target.value as LiftKey }))}
                      >
                        {LIFT_KEYS.map((k) => (
                          <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Week</span>
                      <select
                        className={v2FieldClass}
                        value={logSessionDraft.week}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, week: Number(e.target.value) as Week }))}
                      >
                        {[1, 2, 3].map((w) => <option key={w} value={w}>Week {w}</option>)}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Cycle</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        className={`${v2FieldClass} font-v2-mono tabular-nums`}
                        value={logSessionDraft.cycle}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, cycle: Number(e.target.value) }))}
                      />
                    </label>
                    <div />
                    <label className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">AMRAP Weight ({detailProfile?.unit})</span>
                      <input
                        type="number"
                        min={0}
                        className={`${v2FieldClass} font-v2-mono tabular-nums`}
                        value={logSessionDraft.amrapWeight}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, amrapWeight: e.target.value }))}
                        placeholder="e.g. 185"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">AMRAP Reps</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className={`${v2FieldClass} font-v2-mono tabular-nums`}
                        value={logSessionDraft.amrapReps}
                        onChange={(e) => setLogSessionDraft((p) => ({ ...p, amrapReps: e.target.value }))}
                        placeholder="e.g. 5"
                      />
                    </label>
                  </div>
                  <button
                    className={v2BtnPrimaryClass}
                    onClick={handleLogSession}
                    disabled={logSessionSaving}
                  >
                    {logSessionSaving ? "Saving..." : "Save Session"}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="space-y-3 mt-4">
            <div className="flex items-center justify-between">
              <V2SectionLabel>Sessions</V2SectionLabel>
              {detailSessions.length > 0 && (
                <div className="font-v2-mono tabular-nums text-v2-xs text-v2-ink-400">
                  {detailSessions.length} total
                </div>
              )}
            </div>
            {detailSessions.length === 0 ? (
              <div className="rounded-v2-md border border-dashed border-v2-surface-700 bg-v2-surface-900 px-4 py-4 text-v2-sm text-v2-ink-400 font-v2-body">
                No logged sessions yet.
              </div>
            ) : (
              <div className="overflow-auto max-h-[480px] rounded-v2-md border border-v2-surface-800 bg-v2-surface-900">
                <table className="w-full text-v2-sm border-collapse">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-v2-surface-900 border-b border-v2-surface-800">
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">Date</th>
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">Lift</th>
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">Cycle / Week</th>
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">AMRAP</th>
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">Est 1RM</th>
                      <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">PR</th>
                      {isCoach && <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold bg-v2-surface-900">Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {detailSessions.map((session) => {
                      const isEditing = editingSessionId === session.id;
                      const isLegacyLift = !LIFT_KEYS.includes(session.lift as LiftKey);
                      const isDeleting = sessionDeleting === session.id;
                      const canEdit = !isLegacyLift && Boolean(session.id);
                      return (
                        <tr key={session.id ?? session.createdAt} className="border-t border-v2-surface-800 hover:bg-v2-surface-800/50 transition-colors duration-v2-quick">
                          <td className="px-3 py-2 text-v2-xs text-v2-ink-300 font-v2-mono tabular-nums">
                            {session.createdAt
                              ? new Date(session.createdAt).toLocaleDateString()
                              : "-"}
                          </td>
                          <td className="px-3 py-2 capitalize text-v2-ink-100">
                            {isEditing ? (
                              <select
                                className={`${v2FieldClass} py-1 text-v2-xs`}
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
                          <td className="px-3 py-2">
                            {isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  className={`${v2FieldClass} w-14 py-1 text-v2-xs font-v2-mono tabular-nums`}
                                  value={editSessionDraft.cycle ?? 1}
                                  onChange={(e) =>
                                    setEditSessionDraft((prev) => ({
                                      ...prev,
                                      cycle: Number(e.target.value),
                                    }))
                                  }
                                />
                                <select
                                  className={`${v2FieldClass} py-1 text-v2-xs`}
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
                              <span className="inline-flex items-center rounded-v2-sm border border-purple-500/40 bg-purple-500/10 px-2 py-0.5 text-v2-xs font-v2-heading font-semibold text-purple-300 uppercase tracking-[0.16em]">
                                Remax
                              </span>
                            ) : (
                              <span className="font-v2-mono tabular-nums text-v2-ink-100">
                                Cycle {session.cycle ?? 1} / Week {session.week}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-v2-xs font-v2-mono tabular-nums text-v2-ink-100">
                            {session.type === "remax" ? (
                              (session.amrap?.weight ?? 0) > 0
                                ? `${session.amrap?.weight ?? 0} ${session.unit} × ${session.amrap?.reps ?? 0}`
                                : "-"
                            ) : isEditing ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  className={`${v2FieldClass} w-14 py-1 text-v2-xs font-v2-mono tabular-nums`}
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
                                <span className="text-v2-ink-400">{session.unit} x</span>
                                <input
                                  type="number"
                                  className={`${v2FieldClass} w-12 py-1 text-v2-xs font-v2-mono tabular-nums`}
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
                          <td className="px-3 py-2 font-v2-mono tabular-nums font-semibold text-v2-ink-50">
                            {session.est1rm
                              ? `${roundToPlate(
                                  session.est1rm,
                                  session.unit,
                                  session.unit === "lb" ? 5 : 2.5
                                )} ${session.unit}`
                              : "-"}
                            {session.type === "remax" && session.tm ? (
                              <div className="text-v2-xs font-normal text-v2-ink-400 font-v2-mono tabular-nums">
                                TM: {session.tm} {session.unit}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">
                            {session.pr ? (
                              <span className="inline-flex items-center gap-1 rounded-v2-sm bg-v2-success-600/15 border border-v2-success-600/40 px-2 py-0.5 text-[10px] font-v2-heading font-semibold text-v2-success-300 uppercase tracking-[0.16em]">
                                PR
                              </span>
                            ) : (
                              <span className="text-v2-ink-500">-</span>
                            )}
                          </td>
                          {isCoach && (
                            <td className="px-3 py-2">
                              {isEditing ? (
                                <div className="flex gap-1.5">
                                  <button
                                    className={v2BtnSmClass}
                                    onClick={() => handleSaveSession(session.id!)}
                                    disabled={sessionSaving}
                                  >
                                    Save
                                  </button>
                                  <button
                                    className={v2BtnSmClass}
                                    onClick={handleCancelEditSession}
                                    disabled={sessionSaving}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-1.5">
                                  {canEdit && (
                                    <button
                                      className={v2BtnSmClass}
                                      onClick={() => handleEditSession(session)}
                                      disabled={sessionSaving || isDeleting}
                                    >
                                      Edit
                                    </button>
                                  )}
                                  <button
                                    className={v2BtnDangerClass}
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
      <div className="min-h-screen bg-v2-surface-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="rounded-v2-md border border-v2-danger-600/60 bg-v2-surface-900 p-6 shadow-v2-elev-1">
            <div className="mb-3"><V2SectionLabel>Roster Error</V2SectionLabel></div>
            <h3 className="font-v2-heading text-v2-xl font-semibold text-v2-ink-50 uppercase tracking-tight mb-3">Roster</h3>
            <div className="text-v2-sm text-v2-danger-300 font-v2-body">Error: {err}</div>
            <p className="text-v2-sm text-v2-ink-300 mt-3 font-v2-body">
              If This Says "Missing Or Insufficient Permissions", Create Firestore <code className="font-v2-mono text-v2-info-300 bg-v2-surface-800 px-1.5 py-0.5 rounded-v2-sm">{'roles/{uid}'}</code> With <code className="font-v2-mono text-v2-info-300 bg-v2-surface-800 px-1.5 py-0.5 rounded-v2-sm">{"{ roles: [\"coach\"], updatedAt: serverTimestamp() }"}</code>, Then Publish Rules.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-v2-surface-950">
      <div className="max-w-[1400px] mx-auto px-4 lg:px-6 py-6 space-y-5">
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

        {/* Page header */}
        <div className="flex items-center gap-3 pb-2">
          <div className="h-px w-8 bg-v2-info-600" />
          <h1 className="font-v2-heading text-v2-2xl font-semibold text-v2-ink-50 uppercase tracking-[0.08em]">
            Roster
          </h1>
          <span className="font-v2-heading text-v2-xs uppercase tracking-[0.22em] text-v2-ink-500">
            Coach Tools
          </span>
        </div>

        {flash && (
          <div
            className={`rounded-v2-md border px-4 py-3 text-v2-sm font-v2-body shadow-v2-elev-1 ${
              flash.kind === "success"
                ? "border-v2-success-600/50 bg-v2-success-600/10 text-v2-success-300"
                : "border-v2-danger-600/50 bg-v2-danger-600/10 text-v2-danger-300"
            }`}
          >
            {flash.text}
          </div>
        )}

        {/* COACHES SECTION */}
        <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-1 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-v2-surface-800">
            <div className="flex items-center gap-3">
              <V2SectionLabel>Coaches</V2SectionLabel>
              <span className="font-v2-mono tabular-nums text-v2-xs text-v2-ink-500">({filteredCoachRows.length})</span>
            </div>
            {!isAdminUser && coachTeam && (
              <div className="inline-flex rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 p-0.5 gap-0.5">
                <button
                  onClick={() => setCoachLevelFilter("varsity")}
                  className={`px-3 py-1 font-v2-heading text-[10px] uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[32px] ${
                    coachLevelFilter === "varsity"
                      ? "bg-v2-info-600 text-white"
                      : "text-v2-ink-400 hover:bg-v2-surface-800"
                  }`}
                >
                  Varsity
                </button>
                <button
                  onClick={() => setCoachLevelFilter("juniorHigh")}
                  className={`px-3 py-1 font-v2-heading text-[10px] uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[32px] ${
                    coachLevelFilter === "juniorHigh"
                      ? "bg-v2-info-600 text-white"
                      : "text-v2-ink-400 hover:bg-v2-surface-800"
                  }`}
                >
                  JH
                </button>
                <button
                  onClick={() => setCoachLevelFilter("both")}
                  className={`px-3 py-1 font-v2-heading text-[10px] uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[32px] ${
                    coachLevelFilter === "both"
                      ? "bg-v2-info-600 text-white"
                      : "text-v2-ink-400 hover:bg-v2-surface-800"
                  }`}
                >
                  All
                </button>
              </div>
            )}
            {isAdminUser && (
              <label className="flex items-center gap-2">
                <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Team</span>
                <select
                  className={`${v2FieldClass} py-1.5 text-v2-xs`}
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
            <table className="w-full text-v2-sm border-collapse">
              <thead>
                <tr className="bg-v2-surface-900 border-b border-v2-surface-800">
                  <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Name</th>
                  <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Access</th>
                  <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Team</th>
                  {isAdminUser && <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold"></th>}
                </tr>
              </thead>
              <tbody>
                {filteredCoachRows.map((r) => {
                  const rolesList = normalizeRoles(r.roles);
                  const admin = rolesList.includes("admin");
                  return (
                    <tr
                      key={r.uid}
                      className={`border-t border-v2-surface-800 hover:bg-v2-surface-800/50 transition-colors duration-v2-quick ${admin ? "bg-purple-500/5" : ""}`}
                    >
                      <td className="px-3 py-2 font-v2-body font-semibold text-v2-ink-100">{r.firstName || "-"} {r.lastName || ""}</td>
                      <td className="px-3 py-2">
                        <RoleBadges roles={r.roles} />
                      </td>
                      <td className="px-3 py-2 text-v2-ink-300 font-v2-body">{formatTeamLabel(r.team, "-")}</td>
                      {isAdminUser && (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            className="font-v2-heading text-[10px] uppercase tracking-[0.16em] text-v2-danger-300 hover:text-v2-danger-200 font-semibold"
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
                    <td className="px-3 py-3 text-v2-ink-500 font-v2-body text-v2-sm" colSpan={isAdminUser ? 4 : 3}>
                      No coaches found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* LIVE ACTIVITY FEED */}
        {liveSessionFeed.length > 0 && (
          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-1 overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-v2-surface-800">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-v2-success-600 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-v2-success-600"></span>
              </span>
              <V2SectionLabel>Live Activity</V2SectionLabel>
              <span className="font-v2-mono tabular-nums text-v2-xs text-v2-ink-500">{liveSessionFeed.length} session{liveSessionFeed.length !== 1 ? "s" : ""} today</span>
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-v2-sm border-collapse">
                <thead className="sticky top-0 bg-v2-surface-900">
                  <tr className="border-b border-v2-surface-800">
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Athlete</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Lift</th>
                    <th className="px-3 py-2 text-center font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Wk</th>
                    <th className="px-3 py-2 text-right font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">AMRAP</th>
                    <th className="px-3 py-2 text-right font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Est 1RM</th>
                    <th className="px-3 py-2 text-right font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">When</th>
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
                      session.lift === "squat" ? "bg-v2-danger-600"
                      : session.lift === "bench" ? "bg-v2-info-600"
                      : "bg-v2-success-600";
                    return (
                      <tr
                        key={`${session.id}-${idx}`}
                        className="border-t border-v2-surface-800 hover:bg-v2-surface-800/50 transition-colors duration-v2-quick"
                      >
                        <td className="px-3 py-2 font-v2-body font-semibold text-v2-ink-100 whitespace-nowrap">
                          {name}
                          {session.pr && <span className="ml-1.5 text-v2-warn-500 font-v2-heading text-[10px] font-semibold" title="PR">PR</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`inline-block h-2 w-2 rounded-full ${liftColor}`}></span>
                            <span className="capitalize text-v2-ink-300 font-v2-body">{session.lift}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center text-v2-ink-400 font-v2-mono tabular-nums">{session.week}</td>
                        <td className="px-3 py-2 text-right text-v2-ink-200 font-v2-mono tabular-nums whitespace-nowrap">
                          {session.amrap ? `${session.amrap.weight}×${session.amrap.reps}` : "-"}
                        </td>
                        <td className="px-3 py-2 text-right font-v2-mono tabular-nums font-semibold text-v2-ink-50">
                          {session.est1rm ? Math.round(session.est1rm) : "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-v2-ink-500 font-v2-mono tabular-nums whitespace-nowrap">{timeAgo}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ATHLETES SECTION */}
        <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-1">
          <div className="p-4 lg:p-5 space-y-4 border-b border-v2-surface-800">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="space-y-2">
                <V2SectionLabel>Athletes</V2SectionLabel>
                <h3 className="font-v2-heading text-v2-xl font-semibold text-v2-ink-50 uppercase tracking-tight">
                  Roster <span className="font-v2-mono tabular-nums text-v2-ink-500 text-v2-base font-normal">({filteredAthleteRows.length})</span>
                </h3>
                <p className="text-v2-xs text-v2-ink-400 font-v2-body">
                  Click a row to review recent sessions and TM numbers.
                </p>
              </div>
              {(isCoach || isAdminUser) && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={v2BtnCtaClass}
                    onClick={openAddAthlete}
                    disabled={addAthleteSaving}
                  >
                    + Add Athlete
                  </button>
                  {isAdminUser && (
                    <button
                      type="button"
                      className={v2BtnClass}
                      onClick={handleBackfillDates}
                      disabled={backfillRunning}
                    >
                      {backfillRunning ? "Backfilling..." : "Backfill Dates"}
                    </button>
                  )}
                  {isMobileLayout && (
                    <button
                      type="button"
                      className={v2BtnClass}
                      onClick={() => setShowAthleteTableOnMobile((prev) => !prev)}
                    >
                      {showAthleteTableOnMobile
                        ? "Card View"
                        : "Table View"}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Backfill Result */}
            {backfillResult && (
              <div className="rounded-v2-sm border border-v2-info-600/40 bg-v2-info-600/10 p-3 text-v2-sm text-v2-info-300 font-v2-body">
                <strong className="font-v2-heading uppercase tracking-[0.18em] text-v2-xs font-semibold">Backfill Complete:</strong>{" "}
                <span className="font-v2-mono tabular-nums">{backfillResult.updated} updated, {backfillResult.skipped} skipped
                {backfillResult.errors > 0 && `, ${backfillResult.errors} errors`}</span>
              </div>
            )}

            {/* Search and Filter Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
              {/* Search Box */}
              <div className="flex-1 min-w-[220px]">
                <div className="relative">
                  <input
                    id="athlete-search"
                    name="search"
                    type="text"
                    placeholder="Search athletes..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`${v2FieldClass} w-full pl-10`}
                  />
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 fill-none stroke-v2-ink-500 stroke-2 pointer-events-none" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-v2-ink-500 hover:text-v2-ink-200 transition-colors duration-v2-quick"
                    >
                      <svg className="w-4 h-4 fill-none stroke-current stroke-2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Team Filter */}
              {isAdminUser && (
                <div className="flex items-center gap-2">
                  <label htmlFor="roster-team-filter" className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Team</label>
                  <select
                    id="roster-team-filter"
                    value={teamFilter}
                    onChange={(e) => setTeamFilter(e.target.value as Team | "all")}
                    className={v2FieldClass}
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
                  <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Level</span>
                  <div className="inline-flex rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 p-0.5 gap-0.5">
                    <button
                      onClick={() => setCoachLevelFilter("varsity")}
                      className={`px-3 py-1.5 font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[36px] ${
                        coachLevelFilter === "varsity"
                          ? "bg-v2-info-600 text-white"
                          : "text-v2-ink-300 hover:bg-v2-surface-800"
                      }`}
                    >
                      Varsity
                    </button>
                    <button
                      onClick={() => setCoachLevelFilter("juniorHigh")}
                      className={`px-3 py-1.5 font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[36px] ${
                        coachLevelFilter === "juniorHigh"
                          ? "bg-v2-info-600 text-white"
                          : "text-v2-ink-300 hover:bg-v2-surface-800"
                      }`}
                    >
                      Junior High
                    </button>
                    <button
                      onClick={() => setCoachLevelFilter("both")}
                      className={`px-3 py-1.5 font-v2-heading text-v2-xs uppercase tracking-[0.16em] font-semibold rounded-v2-sm transition-colors duration-v2-quick min-h-[36px] ${
                        coachLevelFilter === "both"
                          ? "bg-v2-info-600 text-white"
                          : "text-v2-ink-300 hover:bg-v2-surface-800"
                      }`}
                    >
                      Both
                    </button>
                  </div>
                </div>
              )}

              {/* Admin Athlete Filter */}
              {isAdminUser && (
                <label className="flex items-center gap-2">
                  <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Filter</span>
                  <select
                    className={v2FieldClass}
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
                <label className="flex items-center gap-2">
                  <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Sort</span>
                  <select
                    className={v2FieldClass}
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
              <div className="rounded-v2-md border border-v2-accent-700/50 bg-v2-surface-950 p-4">
                <form className="space-y-4" onSubmit={handleAddAthlete}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-px w-5 bg-v2-accent-700" />
                        <span className="font-v2-heading text-v2-xs uppercase tracking-[0.22em] text-v2-accent-500 font-semibold">
                          Add Athlete
                        </span>
                      </div>
                      <div className="text-v2-xs text-v2-ink-400 font-v2-body">
                        Use the same sign-in code so they can log in later.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={v2BtnSmClass}
                      onClick={closeAddAthlete}
                      disabled={addAthleteSaving}
                    >
                      Close
                    </button>
                  </div>

                  {addAthleteError && (
                    <div className="rounded-v2-sm border border-v2-danger-600/50 bg-v2-danger-600/10 px-3 py-2 text-v2-xs text-v2-danger-300 font-v2-body">
                      {addAthleteError}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label htmlFor="add-athlete-firstname" className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">First name</span>
                      <input
                        id="add-athlete-firstname"
                        name="firstName"
                        type="text"
                        autoComplete="given-name"
                        className={v2FieldClass}
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
                    <label htmlFor="add-athlete-lastname" className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Last name</span>
                      <input
                        id="add-athlete-lastname"
                        name="lastName"
                        type="text"
                        autoComplete="family-name"
                        className={v2FieldClass}
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
                    <label htmlFor="add-athlete-team" className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">Team</span>
                      <select
                        id="add-athlete-team"
                        name="team"
                        className={v2FieldClass}
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
                    <label htmlFor="add-athlete-code" className="flex flex-col gap-1.5">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.18em] text-v2-ink-400 font-semibold">4-digit code</span>
                      <input
                        id="add-athlete-code"
                        name="accessCode"
                        className={`${v2FieldClass} text-center font-v2-mono tabular-nums font-semibold tracking-[0.3em] text-v2-base`}
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
                      className={v2BtnCtaClass}
                      disabled={addAthleteSaving}
                    >
                      {addAthleteSaving ? "Saving..." : "Add Athlete"}
                    </button>
                    <button
                      type="button"
                      className={v2BtnClass}
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
            <div className="px-4 lg:px-5 pt-3 text-v2-sm text-v2-ink-300 font-v2-body">
              Showing <span className="font-v2-mono tabular-nums font-semibold text-v2-info-300">{filteredAthleteRows.length}</span> athlete{filteredAthleteRows.length !== 1 ? 's' : ''}
              {searchQuery && <> matching "{searchQuery}"</>}
            </div>
          )}

          {useMobileAthleteCards && (
            <div className="p-4 space-y-2.5">
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
                    className={`rounded-v2-md border p-3.5 transition-colors duration-v2-quick focus:outline-none focus:ring-2 focus:ring-v2-info-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950 ${
                      selected
                        ? "border-v2-info-600 bg-v2-info-600/5"
                        : "border-v2-surface-800 bg-v2-surface-900 hover:border-v2-info-600/50 hover:bg-v2-surface-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-v2-body font-semibold text-v2-ink-50">
                          {r.firstName || "-"} {r.lastName || "-"}
                        </div>
                        <div className="text-v2-xs text-v2-ink-400 font-v2-body">
                          {formatTeamLabel(r.team, "-")}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {loggedCurrentLift ? (
                          <span
                            className="inline-flex h-3 w-3 rounded-full bg-v2-success-600 shadow-[0_0_8px_2px_rgba(16,185,129,0.6)]"
                            title={
                              latestSessionDateKey
                                ? `Session logged on ${latestSessionDateKey}`
                                : "Session logged"
                            }
                          />
                        ) : (
                          <span className="text-[10px] text-v2-ink-500 font-v2-heading uppercase tracking-[0.16em]">No Lift</span>
                        )}
                        <span className="rounded-v2-sm bg-v2-surface-800 border border-v2-surface-700 px-2 py-0.5 font-v2-mono tabular-nums text-v2-xs text-v2-info-300 font-semibold">
                          {r.accessCode ?? "--"}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2 text-v2-xs font-v2-body">
                      <div className="text-v2-ink-400">
                        <span className="font-v2-heading uppercase tracking-[0.16em] text-[10px] mr-1">Joined</span>
                        <span className="font-v2-mono tabular-nums text-v2-ink-200 font-semibold">{joinedLabel}</span>
                      </div>
                      <div className="text-v2-ink-400">
                        <span className="font-v2-heading uppercase tracking-[0.16em] text-[10px] mr-1">Last</span>
                        <span className="font-v2-mono tabular-nums text-v2-ink-200 font-semibold">{lastWorkoutLabel}</span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={v2BtnSmClass}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleSelectAthlete(r);
                        }}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className={v2BtnSmClass}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleRegenerate(r);
                        }}
                        disabled={busyUid === r.uid || deleteUid === r.uid}
                      >
                        {busyUid === r.uid ? "Working..." : "Set Code"}
                      </button>
                      {isAdminUser ? (
                        <button
                          type="button"
                          className={v2BtnDangerClass}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(r);
                          }}
                          disabled={deleteUid === r.uid || busyUid === r.uid}
                        >
                          {deleteUid === r.uid ? "Deleting..." : "Delete"}
                        </button>
                      ) : (
                        <span className="self-center font-v2-heading text-[10px] uppercase tracking-[0.16em] text-v2-ink-500">Admin Only</span>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredAthleteRows.length === 0 && (
                <div className="rounded-v2-md border border-dashed border-v2-surface-700 bg-v2-surface-900 px-4 py-6 text-v2-sm text-v2-ink-400 font-v2-body text-center">
                  No athletes found for the selected team.
                </div>
              )}
            </div>
          )}

          {!useMobileAthleteCards && (
            <div className="overflow-x-auto">
              <table className="w-full text-v2-sm border-collapse">
                <thead>
                  <tr className="bg-v2-surface-900 border-b border-v2-surface-800">
                    <th
                      className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold cursor-pointer hover:text-v2-info-300 transition-colors duration-v2-quick select-none"
                      onClick={() => handleSort("firstName")}
                    >
                      <div className="flex items-center gap-1">
                        First
                        {sortField === "firstName" && (
                          <span className="text-v2-info-300">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        )}
                      </div>
                    </th>
                    <th
                      className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold cursor-pointer hover:text-v2-info-300 transition-colors duration-v2-quick select-none"
                      onClick={() => handleSort("lastName")}
                    >
                      <div className="flex items-center gap-1">
                        Last
                        {sortField === "lastName" && (
                          <span className="text-v2-info-300">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Team</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Code</th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Joined</th>
                    <th className="px-3 py-2 text-center font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Current</th>
                    <th
                      className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold cursor-pointer hover:text-v2-info-300 transition-colors duration-v2-quick select-none"
                      onClick={() => handleSort("lastWorkout")}
                    >
                      <div className="flex items-center gap-1">
                        Last Workout
                        {sortField === "lastWorkout" && (
                          <span className="text-v2-info-300">{sortDirection === "asc" ? "↑" : "↓"}</span>
                        )}
                      </div>
                    </th>
                    <th className="px-3 py-2 text-left font-v2-heading uppercase tracking-[0.18em] text-v2-xs text-v2-ink-400 font-semibold">Actions</th>
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
                        className={`border-t border-v2-surface-800 cursor-pointer transition-colors duration-v2-quick ${
                          selected ? "bg-v2-info-600/10" : "hover:bg-v2-surface-800/50"
                        }`}
                        onClick={() => handleSelectAthlete(r)}
                      >
                        <td className="px-3 py-2 text-v2-ink-100 font-v2-body">{r.firstName || "-"}</td>
                        <td className="px-3 py-2 text-v2-ink-50 font-v2-body font-semibold">{r.lastName || "-"}</td>
                        <td className="px-3 py-2 text-v2-ink-300 font-v2-body">{formatTeamLabel(r.team, "-")}</td>
                        <td className="px-3 py-2 font-v2-mono tabular-nums text-v2-info-300 font-semibold">{r.accessCode ?? "-"}</td>
                        <td className="px-3 py-2 text-v2-xs text-v2-ink-300 font-v2-mono tabular-nums">
                          {r.createdAt
                            ? new Date(r.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "2-digit",
                              })
                            : <span className="text-v2-ink-500">-</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {loggedCurrentLift ? (
                            <span
                              className="inline-flex h-3 w-3 rounded-full bg-v2-success-600 shadow-[0_0_8px_2px_rgba(16,185,129,0.6)]"
                              title={
                                latestSessionDateKey
                                  ? `Session logged on ${latestSessionDateKey}`
                                  : "Session logged"
                              }
                            />
                          ) : (
                            <span className="text-v2-ink-500 text-v2-xs">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-v2-xs text-v2-ink-300 font-v2-mono tabular-nums">
                          {loadingActivity ? (
                            <span className="text-v2-ink-500">...</span>
                          ) : activity?.lastWorkout ? (
                            new Date(activity.lastWorkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          ) : (
                            <span className="text-v2-ink-500">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className={v2BtnSmClass}
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRegenerate(r);
                              }}
                              disabled={busyUid === r.uid || deleteUid === r.uid}
                            >
                              {busyUid === r.uid ? "Working..." : "Set Code"}
                            </button>
                            {isAdminUser ? (
                              <button
                                type="button"
                                className={v2BtnDangerClass}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleDelete(r);
                                }}
                                disabled={deleteUid === r.uid || busyUid === r.uid}
                              >
                                {deleteUid === r.uid ? "Deleting..." : "Delete"}
                              </button>
                            ) : (
                              <span className="font-v2-heading text-[10px] uppercase tracking-[0.16em] text-v2-ink-500 self-center">Admin Only</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredAthleteRows.length === 0 && (
                    <tr>
                      <td className="px-3 py-4 text-v2-ink-400 font-v2-body text-center" colSpan={8}>
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
          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-1 p-4 lg:p-5 space-y-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              {detailHeader}
              <button
                type="button"
                className={v2BtnClass}
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
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-sm p-4"
            onClick={() => setDetailModalOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <div
              className="w-full max-w-5xl rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-2 p-5 lg:p-6 space-y-4 mt-8"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                {detailHeader}
                <button
                  type="button"
                  className={v2BtnClass}
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
    </div>
  );
}
