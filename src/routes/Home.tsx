import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import {
  fetchAthleteSessions,
  fetchLastAttendanceCheckinDates,
  listRoster,
  loadProfileRemote,
  loadAttendanceSheet,
  subscribeToTeamSessions,
  ensureAnon,
  getStoredTeamSelection,
  TEAM_DEFINITIONS,
  loadAttendanceTeamStatus,
  loadAthleteAttendanceCheckin,
  submitAthleteAttendanceCheckin,
  selfCheckInToAttendanceSheet,
  subscribeExerciseLibraryStatus,
  normalizeTeam,
  formatTeamLabel,
  type AttendanceCheckin,
  type AttendanceSheet,
  type SessionRecord,
  type RosterEntry,
  type Profile,
  type Team,
  type Lift,
} from "../lib/db";
import { roundToPlate } from "../lib/tm";
import OnboardingWizard from "../components/OnboardingWizard";
import { useDevice } from "../lib/device";

const VIDEO_UPDATE_GLOW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ABBREVIATIONS = [
  {
    code: "TM",
    title: "Training Max",
    detail:
      "Weight You Could Lift For Around 2-3 Hard Reps. Every Plan And Sheet Uses This Number.",
  },
  {
    code: "1RM",
    title: "One-Rep Max",
    detail: "The Heaviest Weight You Can Lift Once With Solid Form.",
  },
  {
    code: "AMRAP",
    title: "As Many Reps As Possible",
    detail: "Push The Set, But Stop While You Still Have 1-2 Good Reps Left.",
  },
  {
    code: "PR",
    title: "Personal Record",
    detail: "Your Best Lift So Far. New PRs Mean Progress - Celebrate Them.",
  },
  {
    code: "RPE",
    title: "Rate of Perceived Exertion",
    detail: "How Tough A Set Feels From 1-10. RPE 8 Means About Two Reps Left.",
  },
  {
    code: "% Bar",
    title: "Percent of TM",
    detail:
      "Sheets Show Weights As A Percent Of Your TM So You Know What Plates To Load.",
  },
];

type AthleteActivity = {
  uid: string;
  name: string;
  recentSessions: SessionRecord[];
  lastWorkout?: number;
  lastCheckin?: number;
  lastProfileUpdate?: number;
  lastActivity?: number;
  weekCount: number;
  prCount: number;
};

type AthleteCheckinViewState = {
  team: Team;
  date: string;
  scheduled: boolean;
  locked: boolean;
  nextSession: { key: string; label: string } | null;
  checkin: AttendanceCheckin | null;
};

