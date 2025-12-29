import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { fetchAthleteSessions, listRoster, loadProfileRemote, ensureAnon, saveProfile, getStoredTeamSelection, TEAM_DEFINITIONS, type SessionRecord, type RosterEntry, type Profile, type Team, type Lift } from "../lib/db";
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
  weekCount: number;
  prCount: number;
};

export default function Home() {
  const navigate = useNavigate();
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

  const getLiftStatus = (lift: Lift) => {
    const week = profile?.liftWeeks?.[lift] ?? profile?.currentWeek ?? 1;
    const cycle = profile?.liftCycles?.[lift] ?? profile?.currentCycle ?? 1;
    return { week, cycle };
  };

  return (
    <div className="pb-12">
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
                      (🟢 = Active In Last 2 Hours)
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
                                  {athlete.weekCount} This Week
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
                        No Athletes Found. Add Athletes From The Roster To See Activity.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Athlete View */}
        {!isCoach && profile && (
          <div className="space-y-8">
            {/* Hero */}
            <div className="text-center py-2">
              <h1 className="text-3xl font-bold text-gray-900">
                Let's Get To Work, {profile.firstName || 'Athlete'}.
              </h1>
              <p className="text-gray-500 mt-2 text-lg">Select A Lift To Start Your Session.</p>
            </div>

            {/* Lift Cards */}
            <div className="grid gap-4 md:grid-cols-3">
              {(['squat', 'bench', 'deadlift'] as Lift[]).map(lift => {
                const { week, cycle } = getLiftStatus(lift);
                const liftName = lift === 'bench' ? 'Bench Press' : lift === 'squat' ? 'Back Squat' : 'Deadlift';
                const liftColor = lift === 'bench' ? 'blue' : lift === 'squat' ? 'brand' : 'purple';
                const hasTm = (profile?.tm?.[lift] ?? 0) > 0;
                
                // Dynamic classes based on lift type for visual variety
                const borderClass = lift === 'bench' ? 'hover:border-blue-300' : lift === 'squat' ? 'hover:border-brand-300' : 'hover:border-purple-300';
                const bgBadge = lift === 'bench' ? 'bg-blue-50 text-blue-700' : lift === 'squat' ? 'bg-brand-50 text-brand-700' : 'bg-purple-50 text-purple-700';
                const btnClass = lift === 'bench' ? 'bg-blue-600 hover:bg-blue-700' : lift === 'squat' ? 'bg-brand-600 hover:bg-brand-700' : 'bg-purple-600 hover:bg-purple-700';

                return (
                  <div 
                    key={lift} 
                    className={`card relative overflow-hidden border-2 border-transparent transition-all duration-200 group cursor-pointer shadow-md hover:shadow-xl ${borderClass}`}
                    onClick={() => {
                      if (hasTm) {
                        navigate('/session', { state: { lift } });
                      } else {
                        navigate('/calculator', { state: { lift } });
                      }
                    }}
                  >
                    <div className="absolute -top-6 -right-6 opacity-5 group-hover:opacity-10 transition-opacity rotate-12">
                      <span className="text-9xl font-black uppercase tracking-tighter">{lift[0]}</span>
                    </div>
                    
                    <div className="relative z-10 p-2">
                      <div className="flex justify-between items-start mb-4">
                        <h3 className="text-2xl font-bold capitalize text-gray-900">{liftName}</h3>
                      </div>
                      
                      <div className="flex items-center gap-3 text-sm mb-6">
                        <span className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-semibold">Cycle {cycle}</span>
                        <span className={`${bgBadge} px-3 py-1 rounded-full font-semibold`}>Week {week}</span>
                      </div>
                      
                      <button className={`w-full py-3 rounded-xl text-white font-bold shadow-sm transition-transform active:scale-95 ${btnClass}`}>
                        {hasTm ? "Start Session" : "Set Max"}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Cheat Sheet (Collapsible) */}
            <div className="card bg-gray-50/50 border-gray-200">
              <details className="group">
                <summary className="flex items-center justify-between cursor-pointer list-none p-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-white p-2 rounded-lg shadow-sm border border-gray-100 text-xl">❓</div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-800">Decoding The Lingo</h3>
                      <p className="text-xs text-gray-500">What Do TM, RPE, And 1RM Mean?</p>
                    </div>
                  </div>
                  <span className="transition-transform duration-200 group-open:rotate-180 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </span>
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2 pt-4 border-t border-gray-200 animate-in fade-in slide-in-from-top-2 duration-200">
                  {ABBREVIATIONS.map((item) => (
                    <div
                      key={item.code}
                      className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-lg font-bold text-brand-700">
                          {item.code}
                        </span>
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {item.title}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-gray-600 leading-relaxed">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
