import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import {
  fetchAthleteSessions,
  fetchLastAttendanceCheckinDates,
  listRoster,
  loadProfileRemote,
  ensureAnon,
  getStoredTeamSelection,
  TEAM_DEFINITIONS,
  loadAttendanceTeamStatus,
  loadAthleteAttendanceCheckin,
  submitAthleteAttendanceCheckin,
  normalizeTeam,
  formatTeamLabel,
  type AttendanceCheckin,
  type SessionRecord,
  type RosterEntry,
  type Profile,
  type Team,
  type Lift,
} from "../lib/db";
import { roundToPlate } from "../lib/tm";
import OnboardingWizard from "../components/OnboardingWizard";

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

export default function Home() {
  const navigate = useNavigate();
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
      teamSelection || profile.team || profile.teamAnchor || ""
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

  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const activeAthletes = athleteActivity.filter(a => (a.lastActivity || 0) >= oneWeekAgo).length;
  const totalWorkouts = athleteActivity.reduce((sum, a) => sum + a.weekCount, 0);
  const recentPRs = athleteActivity.flatMap(a => 
    a.recentSessions.filter(s => s.pr).map(s => ({ athlete: a.name, session: s }))
  ).slice(0, 5);
  
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
      setCheckinError("All Sessions Are Locked For Today.");
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
      setCheckinNotice(
        created.sessionLabel
          ? `Check-In Submitted For ${created.sessionLabel}. Coach Verification Is Pending.`
          : "Check-In Submitted. Coach Verification Is Pending."
      );
    } catch (err: any) {
      const code = err?.message ?? "";
      if (code === "attendance/checkin-closed") {
        setCheckinError("Check-In Is Closed For Today.");
      } else if (code === "attendance/date-locked") {
        setCheckinError("All Sessions Are Locked For This Date.");
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

  const getLiftStatus = (lift: Lift) => {
    const week = profile?.liftWeeks?.[lift] ?? profile?.currentWeek ?? 1;
    const cycle = profile?.liftCycles?.[lift] ?? profile?.currentCycle ?? 1;
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
                <p className="text-sm text-brand-600 mt-1">Weekly Activity And Performance</p>
              </div>
            </div>

            {loadingActivity ? (
              <div className="text-center py-8 text-gray-600">
                Loading Team Activity...
              </div>
            ) : (
              <>
                {/* Stats Cards */}
                <div className="grid md:grid-cols-3 gap-4 mb-6">
                  <div className="card text-center bg-white/80">
                    <div className="text-sm text-gray-600 mb-1">Active This Week</div>
                    <div className="text-4xl font-bold text-green-600">
                      {activeAthletes}
                    </div>
                    <div className="text-xs text-gray-500">
                      Of {athleteActivity.length} Athletes
                    </div>
                  </div>
                  <div className="card text-center bg-white/80">
                    <div className="text-sm text-gray-600 mb-1">Total Workouts</div>
                    <div className="text-4xl font-bold text-blue-600">
                      {totalWorkouts}
                    </div>
                    <div className="text-xs text-gray-500">Last 7 Days</div>
                  </div>
                  <div className="card text-center bg-white/80">
                    <div className="text-sm text-gray-800 mb-1">Recent PRs</div>
                    <div className="text-4xl font-bold text-purple-600">
                      {recentPRs.length}
                    </div>
                    <div className="text-xs text-gray-500">This Week</div>
                  </div>
                </div>

                {/* Recent PRs */}
                {recentPRs.length > 0 && (
                  <div className="card bg-white/80 mb-4">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">ðŸ† Recent PRs</h3>
                    <div className="space-y-2">
                      {recentPRs.map((pr, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between border rounded-xl px-4 py-2 bg-green-50 border-green-200"
                        >
                          <div>
                            <div className="font-semibold text-gray-900">{pr.athlete}</div>
                            <div className="text-sm text-gray-800">
                              {pr.session.lift} • Week {pr.session.week} • {pr.session.amrap?.reps || 0} reps @ {pr.session.amrap?.weight || 0} {pr.session.unit}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-green-700">
                            Est 1RM: {roundToPlate(pr.session.est1rm || 0, pr.session.unit, pr.session.unit === "lb" ? 5 : 2.5)} {pr.session.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Athlete Activity */}
                <div className="card bg-white/80">
                  <h3 className="text-lg font-bold text-gray-900 mb-3">
                    Athlete Activity
                    <span className="ml-2 text-xs font-normal text-gray-500">
                      (🟢 = Active In Last 2 Hours)
                    </span>
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="pb-2">Athlete</th>
                          <th className="pb-2">Workouts</th>
                          <th className="pb-2">Last Activity</th>
                          <th className="pb-2">Total PRs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {athleteActivity
                          .sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0))
                          .slice(0, 10)
                          .map((athlete) => {
                            const isActive = athlete.lastActivity && (Date.now() - athlete.lastActivity) < 2 * 60 * 60 * 1000;
                            return (
                            <tr key={athlete.uid} className="border-b last:border-0">
                              <td className="py-2 font-medium">
                                <span className="flex items-center gap-2">
                                  {isActive && (
                                    <span className="relative flex h-3 w-3">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                                      <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                                    </span>
                                  )}
                                  {athlete.name}
                                </span>
                              </td>
                              <td className="py-2">
                                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                                  athlete.weekCount > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                                }`}>
                                  {athlete.weekCount} This Week
                                </span>
                              </td>
                              <td className="py-2 text-gray-600">
                                {athlete.lastActivity 
                                  ? new Date(athlete.lastActivity).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : '—'
                                }
                              </td>
                              <td className="py-2">
                                {athlete.prCount > 0 ? (
                                  <span className="text-purple-600 font-semibold">{athlete.prCount} PRs</span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                            </tr>
                          );})}
                      </tbody>
                    </table>
                    {athleteActivity.length === 0 && (
                      <div className="text-center py-8 text-gray-600">
                        No Athletes Found. Add Athletes From The Roster To See Activity.
                      </div>
                    )}
                  </div>
                </div>
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
                      {checkinStatus === "approved"
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
                    All Sessions Are Locked For Today. Check-In Is Closed.
                  </p>
                ) : null}
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
                  className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-400 border border-gray-700 hover:border-gray-500 hover:text-white transition"
                >
                  Videos
                </button>
              </div>
            )}

            {/* Cheat Sheet - Hidden by default, moved to bottom */}
            <details className="group mt-8">
              <summary className="flex items-center justify-center gap-2 cursor-pointer list-none text-sm text-gray-500 hover:text-gray-300 py-2 uppercase tracking-wide">
                <span>What do TM, AMRAP, 1RM mean?</span>
                <svg className="w-4 h-4 transition-transform group-open:rotate-180" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
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