const formatLocalDateInput = (value: Date): string => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  const year = local.getFullYear();
  const month = `${local.getMonth() + 1}`.padStart(2, "0");
  const day = `${local.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export default function Home() {
  const navigate = useNavigate();
  const device = useDevice();
  const { isCoach } = useActiveAthlete();
  const [athleteActivity, setAthleteActivity] = useState<AthleteActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());
  const [checkinState, setCheckinState] = useState<AthleteCheckinViewState | null>(null);
  const [loadingCheckinState, setLoadingCheckinState] = useState(false);
  const [submittingCheckin, setSubmittingCheckin] = useState(false);
  const [checkinError, setCheckinError] = useState<string | null>(null);
  const [checkinNotice, setCheckinNotice] = useState<string | null>(null);
  const [selfCheckinStatus, setSelfCheckinStatus] = useState<"idle" | "loading" | "present" | "error">("idle");
  const [selfCheckinError, setSelfCheckinError] = useState<string | null>(null);
  const [attendanceSheets, setAttendanceSheets] = useState<AttendanceSheet[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [liveSessionFeed, setLiveSessionFeed] = useState<Array<SessionRecord & { athleteId: string }>>([]);
  const [showVideoUpdateGlow, setShowVideoUpdateGlow] = useState(false);
  const isMobileLayout = device.isMobile || (device.isTouch && !device.isDesktop);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readTeam = () => setTeamSelection(getStoredTeamSelection());
    readTeam();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pl-strength-team") {
        readTeam();
      }
    };
    const handleCustom = () => readTeam();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pl-team-change", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pl-team-change", handleCustom);
    };
  }, []);

  // Load profile and check if onboarding should show (for athletes)
  useEffect(() => {
    (async () => {
      try {
        const uid = await ensureAnon();
        const p = await loadProfileRemote(uid);
        setProfile(p);

        // Show onboarding if athlete has no TM set (first-time user)
        if (!isCoach && p) {
          const hasSkippedOnboarding = localStorage.getItem("pl-onboarding-skipped");
          const hasTM = p.tm && Object.keys(p.tm).length > 0;
          if (!hasTM && !hasSkippedOnboarding) {
            setShowOnboarding(true);
          }
        }
      } catch (err) {
        console.debug('Could not load profile', err);
      }
    })();
  }, [isCoach, teamSelection]);

  useEffect(() => {
    if (isCoach || !profile?.uid) {
      setCheckinState(null);
      setLoadingCheckinState(false);
      setCheckinError(null);
      setCheckinNotice(null);
      return;
    }

    const resolvedTeam = normalizeTeam(
      profile.team || profile.teamAnchor || teamSelection || ""
    );
    if (!resolvedTeam) {
      setCheckinState(null);
      setLoadingCheckinState(false);
      setCheckinError(null);
      return;
    }

    const today = formatLocalDateInput(new Date());
    let active = true;
    setLoadingCheckinState(true);
    setCheckinError(null);
    setCheckinNotice(null);

    (async () => {
      try {
        const status = await loadAttendanceTeamStatus(resolvedTeam);
        const scheduled = status.dates.includes(today);
        const sessionsForDate = scheduled ? status.sessionsByDate?.[today] ?? [] : [];
        const sessionLocks = scheduled ? status.sessionLocks?.[today] ?? {} : {};
        const nextSession =
          sessionsForDate.find((session) => sessionLocks[session.key] !== true) ?? null;
        const locked = scheduled ? !nextSession : false;
        const checkin = scheduled
          ? await loadAthleteAttendanceCheckin(resolvedTeam, today, profile.uid)
          : null;
        if (!active) return;
        setCheckinState({
          team: resolvedTeam,
          date: today,
          scheduled,
          locked,
          nextSession,
          checkin,
        });
      } catch (err) {
        if (!active) return;
        console.debug("Could Not Load Attendance Check-In State", err);
        setCheckinError("Could Not Load Today's Check-In Status.");
        setCheckinState({
          team: resolvedTeam,
          date: today,
          scheduled: false,
          locked: false,
          nextSession: null,
          checkin: null,
        });
      } finally {
        if (active) {
          setLoadingCheckinState(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [isCoach, profile?.uid, profile?.team, profile?.teamAnchor, teamSelection]);

  // Self-checkin status check for non-football athletes
  useEffect(() => {
    if (isCoach || !profile?.uid) {
      setSelfCheckinStatus("idle");
      return;
    }
    const resolvedTeam = normalizeTeam(profile.team || profile.teamAnchor || teamSelection || "");
    if (!resolvedTeam) return;
    const teamDef = TEAM_DEFINITIONS.find((d) => d.id === resolvedTeam);
    if (!teamDef || teamDef.sport === "football") return; // football uses the other flow

    // Check if already marked present today
    let active = true;
    setSelfCheckinStatus("loading");
    setSelfCheckinError(null);
    (async () => {
      try {
        const sheet = await loadAttendanceSheet(resolvedTeam);
        const today = formatLocalDateInput(new Date());
        const firstName = (profile.firstName ?? "").trim().toLowerCase();
        const lastName = (profile.lastName ?? "").trim().toLowerCase();
        const athleteEntry = sheet.athletes.find(
          (a) => (a.uid && a.uid === profile.uid) ||
            (firstName && lastName &&
              a.firstName.trim().toLowerCase() === firstName &&
              a.lastName.trim().toLowerCase() === lastName)
        );
        const alreadyPresent = athleteEntry
          ? sheet.records[athleteEntry.id]?.[today] === true
          : false;
        if (active) setSelfCheckinStatus(alreadyPresent ? "present" : "idle");
      } catch {
        if (active) setSelfCheckinStatus("idle");
      }
    })();
    return () => { active = false; };
  }, [isCoach, profile?.uid, profile?.team, profile?.teamAnchor, teamSelection]);

  // Load athlete activity for coaches
  useEffect(() => {
    if (!isCoach) return;

    (async () => {
      setLoadingActivity(true);
      try {
        const roster = await listRoster();
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        // Get coach's team to filter athletes
        const coachTeam = teamSelection;
        const coachTeamDef = coachTeam ? TEAM_DEFINITIONS.find(def => def.id === coachTeam) : null;
        const relatedTeams = coachTeamDef
          ? TEAM_DEFINITIONS
            .filter(
              (definition) =>
                definition.sport === coachTeamDef.sport &&
                definition.program === coachTeamDef.program
            )
            .map((definition) => definition.id as Team)
          : coachTeam
            ? [coachTeam]
            : [];
        const attendanceActivity: Record<string, number> = {};
        if (relatedTeams.length > 0) {
          const checkinMaps = await Promise.all(
            relatedTeams.map((teamId) => fetchLastAttendanceCheckinDates(teamId))
          );
          checkinMaps.forEach((map) => {
            Object.entries(map).forEach(([uid, timestamp]) => {
              if (!attendanceActivity[uid] || timestamp > attendanceActivity[uid]) {
                attendanceActivity[uid] = timestamp;
              }
            });
          });
        }

        const activities = await Promise.all(
          roster
            // Athletes are users without coach or admin roles
            .filter((r: RosterEntry) => !r.roles?.includes('coach') && !r.roles?.includes('admin'))
            // Filter by coach's sport/program (e.g., football varsity sees all football, not basketball)
            .filter((r: RosterEntry) => {
              const rowTeams = r.teamScopes && r.teamScopes.length > 0
                ? r.teamScopes
                : r.team
                  ? [r.team]
                  : [];
              if (!coachTeamDef || rowTeams.length === 0) return true; // Show all if no team filter
              return rowTeams.some((teamId) => {
                const athleteTeamDef = TEAM_DEFINITIONS.find(def => def.id === teamId);
                if (!athleteTeamDef) return false;
                // Match sport and program (allows varsity coach to see both varsity and JH in same sport)
                return athleteTeamDef.sport === coachTeamDef.sport &&
                  athleteTeamDef.program === coachTeamDef.program;
              });
            })
            .map(async (athlete: RosterEntry) => {
              try {
                const sessions = await fetchAthleteSessions(
                  athlete.uid,
                  12,
                  coachTeam || undefined
                );
                const recentSessions = sessions.filter(s => (s.createdAt || 0) >= oneWeekAgo);
                const prCount = sessions.filter(s => s.pr).length;
                const lastWorkout = sessions.length > 0 ? Math.max(...sessions.map(s => s.createdAt || 0)) : undefined;
                const lastCheckin = attendanceActivity[athlete.uid];
                const lastProfileUpdate =
                  athlete.updatedBy && athlete.updatedBy !== athlete.uid
                    ? undefined
                    : athlete.updatedAt;
                const lastActivity =
                  Math.max(lastWorkout ?? 0, lastCheckin ?? 0, lastProfileUpdate ?? 0) || undefined;

                return {
                  uid: athlete.uid,
                  name: [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.uid,
                  recentSessions,
                  lastWorkout,
                  lastCheckin,
                  lastProfileUpdate,
                  lastActivity,
                  weekCount: recentSessions.length,
                  prCount,
                };
              } catch (err) {
                console.debug('Could not load sessions for', athlete.uid);
                const lastCheckin = attendanceActivity[athlete.uid];
                const lastProfileUpdate =
                  athlete.updatedBy && athlete.updatedBy !== athlete.uid
                    ? undefined
                    : athlete.updatedAt;
                return {
                  uid: athlete.uid,
                  name: [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.uid,
                  recentSessions: [],
                  lastCheckin,
                  lastProfileUpdate,
                  lastActivity: Math.max(lastCheckin ?? 0, lastProfileUpdate ?? 0) || undefined,
                  weekCount: 0,
                  prCount: 0,
                };
              }
            })
        );

        setAthleteActivity(activities);
      } catch (err) {
        console.debug('Could not load team activity', err);
      } finally {
        setLoadingActivity(false);
      }
    })();
  }, [isCoach, teamSelection]);

  // Load attendance sheets for coach dashboard
  useEffect(() => {
    if (!isCoach) return;
    const coachTeam = teamSelection;
    const coachTeamDef = coachTeam ? TEAM_DEFINITIONS.find(def => def.id === coachTeam) : null;
    const relatedTeams = coachTeamDef
      ? TEAM_DEFINITIONS
        .filter(
          (definition) =>
            definition.sport === coachTeamDef.sport &&
            definition.program === coachTeamDef.program
        )
        .map((definition) => definition.id as Team)
      : coachTeam
        ? [coachTeam]
        : [];
    if (relatedTeams.length === 0) {
      setAttendanceSheets([]);
      return;
    }
    let active = true;
    setLoadingAttendance(true);
    Promise.all(relatedTeams.map((teamId) => loadAttendanceSheet(teamId)))
      .then((sheets) => {
        if (active) setAttendanceSheets(sheets);
      })
      .catch((err) => {
        console.debug("Could not load attendance sheets for dashboard", err);
      })
      .finally(() => {
        if (active) setLoadingAttendance(false);
      });
    return () => { active = false; };
  }, [isCoach, teamSelection]);

  // Real-time subscription to team sessions for live activity feed
  useEffect(() => {
    if (!isCoach) {
      setLiveSessionFeed([]);
      return;
    }
    const team = teamSelection as Team | undefined;
    if (!team) return;

    const unsubscribe = subscribeToTeamSessions(
      team,
      (sessions) => {
        setLiveSessionFeed(sessions);
      },
      { count: 50 }
    );

    return unsubscribe;
  }, [isCoach, teamSelection]);

  // Athlete-only video update highlight: glow for 7 days after the latest exercise library update.
  useEffect(() => {
    if (isCoach || !profile?.uid) {
      setShowVideoUpdateGlow(false);
      return;
    }

    const unsubscribe = subscribeExerciseLibraryStatus(({ updatedAtMs }) => {
      if (!updatedAtMs) {
        setShowVideoUpdateGlow(false);
        return;
      }
      const ageMs = Date.now() - updatedAtMs;
      setShowVideoUpdateGlow(ageMs >= 0 && ageMs <= VIDEO_UPDATE_GLOW_WINDOW_MS);
    });

    return unsubscribe;
  }, [isCoach, profile?.uid]);

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const totalWorkouts = athleteActivity.reduce((sum, a) => sum + a.weekCount, 0);
  const recentPRs = athleteActivity.flatMap(a =>
    a.recentSessions.filter(s => s.pr).map(s => ({ athlete: a.name, session: s }))
  ).slice(0, 5);

  // Compute attendance stats from sheets
  const attendanceStats = useMemo(() => {
    const now = new Date();
    const todayStr = formatLocalDateInput(now);
    // Monday of current week
    const day = now.getDay();
    const offsetToMonday = (day + 6) % 7;
    const monday = new Date(now);
    monday.setDate(monday.getDate() - offsetToMonday);
    const mondayStr = formatLocalDateInput(monday);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const sundayStr = formatLocalDateInput(sunday);

    let weekDates: string[] = [];
    let todayDates: string[] = [];
    let totalAthletes = 0;
    let weekAttended = 0;
    let weekPossible = 0;
    let todayPresent = 0;
    let todayTotal = 0;
    let todaySessions: string[] = [];
    const athleteWeekAttendance: Record<string, { attended: number; possible: number }> = {};
    const athleteOverallAttendance: Record<string, { attended: number; possible: number }> = {};
    const inactiveAthletes: { name: string; daysSince: number }[] = [];

    attendanceSheets.forEach((sheet) => {
      const sheetWeekDates = sheet.dates.filter(d => d >= mondayStr && d <= sundayStr);
      const sheetTodayDates = sheet.dates.filter(d => d === todayStr);
      weekDates = weekDates.concat(sheetWeekDates);
      todayDates = todayDates.concat(sheetTodayDates);
      totalAthletes += sheet.athletes.length;

      // Today's session labels
      sheetTodayDates.forEach(d => {
        const sessions = sheet.sessionsByDate?.[d] ?? [];
        sessions.forEach(s => {
          if (!todaySessions.includes(s.label)) todaySessions.push(s.label);
        });
      });

      sheet.athletes.forEach((athlete) => {
        const records = sheet.records[athlete.id] ?? {};

        // Week attendance
        let athleteWeekAtt = 0;
        let athleteWeekPoss = 0;
        sheetWeekDates.forEach(d => {
          athleteWeekPoss += 1;
          if (records[d] === true) {
            athleteWeekAtt += 1;
          }
        });
        weekAttended += athleteWeekAtt;
        weekPossible += athleteWeekPoss;

        const key = athlete.uid || athlete.id;
        if (!athleteWeekAttendance[key]) {
          athleteWeekAttendance[key] = { attended: 0, possible: 0 };
        }
        athleteWeekAttendance[key].attended += athleteWeekAtt;
        athleteWeekAttendance[key].possible += athleteWeekPoss;

        // Overall attendance (last 30 days for "needs attention")
        const thirtyDaysAgo = new Date(now);
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        const thirtyDaysAgoStr = formatLocalDateInput(thirtyDaysAgo);
        let overallAtt = 0;
        let overallPoss = 0;
        sheet.dates.forEach(d => {
          if (d >= thirtyDaysAgoStr) {
            overallPoss += 1;
            if (records[d] === true) overallAtt += 1;
          }
        });
        if (!athleteOverallAttendance[key]) {
          athleteOverallAttendance[key] = { attended: 0, possible: 0 };
        }
        athleteOverallAttendance[key].attended += overallAtt;
        athleteOverallAttendance[key].possible += overallPoss;

        // Today's present count
        sheetTodayDates.forEach(d => {
          todayTotal += 1;
          if (records[d] === true) todayPresent += 1;
        });

        // Athletes with no attendance in 14+ days
        const attendedDates = sheet.dates.filter(d => records[d] === true).sort();
        const lastAttended = attendedDates.length > 0 ? attendedDates[attendedDates.length - 1] : null;
        if (lastAttended) {
          const lastDate = new Date(`${lastAttended}T12:00:00`);
          const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
          if (daysSince >= 14) {
            const name = `${athlete.firstName} ${athlete.lastName}`.trim();
            if (!inactiveAthletes.some(a => a.name === name)) {
              inactiveAthletes.push({ name, daysSince });
            }
          }
        } else if (sheet.dates.length > 0) {
          // Never attended
          const name = `${athlete.firstName} ${athlete.lastName}`.trim();
          if (!inactiveAthletes.some(a => a.name === name)) {
            inactiveAthletes.push({ name, daysSince: 999 });
          }
        }
      });
    });

    const weekAttPct = weekPossible > 0 ? Number(((weekAttended / weekPossible) * 100).toFixed(1)) : 0;
    const weekSessionCount = weekDates.length;
    const athletesPresentThisWeek = Object.values(athleteWeekAttendance).filter(a => a.attended > 0).length;

    // Low attendance athletes (below 70% in last 30 days with at least 3 possible sessions)
    const lowAttendanceAthletes: { name: string; pct: number }[] = [];
    attendanceSheets.forEach((sheet) => {
      sheet.athletes.forEach((athlete) => {
        const key = athlete.uid || athlete.id;
        const overall = athleteOverallAttendance[key];
        if (overall && overall.possible >= 3) {
          const pct = Number(((overall.attended / overall.possible) * 100).toFixed(1));
          if (pct < 70) {
            const name = `${athlete.firstName} ${athlete.lastName}`.trim();
            if (!lowAttendanceAthletes.some(a => a.name === name)) {
              lowAttendanceAthletes.push({ name, pct });
            }
          }
        }
      });
    });
    lowAttendanceAthletes.sort((a, b) => a.pct - b.pct);
    inactiveAthletes.sort((a, b) => b.daysSince - a.daysSince);

    return {
      weekAttPct,
      weekSessionCount,
      athletesPresentThisWeek,
      totalAthletes,
      todayPresent,
      todayTotal,
      todaySessions,
      todayScheduled: todayDates.length > 0,
      lowAttendanceAthletes: lowAttendanceAthletes.slice(0, 5),
      inactiveAthletes: inactiveAthletes.slice(0, 5),
      athleteWeekAttendance,
    };
  }, [attendanceSheets]);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem("pl-onboarding-skipped", "true");
  };

  const checkinTeamLabel = checkinState ? formatTeamLabel(checkinState.team) : "";
  const checkinDateLabel = checkinState
    ? new Date(`${checkinState.date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    })
    : "";
  const checkinStatus = checkinState?.checkin?.status ?? null;
  const checkinSessionLabel =
    checkinState?.checkin?.sessionLabel ?? checkinState?.nextSession?.label ?? "";
  const showCheckinPanel =
    !isCoach &&
    !!profile &&
    (loadingCheckinState ||
      !!checkinError ||
      !!checkinNotice ||
      Boolean(checkinState?.checkin) ||
      Boolean(checkinState?.scheduled));

  const handleAthleteCheckIn = async () => {
    if (!profile || !checkinState) return;
    if (!checkinState.scheduled) {
      setCheckinError("No Lift-Day Attendance Is Open Right Now.");
      return;
    }
    if (checkinState.locked) {
      setCheckinError("No Sessions Available Right Now.");
      return;
    }
    if (checkinState.checkin) {
      setCheckinNotice("You're Already Checked In For Today.");
      return;
    }

    setSubmittingCheckin(true);
    setCheckinError(null);
    setCheckinNotice(null);

    try {
      const created = await submitAthleteAttendanceCheckin({
        team: checkinState.team,
        date: checkinState.date,
        uid: profile.uid,
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
      setCheckinState((prev) =>
        prev
          ? {
            ...prev,
            checkin: created,
          }
          : prev
      );
      const isJuniorHighSelfApprove = checkinState.team === "football-junior-high";
      setCheckinNotice(
        isJuniorHighSelfApprove
          ? created.sessionLabel
            ? `Checked In For ${created.sessionLabel}.`
            : "Checked In."
          : created.status === "approved"
            ? created.sessionLabel
              ? `Checked In For ${created.sessionLabel}.`
              : "Checked In."
            : created.sessionLabel
              ? `Check-In Submitted For ${created.sessionLabel}. Coach Verification Is Pending.`
              : "Check-In Submitted. Coach Verification Is Pending."
      );
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "attendance/checkin-closed") {
        setCheckinError("Check-In Is Closed For Today.");
      } else if (code === "attendance/date-locked") {
        setCheckinError("No Sessions Available Right Now.");
      } else if (
        err?.code === "permission-denied" ||
        /missing or insufficient permissions/i.test(code)
      ) {
        setCheckinError("Check-In Permission Failed. Sign Out, Sign Back In, Then Try Again.");
      } else {
        setCheckinError(err?.message ?? "Could Not Submit Attendance Check-In.");
      }
      try {
        const latest = await loadAthleteAttendanceCheckin(
          checkinState.team,
          checkinState.date,
          profile.uid
        );
        setCheckinState((prev) =>
          prev
            ? {
              ...prev,
              checkin: latest,
            }
            : prev
        );
      } catch (_) {
        // ignore follow-up refresh errors
      }
    } finally {
      setSubmittingCheckin(false);
    }
  };

  const handleSelfCheckIn = async () => {
    if (!profile?.uid) return;
    const resolvedTeam = normalizeTeam(profile.team || profile.teamAnchor || teamSelection || "");
    if (!resolvedTeam) return;
    setSelfCheckinStatus("loading");
    setSelfCheckinError(null);
    try {
      await selfCheckInToAttendanceSheet({
        team: resolvedTeam,
        uid: profile.uid,
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
      setSelfCheckinStatus("present");
    } catch (err: any) {
      setSelfCheckinStatus("error");
      setSelfCheckinError(err?.message ?? "Could not check in. Try again.");
    }
  };

  // Determine if this athlete is on a non-football team (self-checkin flow)
  const selfCheckinTeam = (() => {
    if (isCoach || !profile) return null;
    const resolved = normalizeTeam(profile.team || profile.teamAnchor || teamSelection || "");
    if (!resolved) return null;
    const def = TEAM_DEFINITIONS.find((d) => d.id === resolved);
    if (!def || def.sport === "football") return null;
    return resolved;
  })();

  const getLiftStatus = (lift: Lift) => {
    const hasLiftWeekMap = Boolean(
      profile?.liftWeeks && Object.keys(profile.liftWeeks).length > 0
    );
    const hasLiftCycleMap = Boolean(
      profile?.liftCycles && Object.keys(profile.liftCycles).length > 0
    );
    const week =
      profile?.liftWeeks?.[lift] ??
      (!hasLiftWeekMap ? profile?.currentWeek : undefined) ??
      1;
    const cycle =
      profile?.liftCycles?.[lift] ??
      (!hasLiftCycleMap ? profile?.currentCycle : undefined) ??
      1;
    return { week, cycle };
  };

  return (
    <div className={isCoach ? "pb-12" : "pb-12 min-h-screen bg-black"}>
      {showOnboarding && profile && (
        <OnboardingWizard onComplete={handleOnboardingComplete} unit={profile.unit} />
      )}

      <div className="container mt-8 space-y-8">
        {/* Team Dashboard for Coaches */}
        {isCoach && (
          <div className="coach-dashboard rounded-3xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-xl">
            <div className="flex flex-col gap-1 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-brand-800">Team Dashboard</h2>
                <p className="text-sm text-brand-600 mt-1">Weekly Snapshot</p>
              </div>
            </div>

            {(loadingActivity || loadingAttendance) ? (
              <div className="text-center py-8 text-gray-600">
                Loading Team Activity...
              </div>
            ) : (
              <>
                {isMobileLayout && (
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => navigate('/attendance')}
                    >
                      Attendance
                    </button>
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => navigate('/roster')}
                    >
                      Roster
                    </button>
                  </div>
                )}

                {/* Weekly Snapshot Cards */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                  <div className="card text-center bg-white/80 !p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Week Att %</div>
                    <div className={`text-3xl font-bold ${attendanceStats.weekAttPct >= 85 ? 'text-green-600' :
                      attendanceStats.weekAttPct >= 70 ? 'text-amber-600' :
                        attendanceStats.weekAttPct > 0 ? 'text-red-600' : 'text-gray-400'
                      }`}>
                      {attendanceStats.weekAttPct > 0 ? `${attendanceStats.weekAttPct}%` : '—'}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">This Week</div>
                  </div>
                  <div className="card text-center bg-white/80 !p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Sessions</div>
                    <div className="text-3xl font-bold text-blue-600">
                      {attendanceStats.weekSessionCount}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">This Week</div>
                  </div>
                  <div className="card text-center bg-white/80 !p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Present</div>
                    <div className="text-3xl font-bold text-green-600">
                      {attendanceStats.athletesPresentThisWeek}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">Of {attendanceStats.totalAthletes}</div>
                  </div>
                  <div className="card text-center bg-white/80 !p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Workouts</div>
                    <div className="text-3xl font-bold text-blue-600">
                      {totalWorkouts}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">Last 7 Days</div>
                  </div>
                  <div className="card text-center bg-white/80 !p-4 col-span-2 md:col-span-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-1">PRs</div>
                    <div className="text-3xl font-bold text-purple-600">
                      {recentPRs.length}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">This Week</div>
                  </div>
                </div>

                {/* Today's Attendance Quick Look */}
                <div className="card bg-white/80 mb-4 !py-3 !px-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-800">Today's Attendance</h3>
                      {attendanceStats.todayScheduled ? (
                        <p className="text-xs text-gray-600 mt-0.5">
                          {attendanceStats.todaySessions.length > 0
                            ? attendanceStats.todaySessions.join(' • ')
                            : 'Session scheduled'}
                          {' — '}
                          <span className="font-semibold text-green-600">{attendanceStats.todayPresent}</span>
                          {' of '}
                          <span className="font-semibold">{attendanceStats.todayTotal}</span>
                          {' checked in'}
                        </p>
                      ) : (
                        <p className="text-xs text-gray-500 mt-0.5">No sessions scheduled today.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn text-xs"
                      onClick={() => navigate('/attendance')}
                    >
                      Go To Attendance →
                    </button>
                  </div>
                </div>

                {/* Needs Attention Alert */}
                {(attendanceStats.lowAttendanceAthletes.length > 0 || attendanceStats.inactiveAthletes.length > 0) && (
                  <details className="card bg-white/80 mb-4 !py-3 !px-4 group">
                    <summary className="flex items-center justify-between gap-2 cursor-pointer list-none">
                      <div className="flex items-center gap-2">
                        <span className="text-amber-500 text-base">⚠</span>
                        <h3 className="text-sm font-semibold text-gray-800">Needs Attention</h3>
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          {attendanceStats.lowAttendanceAthletes.length + attendanceStats.inactiveAthletes.length}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </summary>
                    <div className="mt-3 space-y-2">
                      {attendanceStats.lowAttendanceAthletes.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Low Attendance (Last 30 Days)</div>
                          {attendanceStats.lowAttendanceAthletes.map((a) => (
                            <div key={`low-${a.name}`} className="flex items-center justify-between rounded-lg bg-red-50 border border-red-200 px-3 py-1.5 text-xs mb-1">
                              <span className="font-medium text-gray-800">{a.name}</span>
                              <span className="font-semibold text-red-600">{a.pct}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {attendanceStats.inactiveAthletes.length > 0 && (
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">Inactive (14+ Days Since Last Attendance)</div>
                          {attendanceStats.inactiveAthletes.map((a) => (
                            <div key={`inactive-${a.name}`} className="flex items-center justify-between rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 text-xs mb-1">
                              <span className="font-medium text-gray-800">{a.name}</span>
                              <span className="font-semibold text-amber-600">{a.daysSince >= 999 ? 'Never' : `${a.daysSince}d ago`}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* Live Activity Feed */}
                <div className="card bg-white/80 mb-4 !py-2 !px-3">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    {liveSessionFeed.length > 0 && (
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-gray-700">Live Activity</h3>
                    <span className="text-[10px] text-gray-400">{liveSessionFeed.length} recent session{liveSessionFeed.length !== 1 ? "s" : ""}</span>
                  </div>
                  {isMobileLayout ? (
                    <div className="space-y-1.5">
                      {liveSessionFeed.slice(0, 12).map((session, idx) => {
                        const athlete = athleteActivity.find(a => a.uid === session.athleteId);
                        const name = athlete
                          ? athlete.name
                          : session.athleteId.slice(0, 8);
                        const timeAgo = session.createdAt
                          ? formatTimeAgo(session.createdAt)
                          : "";
                        const amrapLabel = session.amrap
                          ? `${session.amrap.weight}x${session.amrap.reps}`
                          : "-";
                        const estLabel = session.est1rm ? `${Math.round(session.est1rm)}` : "-";
                        return (
                          <div
                            key={`${session.id}-${idx}`}
                            className="rounded-lg border border-gray-200 bg-white px-2.5 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-xs font-semibold text-gray-800">
                                {name}
                                {session.pr && (
                                  <span className="ml-1 text-[10px] text-yellow-500">PR</span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400">{timeAgo}</div>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 capitalize">{session.lift}</span>
                              <span>W{session.week}</span>
                              <span>AMRAP {amrapLabel}</span>
                              <span>Est {estLabel}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
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
                            const athlete = athleteActivity.find(a => a.uid === session.athleteId);
                            const name = athlete
                              ? athlete.name
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
                  )}
                </div>

                {/* Recent PRs - Compact Collapsible */}
                {recentPRs.length > 0 && (
                  <details className="card bg-white/80 !py-3 !px-4 group" open={typeof window !== 'undefined' && window.innerWidth >= 768}>
                    <summary className="flex items-center justify-between gap-2 cursor-pointer list-none">
                      <div className="flex items-center gap-2">
                        <span className="text-base">🏆</span>
                        <h3 className="text-sm font-semibold text-gray-800">Recent PRs</h3>
                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                          {recentPRs.length}
                        </span>
                      </div>
                      <svg className="w-4 h-4 text-gray-400 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </summary>
                    <div className="mt-3 space-y-1">
                      {recentPRs.map((pr, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col gap-1 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <span className="font-semibold text-gray-800">{pr.athlete}</span>
                            <span className="text-gray-500 ml-2">{pr.session.lift} • Wk{pr.session.week}</span>
                          </div>
                          <div className="font-semibold text-green-700">
                            {pr.session.amrap?.reps || 0}×{pr.session.amrap?.weight || 0} → {roundToPlate(pr.session.est1rm || 0, pr.session.unit, pr.session.unit === "lb" ? 5 : 2.5)} {pr.session.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        )}

        {/* Athlete View - Dark Athletic Theme */}
        {!isCoach && profile && (
          <div className="space-y-6">
            {showCheckinPanel && (
              <div className="rounded-2xl border border-red-700/60 bg-zinc-900/95 p-4 shadow-lg shadow-black/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black uppercase tracking-[0.18em] text-red-300">
                    Lift Day Check-In
                  </h2>
                  {checkinState && (
                    <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                      {checkinTeamLabel}
                    </span>
                  )}
                </div>

                {checkinState && (
                  <p className="mt-1 text-xs uppercase tracking-wide text-zinc-400">
                    {checkinDateLabel}
                  </p>
                )}

                {loadingCheckinState ? (
                  <p className="mt-3 text-sm text-zinc-300">Checking Today's Attendance Window...</p>
                ) : checkinError ? (
                  <p className="mt-3 text-sm font-semibold text-rose-300">{checkinError}</p>
                ) : checkinState?.checkin ? (
                  <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2">
                    <p className="text-sm font-semibold text-zinc-100">
                      {checkinState?.team === "football-junior-high" && checkinStatus !== "rejected"
                        ? "You're Checked In."
                        : checkinStatus === "approved"
                          ? "Coach Marked You Present."
                          : checkinStatus === "rejected"
                            ? "Coach Marked This Check-In As Not Present."
                            : "You're Checked In. Coach Verification Is Pending."}
                    </p>
                    {checkinSessionLabel && (
                      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-red-300">
                        Session: {checkinSessionLabel}
                      </p>
                    )}
                    {checkinNotice && (
                      <p className="mt-1 text-xs text-zinc-300">{checkinNotice}</p>
                    )}
                  </div>
                ) : checkinState?.scheduled && !checkinState.locked ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-zinc-200">
                      Tap Once When You're In The Weight Room.
                      {checkinState.nextSession?.label
                        ? ` You're Checking Into ${checkinState.nextSession.label}.`
                        : ""}
                    </p>
                    <button
                      type="button"
                      className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-65"
                      onClick={handleAthleteCheckIn}
                      disabled={submittingCheckin}
                    >
                      {submittingCheckin ? "Submitting..." : "Check In Now"}
                    </button>
                  </div>
                ) : checkinState?.scheduled && checkinState.locked ? (
                  <p className="mt-3 text-sm font-semibold text-amber-300">
                    No Sessions Available Right Now.
                  </p>
                ) : null}
              </div>
            )}

            {/* Self Check-In Panel — non-football teams */}
            {selfCheckinTeam && (
              <div className="rounded-2xl border border-emerald-700/60 bg-zinc-900/95 p-4 shadow-lg shadow-black/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-black uppercase tracking-[0.18em] text-emerald-300">
                    Lift Day Check-In
                  </h2>
                  <span className="rounded-full bg-zinc-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
                    {formatTeamLabel(selfCheckinTeam)}
                  </span>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wide text-zinc-400">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </p>

                {selfCheckinStatus === "loading" ? (
                  <p className="mt-3 text-sm text-zinc-300">Loading...</p>
                ) : selfCheckinStatus === "present" ? (
                  <div className="mt-3 rounded-xl border border-zinc-700 bg-zinc-800/80 px-3 py-2">
                    <p className="text-sm font-semibold text-emerald-300">You're Checked In For Today.</p>
                    <p className="mt-0.5 text-xs text-zinc-400">Attendance recorded. Keep lifting.</p>
                  </div>
                ) : selfCheckinStatus === "error" ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm font-semibold text-rose-300">{selfCheckinError ?? "Check-in failed. Try again."}</p>
                    <button
                      type="button"
                      className="w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-emerald-600 disabled:opacity-65"
                      onClick={handleSelfCheckIn}
                    >
                      Retry Check In
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-zinc-200">Tap when you're in the weight room to mark yourself present.</p>
                    <button
                      type="button"
                      className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold uppercase tracking-wide text-white transition hover:bg-emerald-500 active:bg-emerald-700"
                      onClick={handleSelfCheckIn}
                    >
                      Check In Now
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Hero - Shorter */}
            <div className="text-center py-1">
              <h1 className="text-2xl font-black uppercase tracking-wider text-white">
                {profile.firstName || 'Athlete'}
              </h1>
              <p className="text-gray-500 mt-1 uppercase tracking-wide text-sm">Select Your Lift</p>
            </div>

            {/* Lift Cards - BIG BUTTONS for mobile */}
            <div className="grid gap-2">
              {/* TURF Button - Before lifts */}
              <button
                className="w-full flex items-center justify-between px-5 py-4 border-2 border-green-600 bg-green-950 text-white font-bold transition-all hover:border-green-400 hover:bg-green-900 active:bg-green-800"
                onClick={() => navigate('/turf')}
              >
                <div className="text-left">
                  <div className="text-lg font-black uppercase tracking-wider">Turf</div>
                  <div className="text-xs text-green-400 uppercase tracking-wide">Warmup & Plyos</div>
                </div>
                <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {(['squat', 'bench', 'deadlift'] as Lift[]).map(lift => {
                const { week, cycle } = getLiftStatus(lift);
                const liftName = lift === 'bench' ? 'BENCH' : lift === 'squat' ? 'SQUAT' : 'DEADLIFT';
                const hasTm = (profile?.tm?.[lift] ?? 0) > 0;
                const tmValue = profile?.tm?.[lift] ?? 0;

                // Color schemes per lift
                const colorClass = lift === 'squat'
                  ? 'border-red-600 bg-red-950 hover:border-red-400 hover:bg-red-900 text-red-400'
                  : lift === 'bench'
                    ? 'border-blue-600 bg-blue-950 hover:border-blue-400 hover:bg-blue-900 text-blue-400'
                    : 'border-purple-600 bg-purple-950 hover:border-purple-400 hover:bg-purple-900 text-purple-400';

                const accentColor = lift === 'squat' ? 'text-red-400' : lift === 'bench' ? 'text-blue-400' : 'text-purple-400';

                return (
                  <button
                    key={lift}
                    className={`w-full flex items-center justify-between px-5 py-4 border-2 text-white font-bold transition-all active:brightness-75 ${colorClass}`}
                    onClick={() => {
                      if (hasTm) {
                        navigate('/session', { state: { lift } });
                      } else {
                        navigate('/calculator', { state: { lift } });
                      }
                    }}
                  >
                    <div className="text-left">
                      <div className="text-lg font-black uppercase tracking-wider">{liftName}</div>
                      {hasTm ? (
                        <div className={`text-xs uppercase tracking-wide ${accentColor}`}>
                          Week {week} • TM: <span className="font-bold">{tmValue}</span> {profile.unit}
                        </div>
                      ) : (
                        <div className="text-xs text-yellow-500 uppercase tracking-wide">Set Up TM</div>
                      )}
                    </div>
                    <svg className={`w-6 h-6 ${accentColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                )
              })}

              {/* ACCESSORY Button - After lifts */}
              <button
                className="w-full flex items-center justify-between px-5 py-4 border-2 border-amber-600 bg-amber-950 text-white font-bold transition-all hover:border-amber-400 hover:bg-amber-900 active:brightness-75"
                onClick={() => navigate('/accessory')}
              >
                <div className="text-left">
                  <div className="text-lg font-black uppercase tracking-wider">Accessory</div>
                  <div className="text-xs text-amber-400 uppercase tracking-wide">Today's Extra Work</div>
                </div>
                <svg className="w-6 h-6 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Quick Links - only show if TMs are set */}
            {(profile?.tm?.squat || profile?.tm?.bench || profile?.tm?.deadlift) && (
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <button
                  onClick={() => navigate('/progress')}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white transition"
                >
                  Progress
                </button>
                <button
                  onClick={() => navigate('/calculator')}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white transition"
                >
                  Calculator
                </button>
                <button
                  onClick={() => navigate('/program-outline')}
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white transition"
                >
                  Daily Lifts
                </button>
                <button
                  onClick={() => navigate('/exercises')}
                  className={[
                    "relative px-4 py-2 text-xs font-bold uppercase tracking-wide border transition",
                    showVideoUpdateGlow
                      ? "text-emerald-200 border-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.55)] animate-pulse hover:text-white hover:border-emerald-300"
                      : "text-gray-400 border-gray-700 hover:border-gray-500 hover:text-white",
                  ].join(" ")}
                >
                  Videos
                  {showVideoUpdateGlow && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-emerald-400 px-1.5 py-0.5 text-[9px] font-black text-zinc-900">
                      NEW
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Cheat Sheet - Hidden by default, moved to bottom */}
            <details className="group mt-8">
              <summary className="flex items-center justify-center gap-2 cursor-pointer list-none text-sm text-gray-500 hover:text-gray-300 py-2 uppercase tracking-wide">
                <span>What do TM, AMRAP, 1RM mean?</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </summary>
              <div className="mt-3 grid gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                {ABBREVIATIONS.slice(0, 4).map((item) => (
                  <div
                    key={item.code}
                    className="flex items-start gap-3 border border-gray-800 bg-gray-900 px-4 py-3"
                  >
                    <span className="text-base font-black text-red-500 min-w-[50px] uppercase">
                      {item.code}
                    </span>
                    <span className="text-sm text-gray-400">{item.detail}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
