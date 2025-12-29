import React, { useEffect, useState } from "react";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { fetchAthleteSessions, listRoster, loadProfileRemote, ensureAnon, saveProfile, getStoredTeamSelection, TEAM_DEFINITIONS, type SessionRecord, type RosterEntry, type Profile, type Team } from "../lib/db";
import { roundToPlate } from "../lib/tm";
import OnboardingWizard from "../components/OnboardingWizard";

const ABBREVIATIONS = [
  {
    code: "TM",
    title: "Training Max",
    detail:
      "Weight you could lift for around 2-3 hard reps. Every plan and sheet uses this number.",
  },
  {
    code: "1RM",
    title: "One-Rep Max",
    detail: "The heaviest weight you can lift once with solid form.",
  },
  {
    code: "AMRAP",
    title: "As Many Reps As Possible",
    detail: "Push the set, but stop while you still have 1-2 good reps left.",
  },
  {
    code: "PR",
    title: "Personal Record",
    detail: "Your best lift so far. New PRs mean progress - celebrate them.",
  },
  {
    code: "RPE",
    title: "Rate of Perceived Exertion",
    detail: "How tough a set feels from 1-10. RPE 8 means about two reps left.",
  },
  {
    code: "% Bar",
    title: "Percent of TM",
    detail:
      "Sheets show weights as a percent of your TM so you know what plates to load.",
  },
];

type AthleteActivity = {
  uid: string;
  name: string;
  recentSessions: SessionRecord[];
  lastWorkout?: number;
  weekCount: number;
  prCount: number;
};

export default function Home() {
  const { isCoach, loading: coachLoading } = useActiveAthlete();
  const [athleteActivity, setAthleteActivity] = useState<AthleteActivity[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

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
                
                return {
                  uid: athlete.uid,
                  name: [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.uid,
                  recentSessions,
                  lastWorkout,
                  weekCount: recentSessions.length,
                  prCount,
                };
              } catch (err) {
                console.debug('Could not load sessions for', athlete.uid);
                return {
                  uid: athlete.uid,
                  name: [athlete.firstName, athlete.lastName].filter(Boolean).join(' ') || athlete.uid,
                  recentSessions: [],
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

  const activeAthletes = athleteActivity.filter(a => a.weekCount > 0).length;
  const totalWorkouts = athleteActivity.reduce((sum, a) => sum + a.weekCount, 0);
  const recentPRs = athleteActivity.flatMap(a => 
    a.recentSessions.filter(s => s.pr).map(s => ({ athlete: a.name, session: s }))
  ).slice(0, 5);
  
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem("pl-onboarding-skipped", "true");
  };

  return (
    <div className="pb-12">
      {showOnboarding && profile && (
        <OnboardingWizard onComplete={handleOnboardingComplete} unit={profile.unit} />
      )}
      
      <div className="container mt-8 space-y-10">
        {/* Team Dashboard for Coaches */}
        {isCoach && (
          <div className="coach-dashboard rounded-3xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-xl">
            <div className="flex flex-col gap-1 mb-6">
              <div>
                <h2 className="text-2xl font-bold text-brand-800">Team Dashboard</h2>
                <p className="text-sm text-brand-600 mt-1">Weekly activity and performance</p>
              </div>
            </div>

            {loadingActivity ? (
              <div className="text-center py-8 text-gray-600">
                Loading team activity...
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
                      of {athleteActivity.length} athletes
                    </div>
                  </div>
                  <div className="card text-center bg-white/80">
                    <div className="text-sm text-gray-600 mb-1">Total Workouts</div>
                    <div className="text-4xl font-bold text-blue-600">
                      {totalWorkouts}
                    </div>
                    <div className="text-xs text-gray-500">last 7 days</div>
                  </div>
                  <div className="card text-center bg-white/80">
                    <div className="text-sm text-gray-800 mb-1">Recent PRs</div>
                    <div className="text-4xl font-bold text-purple-600">
                      {recentPRs.length}
                    </div>
                    <div className="text-xs text-gray-500">this week</div>
                  </div>
                </div>

                {/* Recent PRs */}
                {recentPRs.length > 0 && (
                  <div className="card bg-white/80 mb-4">
                    <h3 className="text-lg font-bold text-gray-900 mb-3">🏆 Recent PRs</h3>
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
                      (🟢 = active in last 2 hours)
                    </span>
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b">
                        <tr className="text-left">
                          <th className="pb-2">Athlete</th>
                          <th className="pb-2">Workouts</th>
                          <th className="pb-2">Last Session</th>
                          <th className="pb-2">Total PRs</th>
                        </tr>
                      </thead>
                      <tbody>
                        {athleteActivity
                          .sort((a, b) => (b.lastWorkout || 0) - (a.lastWorkout || 0))
                          .slice(0, 10)
                          .map((athlete) => {
                            const isActive = athlete.lastWorkout && (Date.now() - athlete.lastWorkout) < 2 * 60 * 60 * 1000;
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
                                  {athlete.weekCount} this week
                                </span>
                              </td>
                              <td className="py-2 text-gray-600">
                                {athlete.lastWorkout 
                                  ? new Date(athlete.lastWorkout).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
                        No athletes found. Add athletes from the roster to see activity.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Welcome Card for Athletes (non-coaches) */}
        {!isCoach && profile && (
          <div className="card border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-blue-800">
                  Welcome{profile.firstName ? `, ${profile.firstName}` : ''}! 👋
                </h2>
                <p className="text-sm text-blue-600 mt-1">Set your current week and open the tutorial anytime.</p>
              </div>
              
              <div className="flex items-center gap-3">
                {/* Week Selector */}
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-blue-800">Week:</label>
                  <select
                    className="field !text-sm !py-1 bg-white border-blue-300"
                    value={profile.currentWeek ?? 1}
                    onChange={async (e) => {
                      const newWeek = Number(e.target.value) as 1 | 2 | 3;
                      const updated = { ...profile, currentWeek: newWeek };
                      setProfile(updated);
                      try {
                        await saveProfile(updated);
                      } catch (err) {
                        console.error("Failed to save week", err);
                      }
                    }}
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
                
                <button
                  onClick={() => setShowOnboarding(true)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition"
                >
                  📖 Tutorial
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="card bg-white/95 shadow-xl ring-1 ring-gray-100/80">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">
                Cheat Sheet: What the letters mean
              </h2>
              <p className="text-sm text-gray-600">
                Lifting language can be a lot. Use this to decode the shorthand you
                see everywhere in PL Strength.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
              Quick Reference
            </span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {ABBREVIATIONS.map((item) => (
              <div
                key={item.code}
                className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 shadow-inner transition hover:border-brand-200 hover:bg-brand-50/60"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xl font-semibold text-brand-700">
                    {item.code}
                  </span>
                  <span className="text-sm font-medium text-gray-700">
                    {item.title}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-600">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
