import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { fetchAthleteSessions, listRoster, loadProfileRemote, ensureAnon, type SessionRecord, type RosterEntry, type Profile } from "../lib/db";
import OnboardingWizard from "../components/OnboardingWizard";

const PAGE_LINKS = [
  { to: "/summary", label: "Quick Summary" },
  { to: "/progress", label: "Progress" },
  { to: "/calculator", label: "Calculator" },
  { to: "/sheets", label: "Sheets" },
  { to: "/program-outline", label: "Program" },
  { to: "/exercises", label: "Exercises" },
  { to: "/roster", label: "Roster" },
  { to: "/attendance", label: "Attendance" },
  { to: "/session", label: "Session" },
  { to: "/profile", label: "Profile" },
  { to: "/admin", label: "Admin", hideOnMobile: true },
];

const FEATURE_LINKS = [
  {
    to: "/summary",
    label: "Quick Summary",
    message: "Simple plan for today. Big buttons. No fluff.",
    badge: "QS",
    accent: "from-amber-400/90 to-orange-500/90",
  },
  {
    to: "/progress",
    label: "Progress Tracking",
    message: "Charts, PRs, and stats. See your gains over time.",
    badge: "PR",
    accent: "from-purple-400/90 to-purple-600/90",
  },
  {
    to: "/calculator",
    label: "Calculator / Table",
    message: "Auto-calc warm-ups and work sets with rounding.",
    badge: "CT",
    accent: "from-sky-400/90 to-sky-600/90",
  },
  {
    to: "/sheets",
    label: "Printable / Fillable Sheets",
    message: "Week 1-4 or blank sheets. Print or fill and save.",
    badge: "SH",
    accent: "from-emerald-400/90 to-emerald-600/90",
  },
  {
    to: "/roster",
    label: "Roster",
    message: "Coaches: names, teams, units. Clean and fast.",
    badge: "RS",
    accent: "from-fuchsia-400/90 to-fuchsia-600/90",
  },
];

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
  }, [isCoach]);

  // Load athlete activity for coaches
  useEffect(() => {
    if (!isCoach) return;

    (async () => {
      setLoadingActivity(true);
      try {
        const roster = await listRoster();
        const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        
        const activities = await Promise.all(
          roster
            .filter((r: RosterEntry) => r.roles?.includes('athlete'))
            .map(async (athlete: RosterEntry) => {
              try {
                const sessions = await fetchAthleteSessions(athlete.uid);
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
  }, [isCoach]);

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
      
      <section className="relative isolate overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-brand-800 text-white shadow-lg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.16),transparent_55%)]" />
        <div className="container relative px-4 py-4 md:py-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-xl md:text-2xl font-semibold">PL Strength</h1>
              <p className="text-xs md:text-sm text-white/80 mt-1">
                {isCoach ? "Quick access to all tools" : "Your strength training companion"}
              </p>
            </div>
            {/* Only show quick access links for coaches */}
            {isCoach && (
              <div className="flex flex-wrap gap-2">
                {PAGE_LINKS.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`inline-flex items-center rounded-lg bg-white/15 px-3 py-1.5 text-xs md:text-sm font-medium text-white backdrop-blur-sm transition hover:bg-white/25 ${
                      link.hideOnMobile ? "hidden md:inline-flex" : ""
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="container mt-8 space-y-10">
        {/* Team Dashboard for Coaches */}
        {isCoach && (
          <div className="rounded-3xl border-2 border-brand-200 bg-gradient-to-br from-brand-50 to-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-brand-800">Team Dashboard</h2>
                <p className="text-sm text-brand-600 mt-1">Weekly activity and performance</p>
              </div>
              <Link
                to="/roster"
                className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-semibold text-sm transition"
              >
                View Roster →
              </Link>
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
                    <div className="text-sm text-gray-600 mb-1">Recent PRs</div>
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
                            <div className="text-sm text-gray-600">
                              {pr.session.lift} • Week {pr.session.week} • {pr.session.amrap?.reps || 0} reps @ {pr.session.amrap?.weight || 0} {pr.session.unit}
                            </div>
                          </div>
                          <div className="text-sm font-semibold text-green-700">
                            Est 1RM: {Math.round(pr.session.est1rm || 0)} {pr.session.unit}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Athlete Activity */}
                <div className="card bg-white/80">
                  <h3 className="text-lg font-bold text-gray-900 mb-3">Athlete Activity</h3>
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
                          .map((athlete) => (
                            <tr key={athlete.uid} className="border-b last:border-0">
                              <td className="py-2 font-medium">{athlete.name}</td>
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
                          ))}
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
          <div className="rounded-3xl border-2 border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-2xl font-bold text-blue-800">
                  Welcome{profile.firstName ? `, ${profile.firstName}` : ''}! 👋
                </h2>
                <p className="text-sm text-blue-600 mt-1">Quick links to get you started</p>
              </div>
              <button
                onClick={() => setShowOnboarding(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-sm transition"
              >
                📖 Tutorial
              </button>
            </div>
            
            <div className="grid md:grid-cols-3 gap-3">
              <Link
                to="/session"
                className="card text-center bg-white/80 hover:bg-white hover:shadow-md transition"
              >
                <div className="text-3xl mb-2">�</div>
                <div className="font-semibold text-gray-900">Today's Workout</div>
                <div className="text-xs text-gray-600 mt-1">Log your training session</div>
              </Link>
              
              <Link
                to="/calculator"
                className="card text-center bg-white/80 hover:bg-white hover:shadow-md transition"
              >
                <div className="text-3xl mb-2">🧮</div>
                <div className="font-semibold text-gray-900">Calculator</div>
                <div className="text-xs text-gray-600 mt-1">Calculate your Training Max</div>
              </Link>
              
              <Link
                to="/profile"
                className="card text-center bg-white/80 hover:bg-white hover:shadow-md transition"
              >
                <div className="text-3xl mb-2">⚙️</div>
                <div className="font-semibold text-gray-900">Profile</div>
                <div className="text-xs text-gray-600 mt-1">Set your TM & preferences</div>
              </Link>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {FEATURE_LINKS.map((feature) => (
            <Link
              key={feature.label}
              to={feature.to}
              className="group relative overflow-hidden rounded-3xl border border-gray-100 bg-white p-6 shadow-lg transition hover:-translate-y-1 hover:shadow-xl"
            >
              <div
                className={`absolute -right-16 top-1/2 h-40 w-40 -translate-y-1/2 rounded-full blur-3xl opacity-60 transition-opacity duration-200 group-hover:opacity-90 ${feature.accent}`}
                aria-hidden="true"
              />
              <div className="relative z-10 space-y-3">
                <span className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-600">
                  {feature.badge}
                </span>
                <h3 className="text-2xl font-semibold text-gray-900">
                  {feature.label}
                </h3>
                <p className="text-sm text-gray-600">{feature.message}</p>
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700">
                  Open {feature.label}
                  <span aria-hidden="true">-&gt;</span>
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="rounded-3xl border border-gray-100 bg-white/95 p-8 shadow-xl ring-1 ring-gray-100/80">
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
