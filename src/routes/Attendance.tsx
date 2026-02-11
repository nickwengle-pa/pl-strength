import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildDefaultAttendanceSessions,
  TEAM_DEFINITIONS,
  formatTeamLabel,
  getStoredTeamSelection,
  getTeamDefinition,
  listAttendanceCheckinsForDate,
  loadAttendanceSheet,
  reviewAttendanceCheckin,
  saveAttendanceSheet,
  setAttendanceDateLocked,
  setAttendanceSessionLocked,
  updateAttendanceCheckinStatus,
  fetchLastWorkoutDates,
  type AttendanceCheckin,
  type AttendanceSession,
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
  sessionsByDate: {},
  sessionLocks: {},
  lockedDates: {},
  updatedAt: undefined,
});

const normalizeRuntimeSheet = (
  sheet: AttendanceSheet | undefined,
  team: Team
): AttendanceSheet => {
  if (!sheet || typeof sheet !== "object") {
    return createEmptySheet(team);
  }
  const dates = Array.isArray(sheet.dates) ? sheet.dates : [];
  const athletes = Array.isArray(sheet.athletes) ? sheet.athletes : [];
  const records =
    sheet.records && typeof sheet.records === "object" && !Array.isArray(sheet.records)
      ? sheet.records
      : {};
  const sessionsSource =
    sheet.sessionsByDate &&
    typeof sheet.sessionsByDate === "object" &&
    !Array.isArray(sheet.sessionsByDate)
      ? sheet.sessionsByDate
      : {};
  const sessionLocksSource =
    sheet.sessionLocks &&
    typeof sheet.sessionLocks === "object" &&
    !Array.isArray(sheet.sessionLocks)
      ? sheet.sessionLocks
      : {};
  const lockedSource =
    sheet.lockedDates &&
    typeof sheet.lockedDates === "object" &&
    !Array.isArray(sheet.lockedDates)
      ? sheet.lockedDates
      : {};
  const sessionsByDate: AttendanceSheet["sessionsByDate"] = {};
  const sessionLocks: AttendanceSheet["sessionLocks"] = {};
  const lockedDates: Record<string, boolean> = {};
  dates.forEach((date) => {
    const sessionsRaw = Array.isArray(sessionsSource[date]) ? sessionsSource[date] : [];
    const normalizedSessions: AttendanceSession[] = [];
    const seenKeys = new Set<string>();
    sessionsRaw.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
      const rawKey =
        typeof (entry as any).key === "string" && (entry as any).key.trim()
          ? (entry as any).key.trim()
          : `session-${index + 1}`;
      const key = rawKey.replace(/[^a-zA-Z0-9_-]/g, "-");
      const label =
        typeof (entry as any).label === "string" && (entry as any).label.trim()
          ? (entry as any).label.trim().slice(0, 60)
          : `Session ${index + 1}`;
      if (!key || seenKeys.has(key)) return;
      seenKeys.add(key);
      normalizedSessions.push({ key, label });
    });

    const sessions =
      normalizedSessions.length > 0
        ? normalizedSessions
        : [{ key: "session-1", label: "After School" }];
    const lockRowSource =
      sessionLocksSource[date] &&
      typeof sessionLocksSource[date] === "object" &&
      !Array.isArray(sessionLocksSource[date])
        ? (sessionLocksSource[date] as Record<string, unknown>)
        : {};
    const lockAll = lockedSource[date] === true;
    const lockRow: Record<string, boolean> = {};
    sessions.forEach((session) => {
      lockRow[session.key] = lockAll || lockRowSource[session.key] === true;
    });
    sessionsByDate[date] = sessions;
    sessionLocks[date] = lockRow;
    lockedDates[date] = lockAll || sessions.every((session) => lockRow[session.key] === true);
  });
  return {
    ...createEmptySheet(team),
    ...sheet,
    team,
    dates,
    athletes,
    records,
    sessionsByDate,
    sessionLocks,
    lockedDates,
  };
};

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

type AttendanceTier = "high" | "watch" | "low";
type ReportRangePreset =
  | "all_dates"
  | "last_7_days"
  | "last_14_days"
  | "last_30_days"
  | "this_week"
  | "last_week"
  | "last_4_weeks"
  | "last_8_weeks"
  | "this_month"
  | "last_month"
  | "summer_to_date"
  | "last_12_sessions"
  | "custom";

type WeeklySummary = {
  attended: number;
  total: number;
  pct: number;
};

type AttendanceReportWeek = {
  key: string;
  label: string;
  dates: string[];
};

type AttendanceReportRow = {
  athlete: AttendanceSheet["athletes"][number];
  attended: number;
  missed: number;
  pct: number;
  lastSixPct: number;
  missedStreak: number;
  tier: AttendanceTier;
  weekly: Record<string, WeeklySummary>;
};

type ReviewStatusModalType = "approved" | "rejected" | null;

const HIGH_ATTENDANCE_THRESHOLD = 85;
const LOW_ATTENDANCE_THRESHOLD = 70;

const REPORT_RANGE_PRESET_OPTIONS: Array<{
  value: ReportRangePreset;
  label: string;
}> = [
  { value: "all_dates", label: "All Available Dates" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_14_days", label: "Last 14 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "last_4_weeks", label: "Last 4 Weeks" },
  { value: "last_8_weeks", label: "Last 8 Weeks" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "summer_to_date", label: "Summer To Date" },
  { value: "last_12_sessions", label: "Last 12 Sessions" },
  { value: "custom", label: "Custom Range" },
];

const parseLocalDate = (value: string): Date | null => {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shiftDateByDays = (date: Date, days: number): Date => {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
};

const firstDayOfMonth = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), 1);

const mondayOfWeek = (date: Date): Date => {
  const day = date.getDay();
  const offsetToMonday = (day + 6) % 7;
  return shiftDateByDays(date, -offsetToMonday);
};

const resolveReportPresetRange = (
  preset: ReportRangePreset,
  sourceDates: string[]
): { start: string; end: string } => {
  if (sourceDates.length === 0) {
    return { start: "", end: "" };
  }

  const first = sourceDates[0];
  const last = sourceDates[sourceDates.length - 1];
  const anchor = parseLocalDate(last) ?? new Date();

  switch (preset) {
    case "all_dates":
      return { start: first, end: last };
    case "last_7_days":
      return {
        start: formatDateInput(shiftDateByDays(anchor, -6)),
        end: formatDateInput(anchor),
      };
    case "last_14_days":
      return {
        start: formatDateInput(shiftDateByDays(anchor, -13)),
        end: formatDateInput(anchor),
      };
    case "last_30_days":
      return {
        start: formatDateInput(shiftDateByDays(anchor, -29)),
        end: formatDateInput(anchor),
      };
    case "this_week":
      return {
        start: formatDateInput(mondayOfWeek(anchor)),
        end: formatDateInput(anchor),
      };
    case "last_week": {
      const thisWeekStart = mondayOfWeek(anchor);
      const lastWeekEnd = shiftDateByDays(thisWeekStart, -1);
      const lastWeekStart = shiftDateByDays(lastWeekEnd, -6);
      return {
        start: formatDateInput(lastWeekStart),
        end: formatDateInput(lastWeekEnd),
      };
    }
    case "last_4_weeks":
      return {
        start: formatDateInput(shiftDateByDays(anchor, -27)),
        end: formatDateInput(anchor),
      };
    case "last_8_weeks":
      return {
        start: formatDateInput(shiftDateByDays(anchor, -55)),
        end: formatDateInput(anchor),
      };
    case "this_month":
      return {
        start: formatDateInput(firstDayOfMonth(anchor)),
        end: formatDateInput(anchor),
      };
    case "last_month": {
      const currentMonthStart = firstDayOfMonth(anchor);
      const lastMonthEnd = shiftDateByDays(currentMonthStart, -1);
      const lastMonthStart = firstDayOfMonth(lastMonthEnd);
      return {
        start: formatDateInput(lastMonthStart),
        end: formatDateInput(lastMonthEnd),
      };
    }
    case "summer_to_date": {
      let year = anchor.getFullYear();
      const thisYearSummerStart = new Date(year, 5, 1);
      if (anchor < thisYearSummerStart) {
        year -= 1;
      }
      return {
        start: formatDateInput(new Date(year, 5, 1)),
        end: formatDateInput(anchor),
      };
    }
    case "last_12_sessions": {
      const windowDates = sourceDates.slice(-12);
      return {
        start: windowDates[0] ?? first,
        end: windowDates[windowDates.length - 1] ?? last,
      };
    }
    case "custom":
      return { start: first, end: last };
    default:
      return { start: first, end: last };
  }
};

const formatMonthDay = (value: string): string => {
  const parsed = parseLocalDate(value);
  if (!parsed) return value;
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
};

