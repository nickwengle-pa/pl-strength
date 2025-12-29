import React, { useEffect, useState } from "react";
import {
  ensureAnon,
  loadProfileRemote,
  recentSessions,
  saveSession,
  getStoredTeamSelection,
  type Team,
  type SessionRecord,
  type Profile,
  type Unit,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { estimate1RM, roundToPlate } from "../lib/tm";

type Lift = "bench" | "squat" | "deadlift";

const roundEstimate = (value: number, unit: Unit): number => {
  if (!Number.isFinite(value)) return 0;
  return roundToPlate(value, unit, unit === "lb" ? 5 : 2.5);
};

export default function Progress() {
  const [uid, setUid] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedLift, setSelectedLift] = useState<Lift>("bench");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showQuickPR, setShowQuickPR] = useState(false);
  const [prWeight, setPrWeight] = useState<string>("");
  const [prReps, setPrReps] = useState<string>("");
  const [prNote, setPrNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

  const { activeAthlete, isCoach, loading: coachLoading } = useActiveAthlete();
  const targetUid = isCoach && activeAthlete ? activeAthlete.uid : undefined;
  const activeAthleteName = activeAthlete
    ? [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") || activeAthlete.uid
    : "";

  const sessionTeam = (teamSelection || profile?.team || activeAthlete?.team) as Team | undefined;

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

  useEffect(() => {
    (async () => {
      try {
        if (targetUid) {
          await ensureAnon();
          const remote = await loadProfileRemote(targetUid);
          setUid(targetUid);
          setProfile(remote || null);
          return;
        }
        const u = await ensureAnon();
        setUid(u);
        const remote = await loadProfileRemote(u);
        setProfile(remote || null);
      } catch (err) {
        console.debug("Progress: Could not load profile", err);
      }
    })();
  }, [targetUid, activeAthlete, teamSelection]);

  useEffect(() => {
    if (!uid) return;
    
    (async () => {
      setLoading(true);
      try {
        const data = await recentSessions(
          selectedLift,
          50,
          targetUid || uid,
          sessionTeam
        );
        setSessions(data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      } catch (err) {
        console.debug("Could not load sessions for progress", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, selectedLift, targetUid, sessionTeam]);

  const unit = (profile?.unit || "lb") as Unit;
  const currentTM = profile?.tm?.[selectedLift] || 0;
  const liftWeek = profile?.liftWeeks?.[selectedLift] ?? profile?.currentWeek ?? 1;
  const liftCycle = profile?.liftCycles?.[selectedLift] ?? profile?.currentCycle ?? 1;

  // Calculate stats
  const prSessions = sessions.filter(s => s.pr);
  const maxEst1RM =
    sessions.length > 0
      ? Math.max(...sessions.map((s) => roundEstimate(s.est1rm || 0, unit)))
      : 0;
  const avgAMRAP = sessions.length > 0 
    ? sessions.reduce((sum, s) => sum + (s.amrap?.reps || 0), 0) / sessions.length 
    : 0;

  const handleSaveQuickPR = async () => {
    const weight = Number(prWeight);
    const reps = Number(prReps);
    
    if (!weight || weight <= 0) {
      alert("Please enter a valid weight");
      return;
    }
    if (!reps || reps <= 0) {
      alert("Please enter a valid number of reps");
      return;
    }
    
    setSaving(true);
    try {
      const est1rm = roundEstimate(estimate1RM(weight, reps), unit);
      
      const record: SessionRecord = {
        lift: selectedLift,
        week: liftWeek,
        cycle: liftCycle,
        team: sessionTeam,
        unit,
        tm: currentTM,
        est1rm,
        pr: true,
        warmups: [],
        work: [],
        amrap: {
          weight,
          reps,
        },
        note: prNote.trim() || "Quick PR Entry",
        createdAt: Date.now(),
      };
      
      await saveSession(record, targetUid || uid);
      
      // Refresh sessions
      const data = await recentSessions(
        selectedLift,
        50,
        targetUid || uid,
        sessionTeam
      );
      setSessions(data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      
      // Reset form
      setPrWeight("");
      setPrReps("");
      setPrNote("");
      setShowQuickPR(false);
    } catch (err) {
      console.error("Failed to save PR", err);
      alert("Failed to save PR. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (coachLoading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1>Progress Tracking</h1>
        <div className="flex items-center gap-3">
          {targetUid && (
            <div className="text-sm text-gray-600">Viewing: {activeAthleteName}</div>
          )}
          <button
            onClick={() => setShowQuickPR(true)}
            className="btn btn-sm bg-green-600 hover:bg-green-700 text-white"
          >
            ⚡ Log Quick PR
          </button>
        </div>
      </div>

      {isCoach && !targetUid ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          No athlete selected. Choose an athlete from the roster to view their progress.
        </div>
      ) : null}

      {/* Lift selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(["bench", "squat", "deadlift"] as Lift[]).map((lift) => (
          <button
            key={lift}
            className={`btn ${selectedLift === lift ? "btn-primary" : ""}`}
            onClick={() => setSelectedLift(lift)}
          >
            {icon(lift)} {cap(lift)}
          </button>
        ))}
      </div>

      {/* Stats cards */}
      <div className="grid md:grid-cols-4 gap-4">
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">Current TM</div>
          <div className="text-3xl font-bold text-brand-600">
            {currentTM || "—"}
          </div>
          <div className="text-xs text-gray-500">{unit}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">Max Est. 1RM</div>
          <div className="text-3xl font-bold text-purple-600">
            {maxEst1RM ? roundEstimate(maxEst1RM, unit) : "—"}
          </div>
          <div className="text-xs text-gray-500">{unit}</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">Total PRs</div>
          <div className="text-3xl font-bold text-green-600">
            {prSessions.length}
          </div>
          <div className="text-xs text-gray-500">personal records</div>
        </div>
        <div className="card text-center">
          <div className="text-sm text-gray-600 mb-1">Avg AMRAP</div>
          <div className="text-3xl font-bold text-blue-600">
            {avgAMRAP ? avgAMRAP.toFixed(1) : "—"}
          </div>
          <div className="text-xs text-gray-500">reps</div>
        </div>
      </div>

      {loading ? (
        <div className="card text-center text-gray-600 py-8">
          Loading session data...
        </div>
      ) : sessions.length === 0 ? (
        <div className="card text-center text-gray-600 py-8">
          No workout sessions recorded yet for {cap(selectedLift)}.
          <br />
          Complete your first workout to start tracking progress!
        </div>
      ) : (
        <>
          {/* TM Over Time Chart */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Training Max Progress</h2>
            <TMChart sessions={sessions} unit={unit} currentTM={currentTM} />
          </div>

          {/* Est 1RM Chart */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Estimated 1RM Over Time</h2>
            <Est1RMChart sessions={sessions} unit={unit} />
          </div>

          {/* AMRAP Reps Chart */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">AMRAP Reps Trend</h2>
            <AMRAPChart sessions={sessions} />
          </div>

          {/* PR Timeline */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">dY?+ PR Timeline</h2>
            {prSessions.length === 0 ? (
              <div className="text-center text-gray-600 py-4">
                No PRs yet. Keep pushing!
              </div>
            ) : (
              <div className="space-y-3">
                {prSessions.slice().reverse().map((session, idx) => {
                  const amrapReps = session.amrap?.reps ?? 0;
                  const amrapWeight = session.amrap?.weight ?? 0;
                  return (
                    <div
                      key={idx}
                      className="rounded-xl border border-green-200 bg-green-50 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Date
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {formatDate(session.createdAt)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Cycle / Week
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            Cycle {session.cycle ?? 1} / Week {session.week}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            AMRAP
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {amrapReps} reps @ {amrapWeight} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Est 1RM
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {roundEstimate(session.est1rm || 0, unit)} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            TM
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {session.tm || 0} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            PR
                          </div>
                          <div className="text-sm font-semibold text-green-700">
                            Yes
                          </div>
                        </div>
                      </div>
                      {session.note && (
                        <div className="mt-2 text-xs text-gray-600">
                          Note: {session.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Sessions Table */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Recent Sessions</h2>
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white/80">
              <div className="divide-y divide-gray-200">
                {sessions.slice(-20).reverse().map((s, idx) => {
                  const amrapReps = s.amrap?.reps ?? 0;
                  const amrapWeight = s.amrap?.weight ?? 0;
                  return (
                    <div key={idx} className="px-4 py-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Date
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {formatDate(s.createdAt)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Cycle / Week
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            Cycle {s.cycle ?? 1} / Week {s.week}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 text-xs text-gray-600 sm:grid-cols-2 lg:grid-cols-4">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            TM
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {s.tm || 0} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            AMRAP
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {amrapReps} reps @ {amrapWeight} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            Est 1RM
                          </div>
                          <div className="text-sm font-semibold text-gray-900">
                            {roundEstimate(s.est1rm || 0, unit)} {unit}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            PR
                          </div>
                          <div className={`text-sm font-semibold ${s.pr ? "text-green-700" : "text-gray-500"}`}>
                            {s.pr ? "Yes" : "No"}
                          </div>
                        </div>
                      </div>
                      {s.note && (
                        <div className="mt-2 text-xs text-gray-600">
                          Note: {s.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Quick PR Entry Modal */}
      {showQuickPR && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowQuickPR(false)}
        >
          <div 
            className="card max-w-md w-full shadow-2xl animate-in fade-in zoom-in duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-t-2xl border-b-2 border-green-200 bg-green-50 px-6 py-4 -mx-6 -mt-6 mb-4">
              <h2 className="text-lg font-bold text-green-900">⚡ Log Quick PR</h2>
              <p className="text-sm text-green-700 mt-1">Record a personal record for {cap(selectedLift)}</p>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Weight ({unit})
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  className="field w-full"
                  placeholder="e.g., 225"
                  value={prWeight}
                  onChange={(e) => setPrWeight(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reps
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="field w-full"
                  placeholder="e.g., 5"
                  value={prReps}
                  onChange={(e) => setPrReps(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Note (optional)
                </label>
                <input
                  type="text"
                  className="field w-full"
                  placeholder="e.g., Felt strong today"
                  value={prNote}
                  onChange={(e) => setPrNote(e.target.value)}
                />
              </div>
              
              {prWeight && prReps && (
                <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                  Est. 1RM: <span className="font-semibold text-gray-900">
                    {roundEstimate(estimate1RM(Number(prWeight), Number(prReps)), unit)} {unit}
                  </span>
                </div>
              )}
            </div>
            
            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={() => setShowQuickPR(false)}
                className="px-4 py-2 rounded-xl border border-gray-300 hover:bg-gray-100 font-semibold transition"
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuickPR}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold transition disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save PR"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Simple chart components using CSS
function TMChart({ sessions, unit, currentTM }: { sessions: SessionRecord[]; unit: string; currentTM: number }) {
  const tmValues = sessions.map(s => s.tm);
  const uniqueTMs = Array.from(new Set(tmValues));
  
  if (uniqueTMs.length === 1 && uniqueTMs[0] === currentTM) {
    return (
      <div className="text-center py-8 text-gray-600">
        Training Max has remained constant at {currentTM} {unit}.
        <br />
        Complete more workouts to see progression!
      </div>
    );
  }

  const maxTM = Math.max(...tmValues, currentTM);
  const minTM = Math.min(...tmValues, currentTM);
  const range = maxTM - minTM || 1;

  return (
    <div className="space-y-2">
      <div className="relative h-64 border rounded-xl p-4 bg-gray-50">
        {sessions.map((s, idx) => {
          const x = (idx / Math.max(sessions.length - 1, 1)) * 100;
          const y = 100 - ((s.tm - minTM) / range) * 80 - 10;
          
          return (
            <div
              key={idx}
              className="absolute w-3 h-3 bg-brand-500 rounded-full"
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${s.tm} ${unit} on ${formatDate(s.createdAt)}`}
            />
          );
        })}
        {/* Current TM indicator */}
        <div
          className="absolute right-4 w-3 h-3 bg-green-500 rounded-full ring-2 ring-green-300"
          style={{ top: `${100 - ((currentTM - minTM) / range) * 80 - 10}%` }}
          title={`Current: ${currentTM} ${unit}`}
        />
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>First: {sessions[0]?.tm || 0} {unit}</span>
        <span className="text-green-600 font-semibold">Current: {currentTM} {unit}</span>
      </div>
    </div>
  );
}

function Est1RMChart({ sessions, unit }: { sessions: SessionRecord[]; unit: Unit }) {
  const est1RMs = sessions.map((s) => roundEstimate(s.est1rm || 0, unit));
  const max = Math.max(...est1RMs);
  const min = Math.min(...est1RMs);
  const range = max - min || 1;

  return (
    <div className="space-y-2">
      <div className="relative h-64 border rounded-xl p-4 bg-gray-50">
        {sessions.map((s, idx) => {
          const x = (idx / Math.max(sessions.length - 1, 1)) * 100;
          const rounded = roundEstimate(s.est1rm || 0, unit);
          const y = 100 - ((rounded - min) / range) * 80 - 10;
          const isPR = s.pr;
          
          return (
            <div
              key={idx}
              className={`absolute w-3 h-3 rounded-full ${
                isPR ? "bg-green-500 ring-2 ring-green-300" : "bg-purple-500"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${roundEstimate(s.est1rm || 0, unit)} ${unit} ${isPR ? "(PR)" : ""} on ${formatDate(s.createdAt)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Min: {roundEstimate(min, unit)} {unit}</span>
        <span className="font-semibold">Max: {roundEstimate(max, unit)} {unit}</span>
      </div>
    </div>
  );
}

function AMRAPChart({ sessions }: { sessions: SessionRecord[] }) {
  const amrapReps = sessions.map(s => s.amrap?.reps || 0);
  const max = Math.max(...amrapReps, 10);

  return (
    <div className="space-y-2">
      <div className="relative h-64 border rounded-xl p-4 bg-gray-50">
        {sessions.map((s, idx) => {
          const x = (idx / Math.max(sessions.length - 1, 1)) * 100;
          const reps = s.amrap?.reps || 0;
          const y = 100 - (reps / max) * 80 - 10;
          const isPR = s.pr;
          
          return (
            <div
              key={idx}
              className={`absolute w-3 h-3 rounded-full ${
                isPR ? "bg-green-500 ring-2 ring-green-300" : "bg-blue-500"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${reps} reps ${isPR ? "(PR)" : ""} on ${formatDate(s.createdAt)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Range: 0-{max} reps</span>
        <span>Average: {(amrapReps.reduce((a, b) => a + b, 0) / amrapReps.length).toFixed(1)} reps</span>
      </div>
    </div>
  );
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}

function icon(k: Lift) {
  return { bench: "🧰", squat: "🦵", deadlift: "🧲" }[k];
}
