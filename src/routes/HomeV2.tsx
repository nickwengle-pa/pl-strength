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

export default function HomeV2() {
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

  const ChevronRight = ({ className = "w-5 h-5" }: { className?: string }) => (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );

  const ChevronDown = ({ className = "w-4 h-4" }: { className?: string }) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );

  const AccentBar = ({ className = "h-px w-5 bg-v2-accent-700" }: { className?: string }) => (
    <div className={className} aria-hidden="true" />
  );

  return (
    <div className={isCoach ? "pb-12 min-h-screen bg-v2-surface-950 text-v2-ink-50 font-v2-body" : "pb-12 min-h-screen bg-v2-surface-950 text-v2-ink-50 font-v2-body"}>
      {showOnboarding && profile && (
        <OnboardingWizard onComplete={handleOnboardingComplete} unit={profile.unit} />
      )}

      <div className="container mt-6 space-y-6">
        {/* Team Dashboard for Coaches */}
        {isCoach && (
          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 p-5 shadow-v2-elev-1">
            <div className="mb-5 flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <AccentBar className="h-px w-6 bg-v2-info-600" />
                <span className="text-v2-xs uppercase tracking-[0.22em] text-v2-info-300 font-v2-body font-semibold">Coach View</span>
              </div>
              <h2 className="font-v2-heading text-v2-2xl uppercase tracking-wide text-v2-ink-50">Team Dashboard</h2>
              <p className="text-v2-xs uppercase tracking-[0.18em] text-v2-ink-500">Weekly Snapshot</p>
            </div>

            {(loadingActivity || loadingAttendance) ? (
              <div className="py-8 text-center text-v2-sm text-v2-ink-300 font-v2-body">
                Loading Team Activity...
              </div>
            ) : (
              <>
                {isMobileLayout && (
                  <div className="mb-4 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-3 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200 transition-colors duration-v2-quick hover:border-v2-info-600 hover:text-v2-info-300"
                      onClick={() => navigate('/attendance')}
                    >
                      Attendance
                    </button>
                    <button
                      type="button"
                      className="min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-3 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-200 transition-colors duration-v2-quick hover:border-v2-info-600 hover:text-v2-info-300"
                      onClick={() => navigate('/roster')}
                    >
                      Roster
                    </button>
                  </div>
                )}

                {/* Weekly Snapshot Cards */}
                <div className="mb-5 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-center">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Week Att %</div>
                    <div className={`font-v2-mono tabular-nums text-v2-2xl font-bold ${attendanceStats.weekAttPct >= 85 ? 'text-v2-success-600' :
                      attendanceStats.weekAttPct >= 70 ? 'text-v2-warn-500' :
                        attendanceStats.weekAttPct > 0 ? 'text-v2-danger-600' : 'text-v2-ink-500'
                      }`}>
                      {attendanceStats.weekAttPct > 0 ? `${attendanceStats.weekAttPct}%` : '—'}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-v2-ink-500">This Week</div>
                  </div>
                  <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-center">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Sessions</div>
                    <div className="font-v2-mono tabular-nums text-v2-2xl font-bold text-v2-info-300">
                      {attendanceStats.weekSessionCount}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-v2-ink-500">This Week</div>
                  </div>
                  <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-center">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Present</div>
                    <div className="font-v2-mono tabular-nums text-v2-2xl font-bold text-v2-success-600">
                      {attendanceStats.athletesPresentThisWeek}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-v2-ink-500">Of {attendanceStats.totalAthletes}</div>
                  </div>
                  <div className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-center">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Workouts</div>
                    <div className="font-v2-mono tabular-nums text-v2-2xl font-bold text-v2-info-300">
                      {totalWorkouts}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-v2-ink-500">Last 7 Days</div>
                  </div>
                  <div className="col-span-2 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 p-3 text-center md:col-span-1">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">PRs</div>
                    <div className="font-v2-mono tabular-nums text-v2-2xl font-bold text-v2-warn-500">
                      {recentPRs.length}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-v2-ink-500">This Week</div>
                  </div>
                </div>

                {/* Today's Attendance Quick Look */}
                <div className="mb-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <AccentBar className="h-px w-4 bg-v2-info-600" />
                        <h3 className="font-v2-heading text-v2-sm uppercase tracking-[0.18em] text-v2-ink-100">Today's Attendance</h3>
                      </div>
                      {attendanceStats.todayScheduled ? (
                        <p className="mt-1 text-v2-xs text-v2-ink-300 font-v2-body">
                          {attendanceStats.todaySessions.length > 0
                            ? attendanceStats.todaySessions.join(' • ')
                            : 'Session scheduled'}
                          {' — '}
                          <span className="font-v2-mono tabular-nums font-semibold text-v2-success-600">{attendanceStats.todayPresent}</span>
                          {' of '}
                          <span className="font-v2-mono tabular-nums font-semibold text-v2-ink-100">{attendanceStats.todayTotal}</span>
                          {' checked in'}
                        </p>
                      ) : (
                        <p className="mt-1 text-v2-xs text-v2-ink-500">No sessions scheduled today.</p>
                      )}
                    </div>
                    <button
                      type="button"
                      className="min-h-touch rounded-v2-sm border border-v2-info-600 bg-transparent px-3 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-info-300 transition-colors duration-v2-quick hover:bg-v2-info-600 hover:text-v2-ink-50"
                      onClick={() => navigate('/attendance')}
                    >
                      Go To Attendance
                    </button>
                  </div>
                </div>

                {/* Needs Attention Alert */}
                {(attendanceStats.lowAttendanceAthletes.length > 0 || attendanceStats.inactiveAthletes.length > 0) && (
                  <details className="group mb-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 px-4 py-3">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AccentBar className="h-px w-4 bg-v2-warn-500" />
                        <h3 className="font-v2-heading text-v2-sm uppercase tracking-[0.18em] text-v2-ink-100">Needs Attention</h3>
                        <span className="rounded-v2-full bg-v2-warn-500/20 px-2 py-0.5 font-v2-mono tabular-nums text-[10px] font-semibold text-v2-warn-500">
                          {attendanceStats.lowAttendanceAthletes.length + attendanceStats.inactiveAthletes.length}
                        </span>
                      </div>
                      <ChevronDown className="h-4 w-4 text-v2-ink-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-2">
                      {attendanceStats.lowAttendanceAthletes.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Low Attendance (Last 30 Days)</div>
                          {attendanceStats.lowAttendanceAthletes.map((a) => (
                            <div key={`low-${a.name}`} className="mb-1 flex items-center justify-between rounded-v2-sm border border-v2-danger-600/40 bg-v2-danger-600/10 px-3 py-1.5 text-v2-xs">
                              <span className="font-medium text-v2-ink-100">{a.name}</span>
                              <span className="font-v2-mono tabular-nums font-semibold text-v2-danger-600">{a.pct}%</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {attendanceStats.inactiveAthletes.length > 0 && (
                        <div>
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-ink-500">Inactive (14+ Days Since Last Attendance)</div>
                          {attendanceStats.inactiveAthletes.map((a) => (
                            <div key={`inactive-${a.name}`} className="mb-1 flex items-center justify-between rounded-v2-sm border border-v2-warn-500/40 bg-v2-warn-500/10 px-3 py-1.5 text-v2-xs">
                              <span className="font-medium text-v2-ink-100">{a.name}</span>
                              <span className="font-v2-mono tabular-nums font-semibold text-v2-warn-500">{a.daysSince >= 999 ? 'Never' : `${a.daysSince}d ago`}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </details>
                )}

                {/* Live Activity Feed */}
                <div className="mb-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 px-3 py-2">
                  <div className="mb-2 flex items-center gap-2">
                    {liveSessionFeed.length > 0 && (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-v2-success-600 opacity-75"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-v2-success-600"></span>
                      </span>
                    )}
                    <AccentBar className="h-px w-4 bg-v2-info-600" />
                    <h3 className="font-v2-heading text-v2-sm uppercase tracking-[0.18em] text-v2-ink-100">Live Activity</h3>
                    <span className="font-v2-mono tabular-nums text-[10px] text-v2-ink-500">{liveSessionFeed.length} recent session{liveSessionFeed.length !== 1 ? "s" : ""}</span>
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
                            className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-2.5 py-2"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="truncate text-v2-xs font-semibold text-v2-ink-100">
                                {name}
                                {session.pr && (
                                  <span className="ml-1 font-v2-mono text-[10px] text-v2-warn-500">PR</span>
                                )}
                              </div>
                              <div className="font-v2-mono tabular-nums text-[11px] text-v2-ink-500">{timeAgo}</div>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-v2-ink-300 font-v2-body">
                              <span className="rounded-v2-sm bg-v2-surface-800 px-1.5 py-0.5 capitalize">{session.lift}</span>
                              <span className="font-v2-mono tabular-nums">W{session.week}</span>
                              <span className="font-v2-mono tabular-nums">AMRAP {amrapLabel}</span>
                              <span className="font-v2-mono tabular-nums">Est {estLabel}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="max-h-60 overflow-x-auto overflow-y-auto">
                      <table className="w-full text-v2-xs">
                        <thead className="sticky top-0 bg-v2-surface-900">
                          <tr className="text-[10px] uppercase tracking-[0.18em] text-v2-ink-500">
                            <th className="px-1.5 py-1 text-left font-medium">Athlete</th>
                            <th className="px-1.5 py-1 text-left font-medium">Lift</th>
                            <th className="px-1.5 py-1 text-center font-medium">Wk</th>
                            <th className="px-1.5 py-1 text-right font-medium">AMRAP</th>
                            <th className="px-1.5 py-1 text-right font-medium">Est 1RM</th>
                            <th className="px-1.5 py-1 text-right font-medium">When</th>
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
                              session.lift === "squat" ? "bg-v2-accent-700"
                                : session.lift === "bench" ? "bg-v2-info-600"
                                  : "bg-v2-warn-500";
                            return (
                              <tr
                                key={`${session.id}-${idx}`}
                                className="border-t border-v2-surface-800 transition-colors hover:bg-v2-surface-800/40"
                              >
                                <td className="whitespace-nowrap px-1.5 py-1 font-medium text-v2-ink-100">
                                  {name}
                                  {session.pr && <span className="ml-1 font-v2-mono text-[10px] text-v2-warn-500" title="PR">&#9733;</span>}
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1">
                                  <span className="inline-flex items-center gap-1">
                                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${liftColor}`}></span>
                                    <span className="capitalize text-v2-ink-300">{session.lift}</span>
                                  </span>
                                </td>
                                <td className="px-1.5 py-1 text-center font-v2-mono tabular-nums text-v2-ink-500">{session.week}</td>
                                <td className="whitespace-nowrap px-1.5 py-1 text-right font-v2-mono tabular-nums text-v2-ink-300">
                                  {session.amrap ? `${session.amrap.weight}×${session.amrap.reps}` : "-"}
                                </td>
                                <td className="px-1.5 py-1 text-right font-v2-mono tabular-nums font-medium text-v2-ink-100">
                                  {session.est1rm ? Math.round(session.est1rm) : "-"}
                                </td>
                                <td className="whitespace-nowrap px-1.5 py-1 text-right font-v2-mono tabular-nums text-v2-ink-500">{timeAgo}</td>
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
                  <details className="group rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950/60 px-4 py-3" open={typeof window !== 'undefined' && window.innerWidth >= 768}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AccentBar className="h-px w-4 bg-v2-warn-500" />
                        <h3 className="font-v2-heading text-v2-sm uppercase tracking-[0.18em] text-v2-ink-100">Recent PRs</h3>
                        <span className="rounded-v2-full bg-v2-warn-500/20 px-2 py-0.5 font-v2-mono tabular-nums text-[10px] font-semibold text-v2-warn-500">
                          {recentPRs.length}
                        </span>
                      </div>
                      <ChevronDown className="h-4 w-4 text-v2-ink-500 transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="mt-3 space-y-1">
                      {recentPRs.map((pr, idx) => (
                        <div
                          key={idx}
                          className="flex flex-col gap-1 rounded-v2-sm border border-v2-success-600/40 bg-v2-success-600/10 px-3 py-2 text-v2-xs sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div>
                            <span className="font-semibold text-v2-ink-100">{pr.athlete}</span>
                            <span className="ml-2 uppercase tracking-wider text-v2-ink-500">{pr.session.lift} • Wk{pr.session.week}</span>
                          </div>
                          <div className="font-v2-mono tabular-nums font-semibold text-v2-success-600">
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

        {/* Athlete View - V2 Athletic Minimalism */}
        {!isCoach && profile && (
          <div className="space-y-6">
            {showCheckinPanel && (
              <div className="rounded-v2-md border border-v2-accent-700/60 bg-v2-surface-900 p-5 shadow-v2-elev-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <AccentBar className="h-px w-6 bg-v2-accent-700" />
                    <h2 className="font-v2-heading text-v2-sm uppercase tracking-[0.22em] text-v2-accent-300">
                      Lift Day Check-In
                    </h2>
                  </div>
                  {checkinState && (
                    <span className="rounded-v2-full bg-v2-surface-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-v2-ink-300">
                      {checkinTeamLabel}
                    </span>
                  )}
                </div>

                {checkinState && (
                  <p className="mt-2 text-v2-xs uppercase tracking-[0.18em] text-v2-ink-500">
                    {checkinDateLabel}
                  </p>
                )}

                {loadingCheckinState ? (
                  <p className="mt-3 text-v2-sm text-v2-ink-300">Checking Today's Attendance Window...</p>
                ) : checkinError ? (
                  <p className="mt-3 text-v2-sm font-semibold text-v2-danger-600">{checkinError}</p>
                ) : checkinState?.checkin ? (
                  <div className="mt-3 rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-3 py-2">
                    <p className="text-v2-sm font-semibold text-v2-ink-50">
                      {checkinState?.team === "football-junior-high" && checkinStatus !== "rejected"
                        ? "You're Checked In."
                        : checkinStatus === "approved"
                          ? "Coach Marked You Present."
                          : checkinStatus === "rejected"
                            ? "Coach Marked This Check-In As Not Present."
                            : "You're Checked In. Coach Verification Is Pending."}
                    </p>
                    {checkinSessionLabel && (
                      <p className="mt-1 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-accent-300">
                        Session: {checkinSessionLabel}
                      </p>
                    )}
                    {checkinNotice && (
                      <p className="mt-1 text-v2-xs text-v2-ink-300">{checkinNotice}</p>
                    )}
                  </div>
                ) : checkinState?.scheduled && !checkinState.locked ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-v2-sm text-v2-ink-200">
                      Tap Once When You're In The Weight Room.
                      {checkinState.nextSession?.label
                        ? ` You're Checking Into ${checkinState.nextSession.label}.`
                        : ""}
                    </p>
                    <button
                      type="button"
                      className="w-full min-h-touch-lg rounded-v2-md bg-v2-accent-700 px-4 py-3 font-v2-heading text-v2-base font-bold uppercase tracking-[0.18em] text-v2-ink-50 transition-colors duration-v2-quick hover:bg-v2-accent-800 active:bg-v2-accent-900 disabled:cursor-not-allowed disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
                      onClick={handleAthleteCheckIn}
                      disabled={submittingCheckin}
                    >
                      {submittingCheckin ? "Submitting..." : "Check In Now"}
                    </button>
                  </div>
                ) : checkinState?.scheduled && checkinState.locked ? (
                  <p className="mt-3 text-v2-sm font-semibold text-v2-warn-500">
                    No Sessions Available Right Now.
                  </p>
                ) : null}
              </div>
            )}

            {/* Self Check-In Panel — non-football teams */}
            {selfCheckinTeam && (
              <div className="rounded-v2-md border border-v2-success-600/60 bg-v2-surface-900 p-5 shadow-v2-elev-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <AccentBar className="h-px w-6 bg-v2-success-600" />
                    <h2 className="font-v2-heading text-v2-sm uppercase tracking-[0.22em] text-v2-success-600">
                      Lift Day Check-In
                    </h2>
                  </div>
                  <span className="rounded-v2-full bg-v2-surface-800 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-v2-ink-300">
                    {formatTeamLabel(selfCheckinTeam)}
                  </span>
                </div>
                <p className="mt-2 text-v2-xs uppercase tracking-[0.18em] text-v2-ink-500">
                  {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                </p>

                {selfCheckinStatus === "loading" ? (
                  <p className="mt-3 text-v2-sm text-v2-ink-300">Loading...</p>
                ) : selfCheckinStatus === "present" ? (
                  <div className="mt-3 rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-3 py-2">
                    <p className="text-v2-sm font-semibold text-v2-success-600">You're Checked In For Today.</p>
                    <p className="mt-0.5 text-v2-xs text-v2-ink-500">Attendance recorded. Keep lifting.</p>
                  </div>
                ) : selfCheckinStatus === "error" ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-v2-sm font-semibold text-v2-danger-600">{selfCheckinError ?? "Check-in failed. Try again."}</p>
                    <button
                      type="button"
                      className="w-full min-h-touch-lg rounded-v2-md bg-v2-success-600 px-4 py-3 font-v2-heading text-v2-base font-bold uppercase tracking-[0.18em] text-v2-ink-50 transition-colors duration-v2-quick hover:bg-v2-success-600/90 disabled:opacity-65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-success-600 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
                      onClick={handleSelfCheckIn}
                    >
                      Retry Check In
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    <p className="text-v2-sm text-v2-ink-200">Tap when you're in the weight room to mark yourself present.</p>
                    <button
                      type="button"
                      className="w-full min-h-touch-lg rounded-v2-md bg-v2-success-600 px-4 py-3 font-v2-heading text-v2-base font-bold uppercase tracking-[0.18em] text-v2-ink-50 transition-colors duration-v2-quick hover:bg-v2-success-600/90 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-success-600 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
                      onClick={handleSelfCheckIn}
                    >
                      Check In Now
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Hero */}
            <div className="py-2 text-center">
              <div className="flex items-center justify-center gap-3">
                <AccentBar />
                <span className="text-v2-xs uppercase tracking-[0.22em] text-v2-accent-300 font-semibold">Athlete</span>
                <AccentBar />
              </div>
              <h1 className="mt-3 font-v2-heading text-v2-3xl font-bold uppercase tracking-wide text-v2-ink-50">
                {profile.firstName || 'Athlete'}
              </h1>
              <p className="mt-1 text-v2-xs uppercase tracking-[0.22em] text-v2-ink-500">Select Your Lift</p>
            </div>

            {/* Lift Cards - BIG BUTTONS for mobile */}
            <div className="grid gap-3">
              {/* TURF Button - Before lifts */}
              <button
                className="flex min-h-touch-lg w-full items-center justify-between rounded-v2-md border border-v2-success-600/60 bg-v2-surface-900 px-5 py-4 font-v2-body font-bold text-v2-ink-50 transition-all duration-v2-quick hover:border-v2-success-600 hover:bg-v2-surface-800 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-success-600 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
                onClick={() => navigate('/turf')}
              >
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <AccentBar className="h-px w-4 bg-v2-success-600" />
                    <div className="font-v2-heading text-v2-lg font-bold uppercase tracking-[0.18em]">Turf</div>
                  </div>
                  <div className="mt-1 text-v2-xs uppercase tracking-[0.18em] text-v2-success-600">Warmup & Plyos</div>
                </div>
                <ChevronRight className="h-6 w-6 text-v2-success-600" />
              </button>

              {(['squat', 'bench', 'deadlift'] as Lift[]).map(lift => {
                const { week, cycle } = getLiftStatus(lift);
                const liftName = lift === 'bench' ? 'BENCH' : lift === 'squat' ? 'SQUAT' : 'DEADLIFT';
                const hasTm = (profile?.tm?.[lift] ?? 0) > 0;
                const tmValue = profile?.tm?.[lift] ?? 0;

                // V2 color mapping per lift (matches SummaryV2 convention): squat→accent, bench→info, deadlift→warn
                const liftBorder = lift === 'squat'
                  ? 'border-v2-accent-700/60 hover:border-v2-accent-700 focus-visible:ring-v2-accent-500'
                  : lift === 'bench'
                    ? 'border-v2-info-600/60 hover:border-v2-info-600 focus-visible:ring-v2-info-600'
                    : 'border-v2-warn-500/60 hover:border-v2-warn-500 focus-visible:ring-v2-warn-500';
                const liftAccentText = lift === 'squat' ? 'text-v2-accent-300' : lift === 'bench' ? 'text-v2-info-300' : 'text-v2-warn-500';
                const liftAccentBar = lift === 'squat' ? 'bg-v2-accent-700' : lift === 'bench' ? 'bg-v2-info-600' : 'bg-v2-warn-500';

                return (
                  <button
                    key={lift}
                    className={`flex min-h-touch-lg w-full items-center justify-between rounded-v2-md border bg-v2-surface-900 px-5 py-4 font-v2-body font-bold text-v2-ink-50 transition-all duration-v2-quick hover:bg-v2-surface-800 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950 ${liftBorder}`}
                    onClick={() => {
                      if (hasTm) {
                        navigate('/session', { state: { lift } });
                      } else {
                        navigate('/calculator', { state: { lift } });
                      }
                    }}
                  >
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <div className={`h-px w-4 ${liftAccentBar}`} aria-hidden="true" />
                        <div className="font-v2-heading text-v2-lg font-bold uppercase tracking-[0.18em]">{liftName}</div>
                      </div>
                      {hasTm ? (
                        <div className={`mt-1 text-v2-xs uppercase tracking-[0.18em] ${liftAccentText}`}>
                          Week <span className="font-v2-mono tabular-nums">{week}</span> • TM: <span className="font-v2-mono tabular-nums font-bold text-v2-ink-50">{tmValue}</span> {profile.unit}
                        </div>
                      ) : (
                        <div className="mt-1 text-v2-xs uppercase tracking-[0.18em] text-v2-warn-500">Set Up TM</div>
                      )}
                    </div>
                    <ChevronRight className={`h-6 w-6 ${liftAccentText}`} />
                  </button>
                )
              })}

              {/* ACCESSORY Button - After lifts */}
              <button
                className="flex min-h-touch-lg w-full items-center justify-between rounded-v2-md border border-v2-warn-500/60 bg-v2-surface-900 px-5 py-4 font-v2-body font-bold text-v2-ink-50 transition-all duration-v2-quick hover:border-v2-warn-500 hover:bg-v2-surface-800 active:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-warn-500 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
                onClick={() => navigate('/accessory')}
              >
                <div className="text-left">
                  <div className="flex items-center gap-2">
                    <AccentBar className="h-px w-4 bg-v2-warn-500" />
                    <div className="font-v2-heading text-v2-lg font-bold uppercase tracking-[0.18em]">Accessory</div>
                  </div>
                  <div className="mt-1 text-v2-xs uppercase tracking-[0.18em] text-v2-warn-500">Today's Extra Work</div>
                </div>
                <ChevronRight className="h-6 w-6 text-v2-warn-500" />
              </button>
            </div>

            {/* Quick Links - only show if TMs are set */}
            {(profile?.tm?.squat || profile?.tm?.bench || profile?.tm?.deadlift) && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <button
                  onClick={() => navigate('/progress')}
                  className="min-h-touch rounded-v2-sm border border-v2-surface-700 bg-transparent px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-300 transition-colors duration-v2-quick hover:border-v2-accent-700 hover:text-v2-ink-50"
                >
                  Progress
                </button>
                <button
                  onClick={() => navigate('/calculator')}
                  className="min-h-touch rounded-v2-sm border border-v2-surface-700 bg-transparent px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-300 transition-colors duration-v2-quick hover:border-v2-accent-700 hover:text-v2-ink-50"
                >
                  Calculator
                </button>
                <button
                  onClick={() => navigate('/program-outline')}
                  className="min-h-touch rounded-v2-sm border border-v2-surface-700 bg-transparent px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] text-v2-ink-300 transition-colors duration-v2-quick hover:border-v2-accent-700 hover:text-v2-ink-50"
                >
                  Daily Lifts
                </button>
                <button
                  onClick={() => navigate('/exercises')}
                  className={[
                    "relative min-h-touch rounded-v2-sm border px-4 py-2 text-v2-xs font-semibold uppercase tracking-[0.18em] transition-colors duration-v2-quick",
                    showVideoUpdateGlow
                      ? "border-v2-success-600 text-v2-success-600 shadow-[0_0_12px_rgba(16,185,129,0.55)] animate-pulse hover:border-v2-success-600 hover:text-v2-ink-50"
                      : "border-v2-surface-700 text-v2-ink-300 hover:border-v2-accent-700 hover:text-v2-ink-50",
                  ].join(" ")}
                >
                  Videos
                  {showVideoUpdateGlow && (
                    <span className="absolute -right-1 -top-1 rounded-v2-full bg-v2-success-600 px-1.5 py-0.5 text-[9px] font-black text-v2-surface-950">
                      NEW
                    </span>
                  )}
                </button>
              </div>
            )}

            {/* Cheat Sheet - Hidden by default, moved to bottom */}
            <details className="group mt-8">
              <summary className="flex cursor-pointer list-none items-center justify-center gap-2 py-2 text-v2-sm uppercase tracking-[0.18em] text-v2-ink-500 transition-colors duration-v2-quick hover:text-v2-ink-200">
                <span>What do TM, AMRAP, 1RM mean?</span>
                <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
              </summary>
              <div className="mt-3 grid gap-2">
                {ABBREVIATIONS.slice(0, 4).map((item) => (
                  <div
                    key={item.code}
                    className="flex items-start gap-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-4 py-3"
                  >
                    <span className="min-w-[50px] font-v2-heading text-v2-base font-black uppercase text-v2-accent-300">
                      {item.code}
                    </span>
                    <span className="font-v2-body text-v2-sm text-v2-ink-300">{item.detail}</span>
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
