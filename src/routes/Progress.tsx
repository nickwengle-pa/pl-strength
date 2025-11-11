import React, { useEffect, useState } from "react";
import {
  ensureAnon,
  loadProfileRemote,
  recentSessions,
  saveSession,
  type SessionRecord,
  type Profile,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { estimate1RM } from "../lib/tm";

type Lift = "bench" | "squat" | "deadlift" | "press";

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

  const { activeAthlete, isCoach, loading: coachLoading } = useActiveAthlete();
  const targetUid = isCoach && activeAthlete ? activeAthlete.uid : undefined;
  const activeAthleteName = activeAthlete
    ? [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") || activeAthlete.uid
    : "";

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
  }, [targetUid, activeAthlete]);

  useEffect(() => {
    if (!uid) return;
    
    (async () => {
      setLoading(true);
      try {
        const data = await recentSessions(selectedLift, 50, targetUid || uid);
        setSessions(data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      } catch (err) {
        console.debug("Could not load sessions for progress", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, selectedLift, targetUid]);

  const unit = profile?.unit || "lb";
  const currentTM = profile?.tm?.[selectedLift] || 0;

  // Calculate stats
  const prSessions = sessions.filter(s => s.pr);
  const maxEst1RM = sessions.length > 0 ? Math.max(...sessions.map(s => s.est1rm || 0)) : 0;
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
      const est1rm = estimate1RM(weight, reps);
      
      const record: SessionRecord = {
        lift: selectedLift,
        week: profile?.currentWeek || 1,
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
      const data = await recentSessions(selectedLift, 50, targetUid || uid);
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
        {(["bench", "squat", "deadlift", "press"] as Lift[]).map((lift) => (
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
            {maxEst1RM ? Math.round(maxEst1RM) : "—"}
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
            <h2 className="text-xl font-bold mb-4">🏆 PR Timeline</h2>
            {prSessions.length === 0 ? (
              <div className="text-center text-gray-600 py-4">
                No PRs yet. Keep pushing!
              </div>
            ) : (
              <div className="space-y-2">
                {prSessions.reverse().map((session, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between border rounded-xl px-4 py-3 bg-green-50 border-green-200"
                  >
                    <div>
                      <div className="font-semibold">
                        Week {session.week} • {session.amrap?.reps || 0} reps @ {session.amrap?.weight || 0} {unit}
                      </div>
                      <div className="text-sm text-gray-600">
                        Est 1RM: {Math.round(session.est1rm || 0)} {unit}
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(session.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Sessions Table */}
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Recent Sessions</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-2">Date</th>
                    <th className="pb-2">Week</th>
                    <th className="pb-2">TM</th>
                    <th className="pb-2">AMRAP</th>
                    <th className="pb-2">Est 1RM</th>
                    <th className="pb-2">PR</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.slice(-20).reverse().map((s, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2">{formatDate(s.createdAt)}</td>
                      <td className="py-2">Week {s.week}</td>
                      <td className="py-2">{s.tm} {unit}</td>
                      <td className="py-2">
                        {s.amrap?.reps || 0} @ {s.amrap?.weight || 0} {unit}
                      </td>
                      <td className="py-2 font-semibold">{Math.round(s.est1rm || 0)} {unit}</td>
                      <td className="py-2">
                        {s.pr && <span className="text-green-600">✓ PR</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                    {estimate1RM(Number(prWeight), Number(prReps)).toFixed(1)} {unit}
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

function Est1RMChart({ sessions, unit }: { sessions: SessionRecord[]; unit: string }) {
  const est1RMs = sessions.map(s => s.est1rm || 0);
  const max = Math.max(...est1RMs);
  const min = Math.min(...est1RMs);
  const range = max - min || 1;

  return (
    <div className="space-y-2">
      <div className="relative h-64 border rounded-xl p-4 bg-gray-50">
        {sessions.map((s, idx) => {
          const x = (idx / Math.max(sessions.length - 1, 1)) * 100;
          const y = 100 - (((s.est1rm || 0) - min) / range) * 80 - 10;
          const isPR = s.pr;
          
          return (
            <div
              key={idx}
              className={`absolute w-3 h-3 rounded-full ${
                isPR ? "bg-green-500 ring-2 ring-green-300" : "bg-purple-500"
              }`}
              style={{ left: `${x}%`, top: `${y}%` }}
              title={`${Math.round(s.est1rm || 0)} ${unit} ${isPR ? "(PR)" : ""} on ${formatDate(s.createdAt)}`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-600">
        <span>Min: {Math.round(min)} {unit}</span>
        <span className="font-semibold">Max: {Math.round(max)} {unit}</span>
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
  return { bench: "🧰", squat: "🦵", deadlift: "🧲", press: "🫱" }[k];
}