const formatDateLabel = (value: string): string => {
  const parsed = parseLocalDate(value);
  if (!parsed) return value;
  return parsed.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const findSheetAthleteIdForCheckin = (
  sheet: AttendanceSheet,
  team: Team,
  checkin: AttendanceCheckin
): string | null => {
  if (checkin.athleteId) {
    const byId = sheet.athletes.find((athlete) => athlete.id === checkin.athleteId);
    if (byId) return byId.id;
  }

  const byUid = sheet.athletes.find(
    (athlete) => athlete.level === team && athlete.uid === checkin.uid
  );
  if (byUid) return byUid.id;

  const first = (checkin.firstName ?? "").trim().toLowerCase();
  const last = (checkin.lastName ?? "").trim().toLowerCase();
  if (!first && !last) return null;

  const byName = sheet.athletes.find(
    (athlete) =>
      athlete.level === team &&
      athlete.firstName.trim().toLowerCase() === first &&
      athlete.lastName.trim().toLowerCase() === last
  );
  return byName?.id ?? null;
};

const applyPendingCheckinsToSheet = (
  sheet: AttendanceSheet,
  team: Team,
  checkins: AttendanceCheckin[]
): AttendanceSheet => {
  const pendingRows = checkins.filter((row) => row.status === "pending");
  if (pendingRows.length === 0) return sheet;

  const nextRecords = { ...sheet.records };
  let changed = false;
  pendingRows.forEach((checkin) => {
    const athleteId = findSheetAthleteIdForCheckin(sheet, team, checkin);
    if (!athleteId) return;
    const row = { ...(nextRecords[athleteId] ?? {}) };
    if (row[checkin.date] !== true) {
      row[checkin.date] = true;
      nextRecords[athleteId] = row;
      changed = true;
    }
  });

  if (!changed) return sheet;
  return {
    ...sheet,
    records: nextRecords,
  };
};

const getWeekStartKey = (value: string): string => {
  const parsed = parseLocalDate(value);
  if (!parsed) return value;
  const day = parsed.getDay();
  const offsetToMonday = (day + 6) % 7;
  parsed.setDate(parsed.getDate() - offsetToMonday);
  return formatDateInput(parsed);
};

const getWeekLabel = (weekStart: string): string => {
  const parsed = parseLocalDate(weekStart);
  if (!parsed) return weekStart;
  const end = new Date(parsed);
  end.setDate(parsed.getDate() + 6);
  return `${formatMonthDay(weekStart)}-${end.getMonth() + 1}/${end.getDate()}`;
};

const percentFromCounts = (attended: number, total: number): number => {
  if (total <= 0) return 0;
  return Number(((attended / total) * 100).toFixed(1));
};

const tierFromPercent = (pct: number): AttendanceTier => {
  if (pct >= HIGH_ATTENDANCE_THRESHOLD) return "high";
  if (pct < LOW_ATTENDANCE_THRESHOLD) return "low";
  return "watch";
};

const tierBadgeClass = (tier: AttendanceTier): string => {
  if (tier === "high") return "bg-emerald-100 text-emerald-700";
  if (tier === "low") return "bg-rose-100 text-rose-700";
  return "bg-amber-100 text-amber-700";
};

const tierLabel = (tier: AttendanceTier): string => {
  if (tier === "high") return "High";
  if (tier === "low") return "At Risk";
  return "Watch";
};

const weekCellClass = (pct: number): string => {
  if (pct >= HIGH_ATTENDANCE_THRESHOLD) return "bg-emerald-50 text-emerald-700";
  if (pct < LOW_ATTENDANCE_THRESHOLD) return "bg-rose-50 text-rose-700";
  return "bg-amber-50 text-amber-700";
};

const csvEscape = (value: string | number): string => {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const downloadBlob = (filename: string, content: string, type: string) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
};

const exportCanvasPng = (canvas: HTMLCanvasElement, filename: string) => {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
};

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });

const loadImageMaybe = async (src: string): Promise<HTMLImageElement | null> => {
  try {
    return await loadImage(src);
  } catch {
    return null;
  }
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

const cloneDefaultDateSessions = (): AttendanceSession[] =>
  buildDefaultAttendanceSessions().map((session) => ({ ...session }));

const sanitizeSessionLabel = (value: string, fallback: string): string => {
  const trimmed = value.trim().slice(0, 60);
  return trimmed || fallback;
};

const nextDateSessionKey = (sessions: AttendanceSession[]): string => {
  let index = sessions.length + 1;
  while (sessions.some((session) => session.key === `session-${index}`)) {
    index += 1;
  }
  return `session-${index}`;
};

const dateHasAnyLockedSession = (sheet: AttendanceSheet, date: string): boolean =>
  Object.values(sheet.sessionLocks?.[date] ?? {}).some((value) => value === true);

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

const isMobileDevice = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
    ua.toLowerCase()
  );
};

const DEFAULT_TEAM: Team = FALLBACK_TEAMS[0] ?? ALL_TEAMS[0] ?? "football-varsity";
const TOGGLE_AUTOSAVE_DELAY_MS = 350;

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
    number: string;
    grade: string;
    height: string;
    weight: string;
    level: Team;
  }>({
    firstName: "",
    lastName: "",
    number: "",
    grade: "",
    height: "",
    weight: "",
    level: DEFAULT_TEAM,
  });
  const [coachTeam, setCoachTeam] = useState<Team | null>(null);
  const [lastWorkoutDates, setLastWorkoutDates] = useState<Record<string, number>>({});
  const [sortField, setSortField] = useState<'firstName' | 'lastName' | 'number' | 'grade' | 'lastWorkout'>('lastName');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [reportRangePreset, setReportRangePreset] = useState<ReportRangePreset>("all_dates");
  const [reportStartDate, setReportStartDate] = useState("");
  const [reportEndDate, setReportEndDate] = useState("");
  const [showDesktopTableOnMobile, setShowDesktopTableOnMobile] = useState(false);
  const [isAddAthleteCollapsed, setIsAddAthleteCollapsed] = useState<boolean>(() =>
    isMobileDevice()
  );
  const [isReportSectionCollapsed, setIsReportSectionCollapsed] = useState<boolean>(() =>
    isMobileDevice()
  );
  const [reviewDate, setReviewDate] = useState("");
  const [reviewStatusModal, setReviewStatusModal] = useState<ReviewStatusModalType>(null);
  const [reviewCheckins, setReviewCheckins] = useState<AttendanceCheckin[]>([]);
  const [loadingReviewCheckins, setLoadingReviewCheckins] = useState(false);
  const [reviewingCheckinId, setReviewingCheckinId] = useState<string | null>(null);
  const [lockingDate, setLockingDate] = useState<string | null>(null);
  const [lockingSessionKey, setLockingSessionKey] = useState<string | null>(null);
  const sheetsRef = useRef<TeamMap<AttendanceSheet>>(sheets);
  const saveInFlightRef = useRef<TeamMap<boolean>>(buildTeamMap(() => false));
  const saveQueuedRef = useRef<TeamMap<boolean>>(buildTeamMap(() => false));
  const saveQueuedFlashRef = useRef<TeamMap<boolean>>(buildTeamMap(() => false));
  const toggleSaveTimerRef = useRef<Partial<Record<Team, number>>>({});

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
      setSelectedTeam(visibleTeams[0] ?? DEFAULT_TEAM);
    }
  }, [visibleTeams, selectedTeam]);

  useEffect(() => {
    sheetsRef.current = sheets;
  }, [sheets]);

  useEffect(() => {
    return () => {
      Object.values(toggleSaveTimerRef.current).forEach((timer) => {
        if (typeof timer === "number") {
          window.clearTimeout(timer);
        }
      });
    };
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

  useEffect(() => {
    if (authLoading) return;
    if (!isCoach) {
      setLoading(false);
      return;
    }
    let active = true;
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
        if (!active) return;
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
        if (!active) return;
        const message = err?.message ?? "Could Not Load Attendance Sheets.";
        setLoadError(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [authLoading, isCoach, visibleTeams]);

  // Load last workout dates for all athletes (single batch query)
  useEffect(() => {
    if (authLoading || !isCoach) return;
    let active = true;
    (async () => {
      try {
        const dates = await fetchLastWorkoutDates(selectedTeam);
        if (active) setLastWorkoutDates(dates);
      } catch (err) {
        console.debug("Could Not Load Workout Dates", err);
      }
    })();
    return () => { active = false; };
  }, [authLoading, isCoach, selectedTeam]);

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

  const selectedSheet = normalizeRuntimeSheet(sheets[selectedTeam], selectedTeam);
  const selectedError = teamErrors[selectedTeam];
  const selectedDirty = dirty[selectedTeam];
  const selectedSaving = saving[selectedTeam];
  const isMobileCoachBrowser = isMobileDevice();
  const useCompactMobileAthleteLayout = isMobileCoachBrowser && !showDesktopTableOnMobile;
  const reportSourceDates = useMemo(
    () => [...selectedSheet.dates].sort((a, b) => a.localeCompare(b)),
    [selectedSheet.dates]
  );
  const mobileAthleteDate =
    reviewDate || reportSourceDates[reportSourceDates.length - 1] || "";
  const mobileAthleteDateLocked = Boolean(
    mobileAthleteDate && selectedSheet.lockedDates?.[mobileAthleteDate]
  );
  const reviewDateLocked = Boolean(selectedSheet.lockedDates?.[reviewDate]);
  const reviewDateSessions = reviewDate
    ? selectedSheet.sessionsByDate?.[reviewDate] ?? []
    : [];
  const reviewDateSessionLocks = reviewDate
    ? selectedSheet.sessionLocks?.[reviewDate] ?? {}
    : {};
  const pendingReviewCheckins = useMemo(
    () => reviewCheckins.filter((row) => row.status === "pending"),
    [reviewCheckins]
  );
  const approvedReviewCount = useMemo(
    () => reviewCheckins.filter((row) => row.status === "approved").length,
    [reviewCheckins]
  );
  const rejectedReviewCount = useMemo(
    () => reviewCheckins.filter((row) => row.status === "rejected").length,
    [reviewCheckins]
  );
  const reviewStatusModalRows = useMemo(() => {
    if (!reviewStatusModal) return [];
    return reviewCheckins
      .filter((row) => row.status === reviewStatusModal)
      .slice()
      .sort((a, b) => (b.reviewedAt ?? b.submittedAt ?? 0) - (a.reviewedAt ?? a.submittedAt ?? 0));
  }, [reviewCheckins, reviewStatusModal]);

  useEffect(() => {
    if (reportSourceDates.length === 0) {
      setReviewDate("");
      setReviewCheckins([]);
      return;
    }
    setReviewDate((prev) => {
      if (prev && reportSourceDates.includes(prev)) return prev;
      return reportSourceDates[reportSourceDates.length - 1];
    });
  }, [selectedTeam, reportSourceDates]);

  useEffect(() => {
    setReviewStatusModal(null);
  }, [selectedTeam, reviewDate]);

  useEffect(() => {
    if (authLoading || !isCoach || !reviewDate) {
      setReviewCheckins([]);
      setLoadingReviewCheckins(false);
      return;
    }
    let active = true;
    setLoadingReviewCheckins(true);
    (async () => {
      try {
        let rows = await listAttendanceCheckinsForDate(selectedTeam, reviewDate);
        const currentSheet = normalizeRuntimeSheet(sheetsRef.current[selectedTeam], selectedTeam);
        const reviewRowsToSync: Array<{
          uid: string;
          desiredStatus: "approved" | "rejected";
          sessionKey?: string;
          sessionLabel?: string;
        }> = [];
        for (const row of rows) {
          if (row.status === "pending") continue;
          const athleteId = findSheetAthleteIdForCheckin(currentSheet, selectedTeam, row);
          if (!athleteId) continue;
          const markedPresent = Boolean(currentSheet.records[athleteId]?.[row.date]);
          const desiredStatus: "approved" | "rejected" = markedPresent ? "approved" : "rejected";
          if (row.status === desiredStatus) continue;
          reviewRowsToSync.push({
            uid: row.uid,
            desiredStatus,
            sessionKey: row.sessionKey,
            sessionLabel: row.sessionLabel,
          });
        }

        if (reviewRowsToSync.length > 0) {
          const coachDisplayName =
            typeof window !== "undefined"
              ? window.localStorage.getItem("pl-strength-display-name")?.trim() || undefined
              : undefined;
          await Promise.allSettled(
            reviewRowsToSync.map((row) =>
              updateAttendanceCheckinStatus({
                team: selectedTeam,
                date: reviewDate,
                uid: row.uid,
                status: row.desiredStatus,
                reviewedByName: coachDisplayName,
                sessionKey: row.sessionKey,
                sessionLabel: row.sessionLabel,
              })
            )
          );
          rows = await listAttendanceCheckinsForDate(selectedTeam, reviewDate);
        }

        if (!active) return;
        setReviewCheckins(rows);
        setSheets((prev) => {
          const currentSheet = normalizeRuntimeSheet(prev[selectedTeam], selectedTeam);
          const hydratedSheet = applyPendingCheckinsToSheet(currentSheet, selectedTeam, rows);
          if (hydratedSheet === currentSheet) return prev;
          const next = {
            ...prev,
            [selectedTeam]: hydratedSheet,
          };
          sheetsRef.current = next;
          return next;
        });
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load attendance check-ins", err);
        setReviewCheckins([]);
      } finally {
        if (active) {
          setLoadingReviewCheckins(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [authLoading, isCoach, selectedTeam, reviewDate]);

  useEffect(() => {
    if (reportSourceDates.length === 0) {
      setReportStartDate("");
      setReportEndDate("");
      return;
    }
    if (reportRangePreset === "custom") {
      const minDate = reportSourceDates[0];
      const maxDate = reportSourceDates[reportSourceDates.length - 1];
      setReportStartDate((prev) => prev || minDate);
      setReportEndDate((prev) => prev || maxDate);
      return;
    }
    const nextRange = resolveReportPresetRange(reportRangePreset, reportSourceDates);
    setReportStartDate(nextRange.start);
    setReportEndDate(nextRange.end);
  }, [selectedTeam, reportSourceDates, reportRangePreset]);

  const reportRange = useMemo(() => {
    let start = reportStartDate.trim();
    let end = reportEndDate.trim();
    if (start && end && start > end) {
      [start, end] = [end, start];
    }
    return { start, end };
  }, [reportStartDate, reportEndDate]);
  const reportPresetLabel =
    REPORT_RANGE_PRESET_OPTIONS.find((option) => option.value === reportRangePreset)
      ?.label ?? "Custom Range";

  const reportDates = useMemo(
    () =>
      reportSourceDates.filter(
        (date) =>
          (!reportRange.start || date >= reportRange.start) &&
          (!reportRange.end || date <= reportRange.end)
      ),
    [reportSourceDates, reportRange]
  );

  const reportWeeks = useMemo<AttendanceReportWeek[]>(() => {
    const grouped = new Map<string, string[]>();
    reportDates.forEach((date) => {
      const key = getWeekStartKey(date);
      const existing = grouped.get(key) ?? [];
      existing.push(date);
      grouped.set(key, existing);
    });
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, dates]) => ({
        key,
        label: getWeekLabel(key),
        dates,
      }));
  }, [reportDates]);

  const reportAthletes = useMemo(
    () =>
      selectedSheet.athletes
        .filter((athlete) => athlete.level === selectedTeam)
        .sort((a, b) => {
          const last = a.lastName.localeCompare(b.lastName);
          if (last !== 0) return last;
          return a.firstName.localeCompare(b.firstName);
        }),
    [selectedSheet.athletes, selectedTeam]
  );

  const reportRows = useMemo<AttendanceReportRow[]>(() => {
    const lastSixDates = reportDates.slice(-6);
    return reportAthletes
      .map((athlete) => {
        const record = selectedSheet.records[athlete.id] ?? {};
        const attended = reportDates.reduce(
          (sum, date) => sum + (record[date] ? 1 : 0),
          0
        );
        const missed = reportDates.length - attended;
        const pct = percentFromCounts(attended, reportDates.length);
        const lastSixAttended = lastSixDates.reduce(
          (sum, date) => sum + (record[date] ? 1 : 0),
          0
        );
        const lastSixPct = percentFromCounts(lastSixAttended, lastSixDates.length);

        let missedStreak = 0;
        for (let i = reportDates.length - 1; i >= 0; i -= 1) {
          const date = reportDates[i];
          if (record[date]) break;
          missedStreak += 1;
        }

        const weekly: Record<string, WeeklySummary> = {};
        reportWeeks.forEach((week) => {
          const weekAttended = week.dates.reduce(
            (sum, date) => sum + (record[date] ? 1 : 0),
            0
          );
          weekly[week.key] = {
            attended: weekAttended,
            total: week.dates.length,
            pct: percentFromCounts(weekAttended, week.dates.length),
          };
        });

        return {
          athlete,
          attended,
          missed,
          pct,
          lastSixPct,
          missedStreak,
          tier: tierFromPercent(pct),
          weekly,
        };
      })
      .sort((a, b) => {
        if (b.pct !== a.pct) return b.pct - a.pct;
        const last = a.athlete.lastName.localeCompare(b.athlete.lastName);
        if (last !== 0) return last;
        return a.athlete.firstName.localeCompare(b.athlete.firstName);
      });
  }, [reportAthletes, reportDates, reportWeeks, selectedSheet.records]);

  const reportSummary = useMemo(() => {
    const playerCount = reportRows.length;
    const sessionCount = reportDates.length;
    const possibleChecks = playerCount * sessionCount;
    const attendedChecks = reportRows.reduce((sum, row) => sum + row.attended, 0);
    const teamAveragePct = percentFromCounts(attendedChecks, possibleChecks);
    const highCount = reportRows.filter((row) => row.tier === "high").length;
    const lowCount = reportRows.filter((row) => row.tier === "low").length;
    const watchCount = reportRows.filter((row) => row.tier === "watch").length;
    const topAthletes = [...reportRows]
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 5);
    const atRiskAthletes = [...reportRows]
      .filter((row) => row.tier === "low")
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
    const watchAthletes = [...reportRows]
      .filter((row) => row.tier === "watch")
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 5);
    return {
      playerCount,
      sessionCount,
      attendedChecks,
      possibleChecks,
      teamAveragePct,
      highCount,
      lowCount,
      watchCount,
      topAthletes,
      atRiskAthletes,
      watchAthletes,
    };
  }, [reportRows, reportDates]);

  const reportRangeLabel =
    reportDates.length > 0
      ? `${formatMonthDay(reportDates[0])} - ${formatMonthDay(
          reportDates[reportDates.length - 1]
        )}`
      : "No Dates";

  const handleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  }, [sortField, sortDirection]);

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

  const handleSetError = useCallback((team: Team, message: string | null) => {
    setTeamErrors((prev) => ({
      ...prev,
      [team]: message,
    }));
  }, []);

  const clearToggleSaveTimer = useCallback((team: Team) => {
    const timer = toggleSaveTimerRef.current[team];
    if (typeof timer === "number") {
      window.clearTimeout(timer);
      delete toggleSaveTimerRef.current[team];
    }
  }, []);

  const persistTeamSheet = async (
    team: Team,
    options: { showFlash?: boolean } = {}
  ) => {
    const showFlash = options.showFlash ?? false;
    if (saveInFlightRef.current[team]) {
      saveQueuedRef.current[team] = true;
      if (showFlash) {
        saveQueuedFlashRef.current[team] = true;
      }
      return;
    }

    saveInFlightRef.current[team] = true;
    setSaving((prev) => ({ ...prev, [team]: true }));
    handleSetError(team, null);

    try {
      await saveAttendanceSheet(normalizeRuntimeSheet(sheetsRef.current[team], team));
      const fresh = await loadAttendanceSheet(team);
      setSheets((prev) => {
        const next = {
          ...prev,
          [team]: fresh,
        };
        sheetsRef.current = next;
        return next;
      });
      setDirty((prev) => ({ ...prev, [team]: false }));
      if (showFlash) {
        setFlash(`Saved ${formatTeamLabel(team)} Attendance.`);
      }
    } catch (err: any) {
      const message =
        err?.message ?? "Could Not Save Attendance. Try Again Shortly.";
      handleSetError(team, message);
    } finally {
      saveInFlightRef.current[team] = false;
      setSaving((prev) => ({ ...prev, [team]: false }));

      if (saveQueuedRef.current[team]) {
        const queuedFlash = saveQueuedFlashRef.current[team];
        saveQueuedRef.current[team] = false;
        saveQueuedFlashRef.current[team] = false;
        void persistTeamSheet(team, { showFlash: queuedFlash });
      }
    }
  };

  const queueToggleAutosave = (team: Team) => {
    clearToggleSaveTimer(team);
    toggleSaveTimerRef.current[team] = window.setTimeout(() => {
      delete toggleSaveTimerRef.current[team];
      void persistTeamSheet(team);
    }, TOGGLE_AUTOSAVE_DELAY_MS);
  };

  const updateSheet = (team: Team, updater: (sheet: AttendanceSheet) => AttendanceSheet) => {
    setSheets((prev) => {
      const nextSheet = normalizeRuntimeSheet(updater(normalizeRuntimeSheet(prev[team], team)), team);
      const next = {
        ...prev,
        [team]: nextSheet,
      };
      sheetsRef.current = next;
      return next;
    });
    setDirty((prev) => ({
      ...prev,
      [team]: true,
    }));
  };

  const handleAddDate = (team: Team) => {
    const sheet = normalizeRuntimeSheet(sheets[team], team);
    const newDate = nextAvailableDate(sheet.dates);
    updateSheet(team, (current) => {
      if (current.dates.includes(newDate)) {
        return current;
      }
      const nextDates = [...current.dates, newDate];
      const nextRecords = { ...current.records };
      const nextSessionsByDate = { ...current.sessionsByDate };
      const nextSessionLocks = { ...current.sessionLocks };
      const nextLockedDates = { ...current.lockedDates, [newDate]: false };
      const defaultSessions = cloneDefaultDateSessions();
      nextSessionsByDate[newDate] = defaultSessions;
      nextSessionLocks[newDate] = defaultSessions.reduce<Record<string, boolean>>(
        (acc, session) => {
          acc[session.key] = false;
          return acc;
        },
        {}
      );
      current.athletes.forEach((athlete) => {
        const row = { ...(nextRecords[athlete.id] ?? {}) };
        row[newDate] = row[newDate] ?? false;
        nextRecords[athlete.id] = row;
      });
      return {
        ...current,
        dates: nextDates,
        records: nextRecords,
        sessionsByDate: nextSessionsByDate,
        sessionLocks: nextSessionLocks,
        lockedDates: nextLockedDates,
      };
    });
    handleSetError(team, null);
  };

  const handleRemoveDate = (team: Team, date: string) => {
    updateSheet(team, (current) => {
      if (!current.dates.includes(date)) return current;
      const nextDates = current.dates.filter((d) => d !== date);
      const nextRecords: AttendanceSheet["records"] = {};
      const nextSessionsByDate = { ...current.sessionsByDate };
      delete nextSessionsByDate[date];
      const nextSessionLocks = { ...current.sessionLocks };
      delete nextSessionLocks[date];
      const nextLockedDates = { ...current.lockedDates };
      delete nextLockedDates[date];
      Object.entries(current.records).forEach(([athleteId, row]) => {
        const nextRow = { ...row };
        delete nextRow[date];
        nextDates.forEach((d) => {
          if (!(d in nextRow)) nextRow[d] = false;
        });
        nextRecords[athleteId] = nextRow;
      });
      return {
        ...current,
        dates: nextDates,
        records: nextRecords,
        sessionsByDate: nextSessionsByDate,
        sessionLocks: nextSessionLocks,
        lockedDates: nextLockedDates,
      };
    });
    handleSetError(team, null);
  };

  const handleDateChange = (team: Team, index: number, value: string) => {
    const next = value.trim();
    const teamSheet = normalizeRuntimeSheet(sheets[team], team);
    const currentDate = teamSheet.dates[index];
    if (!currentDate) return;
    if (!next) {
      handleRemoveDate(team, currentDate);
      return;
    }
    if (dateHasAnyLockedSession(teamSheet, currentDate)) {
      handleSetError(team, "Unlock Sessions For This Date Before Renaming It.");
      return;
    }
    if (teamSheet.dates.some((date, idx) => date === next && idx !== index)) {
      handleSetError(team, "That Date Already Exists On This Sheet.");
      return;
    }
    updateSheet(team, (current) => {
      const nextDates = [...current.dates];
      nextDates[index] = next;
      const nextRecords: AttendanceSheet["records"] = {};
      const nextSessionsByDate = { ...current.sessionsByDate };
      const sessionsForDate = nextSessionsByDate[currentDate] ?? [];
      delete nextSessionsByDate[currentDate];
      nextSessionsByDate[next] = sessionsForDate;
      const nextSessionLocks = { ...current.sessionLocks };
      const sessionLocksForDate = nextSessionLocks[currentDate] ?? {};
      delete nextSessionLocks[currentDate];
      nextSessionLocks[next] = sessionLocksForDate;
      const nextLockedDates = { ...current.lockedDates };
      const wasLocked = nextLockedDates[currentDate] === true;
      delete nextLockedDates[currentDate];
      nextLockedDates[next] = wasLocked;
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
      return {
        ...current,
        dates: nextDates,
        records: nextRecords,
        sessionsByDate: nextSessionsByDate,
        sessionLocks: nextSessionLocks,
        lockedDates: nextLockedDates,
      };
    });
    handleSetError(team, null);
  };

  const handleSessionLabelChange = (
    team: Team,
    date: string,
    sessionKey: string,
    value: string
  ) => {
    updateSheet(team, (current) => {
      const sessions = current.sessionsByDate?.[date] ?? [];
      const nextSessions = sessions.map((session, index) =>
        session.key === sessionKey
          ? {
              ...session,
              label: sanitizeSessionLabel(value, `Session ${index + 1}`),
            }
          : session
      );
      return {
        ...current,
        sessionsByDate: {
          ...current.sessionsByDate,
          [date]: nextSessions,
        },
      };
    });
    queueToggleAutosave(team);
  };

  const handleAddSessionToDate = (team: Team, date: string) => {
    updateSheet(team, (current) => {
      const sessions = current.sessionsByDate?.[date] ?? [];
      const nextKey = nextDateSessionKey(sessions);
      const nextSessions = [
        ...sessions,
        {
          key: nextKey,
          label: `Session ${sessions.length + 1}`,
        },
      ];
      const nextSessionLocks = {
        ...(current.sessionLocks?.[date] ?? {}),
        [nextKey]: false,
      };
      return {
        ...current,
        sessionsByDate: {
          ...current.sessionsByDate,
          [date]: nextSessions,
        },
        sessionLocks: {
          ...current.sessionLocks,
          [date]: nextSessionLocks,
        },
        lockedDates: {
          ...current.lockedDates,
          [date]: false,
        },
      };
    });
    queueToggleAutosave(team);
    handleSetError(team, null);
  };

  const handleRemoveSessionFromDate = (team: Team, date: string, sessionKey: string) => {
    updateSheet(team, (current) => {
      const sessions = current.sessionsByDate?.[date] ?? [];
      if (sessions.length <= 1) {
        return current;
      }
      const nextSessions = sessions.filter((session) => session.key !== sessionKey);
      const nextLocksRow = { ...(current.sessionLocks?.[date] ?? {}) };
      delete nextLocksRow[sessionKey];
      const allLocked =
        nextSessions.length > 0 &&
        nextSessions.every((session) => nextLocksRow[session.key] === true);
      return {
        ...current,
        sessionsByDate: {
          ...current.sessionsByDate,
          [date]: nextSessions,
        },
        sessionLocks: {
          ...current.sessionLocks,
          [date]: nextLocksRow,
        },
        lockedDates: {
          ...current.lockedDates,
          [date]: allLocked,
        },
      };
    });
    queueToggleAutosave(team);
    handleSetError(team, null);
  };

  const handleToggleSessionLock = async (
    team: Team,
    date: string,
    sessionKey: string,
    lockNext: boolean
  ) => {
    if (!date || !sessionKey) return;
    if (dirty[team]) {
      setFlash("Save Attendance Before Locking Sessions.");
      return;
    }
    const token = `${date}__${sessionKey}`;
    setLockingSessionKey(token);
    try {
      await setAttendanceSessionLocked(team, date, sessionKey, lockNext);
      await refreshTeamAfterReview(team);
      setFlash(lockNext ? "Session Locked." : "Session Unlocked.");
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "attendance/pending-checkins") {
        setFlash("Review Pending Check-Ins For This Session Before Locking.");
      } else if (code === "attendance/session-not-found") {
        setFlash("That Session No Longer Exists.");
      } else if (code === "attendance/date-not-found") {
        setFlash("That Date Was Not Found On This Sheet.");
      } else {
        setFlash(err?.message ?? "Could Not Update Session Lock.");
      }
    } finally {
      setLockingSessionKey(null);
    }
  };

  const handleToggle = (team: Team, athleteId: string, date: string) => {
    const sheet = normalizeRuntimeSheet(sheetsRef.current[team], team);
    if (sheet.lockedDates?.[date]) {
      setFlash("This Date Is Locked. Unlock It To Make Changes.");
      return;
    }
    const athlete = sheet.athletes.find((row) => row.id === athleteId);
    const nextValue = !Boolean(sheet.records[athleteId]?.[date]);
    updateSheet(team, (current) => {
      const nextRecords = { ...current.records };
      const row = { ...(nextRecords[athleteId] ?? {}) };
      row[date] = nextValue;
      nextRecords[athleteId] = row;
      return { ...current, records: nextRecords };
    });
    queueToggleAutosave(team);

    if (athlete?.uid) {
      const athleteUid = athlete.uid;
      const coachDisplayName =
        typeof window !== "undefined"
          ? window.localStorage.getItem("pl-strength-display-name")?.trim() || undefined
          : undefined;
      const existingCheckin = reviewCheckins.find(
        (row) => row.uid === athleteUid && row.date === date
      );
      const sessionsForDate = sheet.sessionsByDate?.[date] ?? [];
      const fallbackSession = existingCheckin?.sessionKey
        ? sessionsForDate.find((session) => session.key === existingCheckin.sessionKey) ??
          sessionsForDate[0]
        : sessionsForDate[0];
      const sessionKey = existingCheckin?.sessionKey ?? fallbackSession?.key;
      const sessionLabel = existingCheckin?.sessionLabel ?? fallbackSession?.label;
      const nextStatus: "approved" | "rejected" = nextValue ? "approved" : "rejected";
      void updateAttendanceCheckinStatus({
        team,
        date,
        uid: athleteUid,
        status: nextStatus,
        reviewedByName: coachDisplayName,
        athleteId: athlete.id,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        sessionKey,
        sessionLabel,
      })
        .then((updated) => {
          if (!updated) return;
          if (team === selectedTeam && reviewDate === date) {
            setReviewCheckins((prev) => {
              const existingIndex = prev.findIndex(
                (row) => row.uid === athleteUid && row.date === date
              );
              if (existingIndex >= 0) {
                return prev.map((row, idx): AttendanceCheckin =>
                  idx === existingIndex
                    ? {
                        ...row,
                        status: nextStatus,
                        sessionKey: row.sessionKey ?? sessionKey,
                        sessionLabel: row.sessionLabel ?? sessionLabel,
                        reviewedByName: coachDisplayName,
                        reviewedAt: Date.now(),
                      }
                    : row
                );
              }
              const newCheckin: AttendanceCheckin = {
                id: `${team}__${date}__${athleteUid}`,
                team,
                date,
                dayKey: `${team}__${date}`,
                uid: athleteUid,
                athleteId: athlete.id,
                firstName: athlete.firstName,
                lastName: athlete.lastName,
                sessionKey,
                sessionLabel,
                status: nextStatus,
                reviewedAt: Date.now(),
                reviewedByName: coachDisplayName,
              };
              return [...prev, newCheckin];
            });
          }
        })
        .catch((err) => {
          console.warn("Failed to sync check-in status from table toggle", err);
        });
    }
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
    const number = formDraft.number.trim();
    const grade = formDraft.grade.trim();
    const height = formDraft.height.trim();
    const weight = formDraft.weight.trim();
    const level = formDraft.level;
    if (!first && !last) {
      handleSetError(level, "Enter At Least A First Or Last Name.");
      return;
    }
    const id = createId();
    updateSheet(level, (current) => {
      const nextAthlete = {
        id,
        firstName: first,
        lastName: last,
        level,
        ...(number ? { number } : {}),
        ...(grade ? { grade } : {}),
        ...(height ? { height } : {}),
        ...(weight ? { weight } : {}),
      };
      const nextAthletes = [
        ...current.athletes,
        nextAthlete,
      ];
      const nextRecords = { ...current.records };
      const row: Record<string, boolean> = {};
      current.dates.forEach((date) => {
        row[date] = false;
      });
      nextRecords[id] = row;
      return { ...current, athletes: nextAthletes, records: nextRecords };
    });
    setFormDraft({
      firstName: "",
      lastName: "",
      number: "",
      grade: "",
      height: "",
      weight: "",
      level: selectedTeam,
    });
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

  const buildReportDocumentHtml = (): string => {
    const generatedAt = new Date().toLocaleString();
    const rangeLabel =
      reportDates.length > 0
        ? `${formatMonthDay(reportDates[0])} - ${formatMonthDay(
            reportDates[reportDates.length - 1]
          )}`
        : "No attendance dates in range";

    const weekHeaderHtml = reportWeeks
      .map(
        (week) =>
          `<th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">${escapeHtml(
            week.label
          )}</th>`
      )
      .join("");

    const rowsHtml = reportRows
      .map((row) => {
        const weeklyCells = reportWeeks
          .map((week) => {
            const weekly = row.weekly[week.key] ?? { attended: 0, total: 0, pct: 0 };
            const bgColor =
              weekly.pct >= HIGH_ATTENDANCE_THRESHOLD
                ? "#ecfdf3"
                : weekly.pct < LOW_ATTENDANCE_THRESHOLD
                ? "#fff1f2"
                : "#fffbeb";
            return `<td style="border:1px solid #d1d5db;padding:6px;text-align:center;background:${bgColor};">${weekly.attended}/${weekly.total} (${weekly.pct.toFixed(
              0
            )}%)</td>`;
          })
          .join("");

        const statusColor =
          row.tier === "high" ? "#166534" : row.tier === "low" ? "#be123c" : "#92400e";

        return `
          <tr>
            <td style="border:1px solid #d1d5db;padding:6px;">${escapeHtml(
              row.athlete.number ?? "-"
            )}</td>
            <td style="border:1px solid #d1d5db;padding:6px;">${escapeHtml(
              row.athlete.firstName || "-"
            )}</td>
            <td style="border:1px solid #d1d5db;padding:6px;">${escapeHtml(
              row.athlete.lastName || "-"
            )}</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;">${escapeHtml(
              row.athlete.grade ?? "-"
            )}</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;">${row.attended}</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;">${row.missed}</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;">${row.pct.toFixed(1)}%</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;">${row.lastSixPct.toFixed(
              1
            )}%</td>
            <td style="border:1px solid #d1d5db;padding:6px;text-align:center;color:${statusColor};font-weight:600;">${tierLabel(
              row.tier
            )}</td>
            ${weeklyCells}
          </tr>
        `;
      })
      .join("");

    return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(formatTeamLabel(selectedTeam))} Attendance Report</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 20px; color: #111827; }
      h1 { margin: 0 0 8px 0; font-size: 22px; }
      p { margin: 2px 0; font-size: 13px; }
      .summary { display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap; }
      .summary-card { border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; min-width: 160px; }
      .summary-card strong { display: block; font-size: 18px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 10px; }
      thead th { position: sticky; top: 0; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(formatTeamLabel(selectedTeam))} Attendance Report</h1>
    <p><strong>Range:</strong> ${escapeHtml(rangeLabel)}</p>
    <p><strong>Preset:</strong> ${escapeHtml(reportPresetLabel)}</p>
    <p><strong>Generated:</strong> ${escapeHtml(generatedAt)}</p>
    <div class="summary">
      <div class="summary-card"><span>Players</span><strong>${reportSummary.playerCount}</strong></div>
      <div class="summary-card"><span>Sessions</span><strong>${reportSummary.sessionCount}</strong></div>
      <div class="summary-card"><span>Team Average</span><strong>${reportSummary.teamAveragePct.toFixed(
        1
      )}%</strong></div>
      <div class="summary-card"><span>High Attendance</span><strong>${reportSummary.highCount}</strong></div>
      <div class="summary-card"><span>At Risk</span><strong>${reportSummary.lowCount}</strong></div>
    </div>
    <table>
      <thead>
        <tr>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:left;background:#f8fafc;">Jersey #</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:left;background:#f8fafc;">First Name</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:left;background:#f8fafc;">Last Name</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Grade</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Attended</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Missed</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Attendance %</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Last 6 %</th>
          <th style="border:1px solid #d1d5db;padding:6px;text-align:center;background:#f8fafc;">Status</th>
          ${weekHeaderHtml}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </body>
</html>
    `.trim();
  };

  const handleExportReportCsv = () => {
    if (reportRows.length === 0 || reportDates.length === 0) {
      setFlash("No Attendance Report Data Available For The Selected Range.");
      return;
    }
    const weekHeaders = reportWeeks.map((week) => `Week ${week.label}`);
    const header = [
      "Jersey #",
      "First Name",
      "Last Name",
      "Grade",
      "Attended",
      "Missed",
      "Attendance %",
      "Last 6 Sessions %",
      "Status",
      ...weekHeaders,
    ];
    const lines: Array<Array<string | number>> = [header];
    reportRows.forEach((row) => {
      const weekCells = reportWeeks.map((week) => {
        const weekly = row.weekly[week.key] ?? { attended: 0, total: 0, pct: 0 };
        return `${weekly.attended}/${weekly.total} (${weekly.pct.toFixed(0)}%)`;
      });
      lines.push([
        row.athlete.number ?? "",
        row.athlete.firstName,
        row.athlete.lastName,
        row.athlete.grade ?? "",
        row.attended,
        row.missed,
        `${row.pct.toFixed(1)}%`,
        `${row.lastSixPct.toFixed(1)}%`,
        tierLabel(row.tier),
        ...weekCells,
      ]);
    });

    const csv = lines
      .map((line) => line.map((value) => csvEscape(value)).join(","))
      .join("\n");
    const fileRange = `${reportRange.start || "start"}_to_${
      reportRange.end || "end"
    }`;
    downloadBlob(
      `${selectedTeam}-attendance-report-${fileRange}.csv`,
      csv,
      "text/csv;charset=utf-8;"
    );
    setFlash(`Exported ${formatTeamLabel(selectedTeam)} Attendance CSV.`);
  };

  const handleExportReportWord = () => {
    if (reportRows.length === 0 || reportDates.length === 0) {
      setFlash("No Attendance Report Data Available For The Selected Range.");
      return;
    }
    const fileRange = `${reportRange.start || "start"}_to_${
      reportRange.end || "end"
    }`;
    downloadBlob(
      `${selectedTeam}-attendance-report-${fileRange}.doc`,
      buildReportDocumentHtml(),
      "application/msword;charset=utf-8;"
    );
    setFlash(`Exported ${formatTeamLabel(selectedTeam)} Attendance Word Report.`);
  };

  const handleExportReportPdf = () => {
    if (reportRows.length === 0 || reportDates.length === 0) {
      setFlash("No Attendance Report Data Available For The Selected Range.");
      return;
    }
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    frame.style.opacity = "0";

    const cleanup = () => {
      window.setTimeout(() => {
        frame.remove();
      }, 1200);
    };

    frame.onload = () => {
      const targetWindow = frame.contentWindow;
      if (!targetWindow) {
        setFlash("Could Not Open PDF Export Window.");
        cleanup();
        return;
      }
      window.setTimeout(() => {
        try {
          targetWindow.focus();
          targetWindow.print();
          setFlash(`Opened PDF Print For ${formatTeamLabel(selectedTeam)} Attendance.`);
        } catch (_) {
          setFlash("Could Not Launch PDF Print. Try Again.");
        } finally {
          cleanup();
        }
      }, 350);
    };

    frame.srcdoc = buildReportDocumentHtml();
    document.body.appendChild(frame);
  };

  const handleExportSocialPng = async (mode: "hype" | "alert") => {
    if (reportRows.length === 0 || reportDates.length === 0) {
      setFlash("No Attendance Report Data Available For The Selected Range.");
      return;
    }

    const isHype = mode === "hype";
    const players = isHype
      ? [...reportRows].sort((a, b) => b.pct - a.pct).slice(0, 6)
      : reportSummary.atRiskAthletes.length > 0
      ? reportSummary.atRiskAthletes.slice(0, 6)
      : reportSummary.watchAthletes.slice(0, 6);

    if (players.length === 0) {
      setFlash(
        isHype
          ? "No Eligible Players Found For Hype PNG."
          : "No At-Risk Or Watch Players Found For Alert PNG."
      );
      return;
    }

    const width = 1080;
    const height = 1350;
    const pixelRatio = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * pixelRatio;
    canvas.height = height * pixelRatio;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setFlash("Could Not Create PNG Export.");
      return;
    }

    ctx.scale(pixelRatio, pixelRatio);

    const [dragonLogo, plLogo] = await Promise.all([
      loadImageMaybe("/assets/dragon.png"),
      loadImageMaybe("/assets/pl.png"),
    ]);

    const background = ctx.createLinearGradient(0, 0, width, height);
    if (isHype) {
      background.addColorStop(0, "#111217");
      background.addColorStop(0.55, "#232a34");
      background.addColorStop(1, "#8b1d1d");
    } else {
      background.addColorStop(0, "#1b1012");
      background.addColorStop(0.5, "#3f1418");
      background.addColorStop(1, "#9f1d1d");
    }
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.16;
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 6; i += 1) {
      const radius = 70 + i * 24;
      ctx.beginPath();
      ctx.arc(width - 120 - i * 120, 90 + i * 110, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (dragonLogo) {
      if (isHype) {
        const bannerWidth = width * 1.08;
        const scale = bannerWidth / dragonLogo.width;
        const drawWidth = dragonLogo.width * scale;
        const drawHeight = dragonLogo.height * scale;
        const drawX = (width - drawWidth) / 2;
        const drawY = 8;
        ctx.save();
        ctx.globalAlpha = 0.24;
        ctx.drawImage(dragonLogo, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      } else {
        const maxWidth = width * 0.84;
        const maxHeight = height * 0.7;
        const scale = Math.min(maxWidth / dragonLogo.width, maxHeight / dragonLogo.height);
        const drawWidth = dragonLogo.width * scale;
        const drawHeight = dragonLogo.height * scale;
        const drawX = (width - drawWidth) / 2;
        const drawY = (height - drawHeight) / 2 + 70;
        ctx.save();
        ctx.globalAlpha = 0.11;
        ctx.drawImage(dragonLogo, drawX, drawY, drawWidth, drawHeight);
        ctx.restore();
      }
    }

    if (plLogo) {
      const badgeSize = 120;
      ctx.save();
      ctx.globalAlpha = 0.2;
      ctx.drawImage(plLogo, width - badgeSize - 54, 48, badgeSize, badgeSize);
      ctx.restore();

      const watermarkScale = Math.min(
        (width * 0.36) / plLogo.width,
        (height * 0.24) / plLogo.height
      );
      const watermarkWidth = plLogo.width * watermarkScale;
      const watermarkHeight = plLogo.height * watermarkScale;
      ctx.save();
      ctx.globalAlpha = isHype ? 0.12 : 0.1;
      ctx.drawImage(
        plLogo,
        width - watermarkWidth - 38,
        height - watermarkHeight - 38,
        watermarkWidth,
        watermarkHeight
      );
      ctx.restore();
    }

    ctx.fillStyle = isHype ? "rgba(17,24,39,0.40)" : "rgba(255,255,255,0.13)";
    drawRoundedRect(ctx, 44, 34, width - 88, 150, 24);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = '800 56px "Segoe UI", Arial, sans-serif';
    ctx.fillText(
      isHype ? "ATTENDANCE LEADERS" : "ATTENDANCE ALERT",
      76,
      120
    );

    ctx.fillStyle = "#fecaca";
    ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
    const subtitle = isHype
      ? "Consistency And Commitment"
      : reportSummary.atRiskAthletes.length > 0
      ? "Players below 70% attendance"
      : "Closest to at-risk";
    ctx.fillText(subtitle, 76, 158);

    const cardX = 58;
    const cardWidth = width - cardX * 2;
    const cardHeight = 140;
    const cardGap = 14;
    const listStartY = 220;

    players.forEach((row, index) => {
      const y = listStartY + index * (cardHeight + cardGap);
      ctx.fillStyle = isHype ? "rgba(248,250,252,0.97)" : "rgba(255,255,255,0.96)";
      drawRoundedRect(ctx, cardX, y, cardWidth, cardHeight, 20);
      ctx.fill();

      ctx.strokeStyle = isHype ? "rgba(185,28,28,0.42)" : "rgba(239,68,68,0.35)";
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, cardX, y, cardWidth, cardHeight, 20);
      ctx.stroke();

      ctx.fillStyle = isHype ? "#b91c1c" : "#991b1b";
      ctx.beginPath();
      ctx.arc(cardX + 44, y + 40, 24, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = '800 24px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), cardX + 44, y + 48);
      ctx.textAlign = "left";

      const playerName = `${row.athlete.firstName} ${row.athlete.lastName}`.trim();
      const identity = `${row.athlete.number ? `#${row.athlete.number} ` : ""}${playerName || "Athlete"}`;
      ctx.fillStyle = "#0f172a";
      ctx.font = '700 32px "Segoe UI", Arial, sans-serif';
      ctx.fillText(identity, cardX + 84, y + 53);

      const details = `Grade ${row.athlete.grade || "-"}   Attended ${row.attended}/${reportSummary.sessionCount}   Missed ${row.missed}`;
      ctx.fillStyle = "#334155";
      ctx.font = '600 20px "Segoe UI", Arial, sans-serif';
      ctx.fillText(details, cardX + 84, y + 88);

      const streakText = row.missedStreak > 0 ? `${row.missedStreak} missed in a row` : "No current missed streak";
      ctx.fillStyle = "#991b1b";
      ctx.font = '600 18px "Segoe UI", Arial, sans-serif';
      ctx.fillText(streakText, cardX + 84, y + 116);

      ctx.fillStyle = "#0f172a";
      ctx.font = '800 42px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(`${row.pct.toFixed(1)}%`, cardX + cardWidth - 24, y + 56);
      ctx.textAlign = "left";

      const statusColor =
        row.tier === "high"
          ? isHype
            ? "#991b1b"
            : "#166534"
          : row.tier === "low"
          ? "#be123c"
          : "#92400e";
      ctx.fillStyle = statusColor;
      ctx.font = '700 19px "Segoe UI", Arial, sans-serif';
      ctx.textAlign = "right";
      ctx.fillText(tierLabel(row.tier).toUpperCase(), cardX + cardWidth - 24, y + 89);
      ctx.textAlign = "left";
    });

    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = '600 19px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Generated ${new Date().toLocaleString()}`, 58, height - 48);
    ctx.textAlign = "right";
    ctx.fillText("PL Strength Attendance", width - 58, height - 48);
    ctx.textAlign = "left";

    const presetSlug = reportRangePreset.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const fileRange = `${reportRange.start || "start"}_to_${
      reportRange.end || "end"
    }`;
    const fileName = `${selectedTeam}-attendance-${
      isHype ? "hype" : "alert"
    }-${presetSlug}-${fileRange}.png`;

    exportCanvasPng(canvas, fileName);
    setFlash(
      isHype
        ? `Exported ${formatTeamLabel(selectedTeam)} Hype PNG.`
        : `Exported ${formatTeamLabel(selectedTeam)} Alert PNG.`
    );
  };

  const refreshTeamAfterReview = async (team: Team) => {
    const [freshSheet, freshCheckins] = await Promise.all([
      loadAttendanceSheet(team),
      reviewDate ? listAttendanceCheckinsForDate(team, reviewDate) : Promise.resolve([]),
    ]);
    const hydratedSheet = applyPendingCheckinsToSheet(freshSheet, team, freshCheckins);
    setSheets((prev) => {
      const next = {
        ...prev,
        [team]: hydratedSheet,
      };
      sheetsRef.current = next;
      return next;
    });
    setDirty((prev) => ({ ...prev, [team]: false }));
    setTeamErrors((prev) => ({ ...prev, [team]: null }));
    setReviewCheckins(freshCheckins);
  };

  const handleReviewCheckin = async (
    checkin: AttendanceCheckin,
    status: "approved" | "rejected"
  ) => {
    if (!reviewDate || checkin.date !== reviewDate) return;
    if (selectedDirty) {
      setFlash("Save Attendance Before Reviewing Check-Ins.");
      return;
    }
    if (reviewDateLocked) {
      setFlash("Unlock This Date Before Reviewing Check-Ins.");
      return;
    }

    const coachDisplayName =
      typeof window !== "undefined"
        ? window.localStorage.getItem("pl-strength-display-name")?.trim() || undefined
        : undefined;

    setReviewingCheckinId(checkin.id);
    try {
      await reviewAttendanceCheckin({
        team: selectedTeam,
        date: checkin.date,
        uid: checkin.uid,
        status,
        reviewedByName: coachDisplayName,
      });
      await refreshTeamAfterReview(selectedTeam);
      setFlash(
        status === "approved"
          ? "Check-In Approved And Attendance Updated."
          : "Check-In Rejected."
      );
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "attendance/checkin-not-found") {
        setFlash("That Check-In Is No Longer Available. Refreshing...");
      } else if (code === "attendance/date-locked") {
        setFlash("This Date Is Locked.");
      } else {
        setFlash(err?.message ?? "Could Not Review Check-In.");
      }
      try {
        await refreshTeamAfterReview(selectedTeam);
      } catch (_) {
        // ignore secondary refresh errors
      }
    } finally {
      setReviewingCheckinId(null);
    }
  };

  const handleToggleDateLock = async (team: Team, date: string, lockNext: boolean) => {
    if (!date) return;
    if (dirty[team]) {
      setFlash("Save Attendance Before Locking Dates.");
      return;
    }
    setLockingDate(date);
    try {
      const coachDisplayName =
        typeof window !== "undefined"
          ? window.localStorage.getItem("pl-strength-display-name")?.trim() || undefined
          : undefined;
      const result = await setAttendanceDateLocked(
        team,
        date,
        lockNext,
        coachDisplayName
      );
      await refreshTeamAfterReview(team);
      if (lockNext && result.autoApprovedPending > 0) {
        setFlash(
          `Locked ${formatDateLabel(
            date
          )}. All pending requests have been approved.`
        );
      } else {
        setFlash(
          lockNext
            ? `Locked ${formatDateLabel(date)}.`
            : `Unlocked ${formatDateLabel(date)}.`
        );
      }
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "attendance/date-not-found") {
        setFlash("That Date Was Not Found On This Sheet.");
      } else {
        setFlash(err?.message ?? "Could Not Update Date Lock.");
      }
    } finally {
      setLockingDate(null);
    }
  };

  const handleSave = async (team: Team) => {
    clearToggleSaveTimer(team);
    await persistTeamSheet(team, { showFlash: true });
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
      <div className="card space-y-2 p-3 sm:space-y-3 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900 sm:text-2xl">Attendance</h1>
            <p className="hidden text-sm text-gray-600 sm:block">
              Track Lift Day Attendance Separately For Each Football Team.
            </p>
          </div>
          <div className="flex w-full gap-0.5 overflow-x-auto pb-0.5 sm:w-auto sm:gap-2 sm:overflow-visible sm:pb-0">
            {visibleTeams.map((team) => (
              <button
                key={team}
                type="button"
                onClick={() => setSelectedTeam(team)}
                className={[
                  "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold leading-tight transition sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm sm:font-medium",
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

      <div className="rounded-2xl border border-slate-200 bg-white/95 shadow-sm">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
          onClick={() => setIsAddAthleteCollapsed((prev) => !prev)}
          aria-expanded={!isAddAthleteCollapsed}
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
              +
            </span>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-800">
                Quick Add Athlete
              </h3>
              <p className="text-[11px] text-slate-500">
                Name Is Required. Everything Else Is Optional.
              </p>
            </div>
          </div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
            {isAddAthleteCollapsed ? "Show" : "Hide"}
          </span>
        </button>

        {!isAddAthleteCollapsed && (
          <form
            className="border-t border-slate-200 p-3 space-y-3"
            onSubmit={handleAddAthlete}
          >
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.2fr_1.2fr_.8fr_.8fr_1fr_auto]">
              <label className="sr-only" htmlFor="attendance-first-name">First Name</label>
              <input
                id="attendance-first-name"
                className="field h-10 bg-slate-50"
                value={formDraft.firstName}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, firstName: event.target.value }))
                }
                placeholder="First Name"
              />

              <label className="sr-only" htmlFor="attendance-last-name">Last Name</label>
              <input
                id="attendance-last-name"
                className="field h-10 bg-slate-50"
                value={formDraft.lastName}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, lastName: event.target.value }))
                }
                placeholder="Last Name"
              />

              <label className="sr-only" htmlFor="attendance-jersey">Jersey Number</label>
              <input
                id="attendance-jersey"
                className="field h-10 bg-slate-50"
                value={formDraft.number}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, number: event.target.value }))
                }
                placeholder="Jersey #"
              />

              <label className="sr-only" htmlFor="attendance-grade">Grade</label>
              <input
                id="attendance-grade"
                className="field h-10 bg-slate-50"
                value={formDraft.grade}
                onChange={(event) =>
                  setFormDraft((prev) => ({ ...prev, grade: event.target.value }))
                }
                placeholder="Grade"
              />

              <label className="sr-only" htmlFor="attendance-level">Level</label>
              <select
                id="attendance-level"
                className="field h-10 bg-slate-50"
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

              <button type="submit" className="btn btn-primary h-10 whitespace-nowrap">
                Add Athlete
              </button>
            </div>

            <details className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Optional Details
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="sr-only" htmlFor="attendance-height">Height</label>
                <input
                  id="attendance-height"
                  className="field h-10 bg-white"
                  value={formDraft.height}
                  onChange={(event) =>
                    setFormDraft((prev) => ({ ...prev, height: event.target.value }))
                  }
                  placeholder={`Height (6'1")`}
                />

                <label className="sr-only" htmlFor="attendance-weight">Weight</label>
                <input
                  id="attendance-weight"
                  className="field h-10 bg-white"
                  value={formDraft.weight}
                  onChange={(event) =>
                    setFormDraft((prev) => ({ ...prev, weight: event.target.value }))
                  }
                  placeholder="Weight (185)"
                />
              </div>
            </details>
          </form>
        )}
      </div>

      <div className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-800">
            {formatTeamLabel(selectedTeam)} Attendance Sheet
          </h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isMobileCoachBrowser && (
              <button
                type="button"
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 transition hover:border-slate-400 hover:bg-slate-50"
                onClick={() => setShowDesktopTableOnMobile((prev) => !prev)}
              >
                {showDesktopTableOnMobile ? "Mobile Athlete View" : "Desktop Table View"}
              </button>
            )}
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

        <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              Session Date
            </label>
            <select
              className="field min-w-44 bg-white text-sm"
              value={reviewDate}
              onChange={(event) => setReviewDate(event.target.value)}
              disabled={reportSourceDates.length === 0}
            >
              {reportSourceDates.length === 0 ? (
                <option value="">No Dates</option>
              ) : (
                reportSourceDates.map((date) => (
                  <option key={`session-setup-date-${date}`} value={date}>
                    {formatDateLabel(date)}
                  </option>
                ))
              )}
            </select>
          </div>

          {reviewDate ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                  Sessions For {formatMonthDay(reviewDate)}
                </h4>
                <button
                  type="button"
                  className="rounded-lg bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-slate-900"
                  onClick={() => handleAddSessionToDate(selectedTeam, reviewDate)}
                  disabled={selectedSaving}
                >
                  Add Session
                </button>
              </div>
              <div className="space-y-2">
                {reviewDateSessions.map((session, index) => {
                  const locked = reviewDateSessionLocks[session.key] === true;
                  const lockToken = `${reviewDate}__${session.key}`;
                  return (
                    <div
                      key={`${reviewDate}-${session.key}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"
                    >
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                        {index + 1}
                      </span>
                      <input
                        className="field h-9 min-w-44 flex-1 bg-white text-xs"
                        value={session.label}
                        onChange={(event) =>
                          handleSessionLabelChange(
                            selectedTeam,
                            reviewDate,
                            session.key,
                            event.target.value
                          )
                        }
                        placeholder={`Session ${index + 1}`}
                      />
                      <button
                        type="button"
                        className={[
                          "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition",
                          locked
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
                        ].join(" ")}
                        onClick={() =>
                          handleToggleSessionLock(
                            selectedTeam,
                            reviewDate,
                            session.key,
                            !locked
                          )
                        }
                        disabled={selectedSaving || lockingSessionKey === lockToken}
                      >
                        {lockingSessionKey === lockToken
                          ? "Saving..."
                          : locked
                          ? "Unlock"
                          : "Lock"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                        onClick={() =>
                          handleRemoveSessionFromDate(selectedTeam, reviewDate, session.key)
                        }
                        disabled={reviewDateSessions.length <= 1 || selectedSaving}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-500">
                Athletes Are Auto-Assigned To The First Unlocked Session. One Check-In Per Date.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              Add An Attendance Date To Start Session Setup.
            </div>
          )}
        </div>

        {useCompactMobileAthleteLayout ? (
          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
                Athlete Attendance
              </h3>
              <label className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Date
                <select
                  className="field min-w-40 bg-white text-xs"
                  value={mobileAthleteDate}
                  onChange={(event) => setReviewDate(event.target.value)}
                  disabled={reportSourceDates.length === 0}
                >
                  {reportSourceDates.length === 0 ? (
                    <option value="">No Dates</option>
                  ) : (
                    reportSourceDates.map((date) => (
                      <option key={`mobile-athlete-date-${date}`} value={date}>
                        {formatDateLabel(date)}
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            {visibleAthletes.length === 0 ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                No Athletes Added Yet. Use The Form Above To Add Someone.
              </div>
            ) : !mobileAthleteDate ? (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                Add Or Select An Attendance Date To Mark Athletes.
              </div>
            ) : (
              <div className="space-y-1.5">
                {visibleAthletes.map((athlete) => {
                  const athleteName = [athlete.firstName, athlete.lastName]
                    .filter(Boolean)
                    .join(" ")
                    .trim();
                  return (
                    <div
                      key={`mobile-athlete-${athlete.id}`}
                      className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2"
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 shrink-0 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        checked={Boolean(selectedSheet.records[athlete.id]?.[mobileAthleteDate])}
                        onChange={() => handleToggle(selectedTeam, athlete.id, mobileAthleteDate)}
                        disabled={selectedSaving || mobileAthleteDateLocked}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-slate-800">
                          {athleteName || "Unknown Athlete"}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          Jersey {athlete.number || "-"} - Grade {athlete.grade || "-"}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600 transition hover:bg-rose-50"
                        onClick={() => handleRemoveAthlete(selectedTeam, athlete.id)}
                        disabled={selectedSaving}
                      >
                        Remove
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-max table-auto divide-y divide-gray-200 text-sm">
            <thead>
              <tr className="bg-gray-50">
                <th
                  className="px-3 py-2 whitespace-nowrap text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
                  onClick={() => handleSort('number')}
                >
                  <div className="flex items-center gap-1">
                    Jersey #
                    {sortField === 'number' && (
                      <span className="text-xs">{sortDirection === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </div>
                </th>
                <th
                  className="px-3 py-2 whitespace-nowrap text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
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
                  className="px-3 py-2 whitespace-nowrap text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-100 select-none"
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
                  className="px-3 py-2 whitespace-nowrap text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
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
                  className="px-3 py-2 whitespace-nowrap text-left text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100 select-none"
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
                      {selectedSheet.lockedDates?.[date] ? (
                        <span className="rounded-full bg-rose-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-rose-700">
                          Locked
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Open
                        </span>
                      )}
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {(selectedSheet.sessionsByDate?.[date]?.length ?? 0) || 1} Sessions
                      </span>
                      <input
                        type="date"
                        value={date}
                        onChange={(event) =>
                          handleDateChange(selectedTeam, index, event.target.value)
                        }
                        disabled={selectedSaving || dateHasAnyLockedSession(selectedSheet, date)}
                        className="w-28 rounded-lg border border-gray-200 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        className={[
                          "rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide transition",
                          selectedSheet.lockedDates?.[date]
                            ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                            : "bg-slate-100 text-slate-700 hover:bg-slate-200",
                        ].join(" ")}
                        onClick={() =>
                          handleToggleDateLock(
                            selectedTeam,
                            date,
                            !Boolean(selectedSheet.lockedDates?.[date])
                          )
                        }
                        disabled={selectedSaving || lockingDate === date}
                      >
                        {lockingDate === date
                          ? "Saving..."
                          : selectedSheet.lockedDates?.[date]
                          ? "Unlock"
                          : "Lock"}
                      </button>
                      <button
                        type="button"
                        className="text-xs text-rose-500 hover:text-rose-600"
                        onClick={() => handleRemoveDate(selectedTeam, date)}
                        disabled={selectedSaving || dateHasAnyLockedSession(selectedSheet, date)}
                      >
                        Remove
                      </button>
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 whitespace-nowrap text-center text-gray-500 text-xs font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleAthletes.length === 0 ? (
                <tr>
                  <td
                    colSpan={selectedSheet.dates.length + 6}
                    className="px-3 py-5 text-center text-sm text-gray-500"
                  >
                    No Athletes Added Yet. Use The Form Above To Add Someone.
                  </td>
                </tr>
              ) : (
                visibleAthletes.map((athlete) => (
                  <tr key={athlete.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {athlete.number || "-"}
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">
                      {athlete.firstName || "-"}
                    </td>
                    <td className="px-3 py-2 text-sm font-medium text-gray-800">
                      {athlete.lastName || "-"}
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
                          disabled={selectedSaving || Boolean(selectedSheet.lockedDates?.[date])}
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
        )}

        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                Athlete Check-In Review
              </h3>
              <p className="text-xs text-slate-600">
                Athletes Can Check In For Open Dates. Coaches Approve/Reject, Then Lock The Day.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Date
              </label>
              <select
                className="field min-w-44 bg-white text-sm"
                value={reviewDate}
                onChange={(event) => setReviewDate(event.target.value)}
                disabled={reportSourceDates.length === 0}
              >
                {reportSourceDates.length === 0 ? (
                  <option value="">No Dates</option>
                ) : (
                  reportSourceDates.map((date) => (
                    <option key={date} value={date}>
                      {formatDateLabel(date)}
                    </option>
                  ))
                )}
              </select>
              {reviewDate && (
                <button
                  type="button"
                  className={[
                    "rounded-xl px-3 py-2 text-xs font-semibold text-white shadow-sm transition",
                    reviewDateLocked
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-slate-800 hover:bg-slate-900",
                  ].join(" ")}
                  onClick={() =>
                    handleToggleDateLock(selectedTeam, reviewDate, !reviewDateLocked)
                  }
                  disabled={lockingDate === reviewDate || selectedSaving}
                >
                  {lockingDate === reviewDate
                    ? "Saving..."
                    : reviewDateLocked
                    ? "Unlock All"
                    : "Lock All"}
                </button>
              )}
            </div>
          </div>

          {reviewDate ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center rounded-lg bg-amber-100 px-2 py-1 font-medium text-amber-700">
                Pending {pendingReviewCheckins.length}
              </span>
              <button
                type="button"
                className="inline-flex items-center rounded-lg bg-emerald-100 px-2 py-1 font-medium text-emerald-700 transition hover:bg-emerald-200"
                onClick={() => setReviewStatusModal("approved")}
              >
                Approved {approvedReviewCount}
              </button>
              <button
                type="button"
                className="inline-flex items-center rounded-lg bg-rose-100 px-2 py-1 font-medium text-rose-700 transition hover:bg-rose-200"
                onClick={() => setReviewStatusModal("rejected")}
              >
                Rejected {rejectedReviewCount}
              </button>
              <span
                className={[
                  "inline-flex items-center rounded-lg px-2 py-1 font-medium",
                  reviewDateLocked
                    ? "bg-rose-100 text-rose-700"
                    : "bg-emerald-100 text-emerald-700",
                ].join(" ")}
              >
                {reviewDateLocked ? "Date Locked" : "Date Open"}
              </span>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              Add An Attendance Date To Start Athlete Check-Ins.
            </div>
          )}

          {reviewDate && (
            <>
              {loadingReviewCheckins ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                  Loading Check-Ins...
                </div>
              ) : pendingReviewCheckins.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                  No Pending Check-Ins For This Date.
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingReviewCheckins.map((checkin) => {
                    const athleteName = [checkin.firstName, checkin.lastName]
                      .filter(Boolean)
                      .join(" ")
                      .trim();
                    const submittedLabel = checkin.submittedAt
                      ? new Date(checkin.submittedAt).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "Just Now";
                    const disabledAction =
                      reviewingCheckinId === checkin.id || reviewDateLocked;
                    return (
                      <div
                        key={checkin.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5"
                      >
                        <div className="min-w-0 flex items-center gap-2 text-xs text-slate-600">
                          <span className="truncate text-sm font-semibold text-slate-800">
                            {athleteName || "Unknown Athlete"}
                          </span>
                          <span className="hidden text-slate-300 sm:inline">•</span>
                          <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                            {checkin.sessionLabel || "Session"}
                          </span>
                          <span className="hidden text-slate-300 sm:inline">•</span>
                          <span className="shrink-0 text-[11px] text-slate-500">{submittedLabel}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleReviewCheckin(checkin, "approved")}
                            disabled={disabledAction}
                          >
                            {reviewingCheckinId === checkin.id ? "Saving..." : "Approve"}
                          </button>
                          <button
                            type="button"
                            className="rounded-md bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                            onClick={() => handleReviewCheckin(checkin, "rejected")}
                            disabled={disabledAction}
                          >
                            {reviewingCheckinId === checkin.id ? "Saving..." : "Reject"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {reviewStatusModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
            onClick={() => setReviewStatusModal(null)}
          >
            <div
              className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-800">
                    {reviewStatusModal === "approved"
                      ? "Approved Check-Ins"
                      : "Rejected Check-Ins"}
                  </h4>
                  <p className="text-xs text-slate-500">
                    {reviewDate ? formatDateLabel(reviewDate) : "Selected Date"}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-200"
                  onClick={() => setReviewStatusModal(null)}
                >
                  Close
                </button>
              </div>
              <div className="max-h-[62vh] overflow-y-auto p-3">
                {reviewStatusModalRows.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                    No check-ins in this status.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {reviewStatusModalRows.map((row) => {
                      const athleteName = [row.firstName, row.lastName]
                        .filter(Boolean)
                        .join(" ")
                        .trim();
                      const timestamp = row.reviewedAt ?? row.submittedAt;
                      const timeLabel = timestamp
                        ? new Date(timestamp).toLocaleString()
                        : "No timestamp";
                      return (
                        <div
                          key={`status-modal-${row.id}`}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="text-sm font-semibold text-slate-800">
                            {athleteName || "Unknown Athlete"}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {(row.sessionLabel || "Session") + " - " + timeLabel}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Attendance Report Section */}
        <div className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-emerald-50/30 p-5 space-y-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            onClick={() => setIsReportSectionCollapsed((prev) => !prev)}
            aria-expanded={!isReportSectionCollapsed}
          >
            <div>
              <h3 className="text-sm font-semibold tracking-wide text-slate-800">
                Attendance Report
              </h3>
              <p className="text-xs text-slate-600">
                {reportRangeLabel} • {reportPresetLabel}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-700">
              {isReportSectionCollapsed ? "Show" : "Hide"}
            </span>
          </button>

          {!isReportSectionCollapsed && (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3 pt-2">
                <div>
                  <p className="text-xs text-slate-600">
                    Quick Coach Snapshot With Weekly Breakdown And Export Options.
                  </p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Active Range: {reportRangeLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    Preset
                    <select
                      className="field bg-white min-w-44"
                      value={reportRangePreset}
                      onChange={(event) =>
                        setReportRangePreset(event.target.value as ReportRangePreset)
                      }
                    >
                      {REPORT_RANGE_PRESET_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    From
                    <input
                      type="date"
                      className="field bg-white min-w-36"
                      value={reportStartDate}
                      min={reportSourceDates[0] ?? undefined}
                      max={reportSourceDates[reportSourceDates.length - 1] ?? undefined}
                      onChange={(event) => {
                        setReportRangePreset("custom");
                        setReportStartDate(event.target.value);
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    To
                    <input
                      type="date"
                      className="field bg-white min-w-36"
                      value={reportEndDate}
                      min={reportSourceDates[0] ?? undefined}
                      max={reportSourceDates[reportSourceDates.length - 1] ?? undefined}
                      onChange={(event) => {
                        setReportRangePreset("custom");
                        setReportEndDate(event.target.value);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    onClick={handleExportReportCsv}
                  >
                    Export CSV
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary text-xs"
                    onClick={handleExportReportWord}
                  >
                    Export Word
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary text-xs"
                    onClick={handleExportReportPdf}
                  >
                    Export PDF
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-slate-800 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-slate-900"
                    onClick={() => handleExportSocialPng("hype")}
                  >
                    Export Hype PNG
                  </button>
                  <button
                    type="button"
                    className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700"
                    onClick={() => handleExportSocialPng("alert")}
                  >
                    Export Alert PNG
                  </button>
                </div>
              </div>

          {reportRows.length === 0 || reportDates.length === 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              No Attendance Data In This Range. Add Sessions Or Widen The Date Range.
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-[11px] sm:text-xs">
                  <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    Players <strong className="text-slate-900">{reportSummary.playerCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    Sessions <strong className="text-slate-900">{reportSummary.sessionCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 font-medium text-slate-700">
                    Team Avg <strong className="text-slate-900">{reportSummary.teamAveragePct.toFixed(1)}%</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 font-medium text-emerald-700">
                    High Att <strong className="text-emerald-800">{reportSummary.highCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 font-medium text-rose-700">
                    At Risk <strong className="text-rose-800">{reportSummary.lowCount}</strong>
                  </span>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Top Attendance</h4>
                  <div className="mt-3 space-y-2">
                    {reportSummary.topAthletes.map((row) => (
                      <div
                        key={`top-${row.athlete.id}`}
                        className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-xs"
                      >
                        <span className="font-medium text-slate-800">
                          {row.athlete.number ? `#${row.athlete.number} ` : ""}
                          {row.athlete.firstName} {row.athlete.lastName}
                        </span>
                        <span className="font-semibold text-emerald-700">{row.pct.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-700">Needs Attention</h4>
                  <div className="mt-3 space-y-2">
                    {reportSummary.atRiskAthletes.length > 0 ? (
                      reportSummary.atRiskAthletes.map((row) => (
                        <div
                          key={`risk-${row.athlete.id}`}
                          className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-slate-800">
                            {row.athlete.number ? `#${row.athlete.number} ` : ""}
                            {row.athlete.firstName} {row.athlete.lastName}
                          </span>
                          <span className="font-semibold text-rose-700">
                            {row.pct.toFixed(1)}% • {row.missedStreak} Missed In A Row
                          </span>
                        </div>
                      ))
                    ) : reportSummary.watchAthletes.length > 0 ? (
                      reportSummary.watchAthletes.map((row) => (
                        <div
                          key={`watch-${row.athlete.id}`}
                          className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-xs"
                        >
                          <span className="font-medium text-slate-800">
                            {row.athlete.number ? `#${row.athlete.number} ` : ""}
                            {row.athlete.firstName} {row.athlete.lastName}
                          </span>
                          <span className="font-semibold text-amber-700">
                            {row.pct.toFixed(1)}% • Watch
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                        No At-Risk Athletes In This Range.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Jersey #</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">First</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-600">Last</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Grade</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Att</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Miss</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Att %</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Last 6 %</th>
                      <th className="px-3 py-2 text-center font-semibold text-slate-600">Status</th>
                      {reportWeeks.map((week) => (
                        <th
                          key={week.key}
                          className="px-2 py-2 whitespace-nowrap text-center font-semibold text-slate-600"
                        >
                          {week.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportRows.map((row) => (
                      <tr key={`report-${row.athlete.id}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-700">{row.athlete.number || "-"}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.athlete.firstName || "-"}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{row.athlete.lastName || "-"}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.athlete.grade || "-"}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.attended}</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.missed}</td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-800">{row.pct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center text-slate-700">{row.lastSixPct.toFixed(1)}%</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${tierBadgeClass(row.tier)}`}>
                            {tierLabel(row.tier)}
                          </span>
                        </td>
                        {reportWeeks.map((week) => {
                          const weekly = row.weekly[week.key] ?? { attended: 0, total: 0, pct: 0 };
                          return (
                            <td
                              key={`${row.athlete.id}-${week.key}`}
                              className={`px-2 py-2 text-center font-medium ${weekCellClass(weekly.pct)}`}
                            >
                              {weekly.attended}/{weekly.total}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
            </>
          )}
        </div>

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
