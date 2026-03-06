import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultEquipment,
  ensureAnon,
  loadProfileRemote,
  saveProfile,
  recentSessions,
  getStoredTeamSelection,
  type Team,
  type Profile,
  type Unit,
  type SessionRecord,
} from "../lib/db";
import { roundToPlate, weekPercents, warmupPercents } from "../lib/tm";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { useToast } from "../context/ToastContext";

type Lift = "bench" | "squat" | "deadlift";
type Week = 1 | 2 | 3;

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

const cycleIncrement = (lift: Lift, unit: Unit): number => {
  const upperIncrement = unit === "kg" ? 2.5 : 5;
  const lowerIncrement = unit === "kg" ? 5 : 10;
  return lift === "bench" ? upperIncrement : lowerIncrement;
};

const deriveBaseTm = (profile: Profile | null, lift: Lift): number => {
  const fromTm = profile?.tm?.[lift];
  if (typeof fromTm === "number" && Number.isFinite(fromTm) && fromTm > 0) {
    return fromTm;
  }
  const fromOneRm = profile?.oneRm?.[lift];
  if (typeof fromOneRm === "number" && Number.isFinite(fromOneRm) && fromOneRm > 0) {
    return fromOneRm * 0.9;
  }
  return 100;
};

const PCT: Record<Week, Array<[number,string]>> = {
  1: [[0.65,"x5"], [0.75,"x5"], [0.85,"x5+"]],
  2: [[0.70,"x3"], [0.80,"x3"], [0.90,"x3+"]],
  3: [[0.75,"x5"], [0.85,"x3"], [0.95,"x1+"]],
};

function roundWeight(x:number, unit:Unit) {
  // kid-friendly: simple rounding (lbs -> 5s, kg -> 2.5s)
  const step = unit === "lb" ? 5 : 2.5;
  return Math.round(x / step) * step;
}

export default function Summary() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [uid, setUid] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lift, setLift] = useState<Lift>("bench");
  const [week, setWeek] = useState<Week>(1);
  const [cycle, setCycle] = useState<number>(1);
  const [tm, setTm] = useState<number | "">( "");
  const [completedLifts, setCompletedLifts] = useState<Set<Lift>>(new Set());
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

  const { activeAthlete, isCoach, loading: coachLoading, notifyProfileChange, version } = useActiveAthlete();
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
          const profileData: Profile = remote
            ? { ...remote, equipment: remote.equipment ?? defaultEquipment() }
            : {
                uid: targetUid,
                firstName: activeAthlete?.firstName ?? "",
                lastName: activeAthlete?.lastName ?? "",
                unit: (activeAthlete?.unit as Unit) || "lb",
                accessCode: null,
                tm: {},
                oneRm: {},
                equipment: defaultEquipment(),
                team: activeAthlete?.team ?? undefined,
              } as Profile;
          setUid(targetUid);
          setProfile(profileData);
          return;
        }
        const u = await ensureAnon();
        setUid(u);
        const remote = await loadProfileRemote(u);
        const profileData: Profile = remote
          ? { ...remote, equipment: remote.equipment ?? defaultEquipment() }
          : {
              uid: u,
              firstName: "",
              lastName: "",
              unit: "lb",
              accessCode: null,
              tm: {},
              oneRm: {},
              equipment: defaultEquipment(),
            };
        setProfile(profileData);
      } catch (err) {
        // Handle case where user is signing out - ignore Firestore permission errors
        console.debug("Summary: Could not load profile (user may be signing out)", err);
      }
    })();
  }, [targetUid, activeAthlete, version, teamSelection]);

  useEffect(() => {
    if (!profile) {
      setTm("");
      return;
    }
    const existing = profile.tm?.[lift];
    setTm(existing ?? "");
  }, [lift, profile]);

  // Load recent sessions to detect completed lifts for the current week
  useEffect(() => {
    if (!uid) return;
    
    (async () => {
      setLoadingSessions(true);
      try {
        const allLifts: Lift[] = ["bench", "squat", "deadlift"];
        const completed = new Set<Lift>();
        
        // Check each lift for recent sessions matching current week
        await Promise.all(
          allLifts.map(async (liftName) => {
            const sessions = await recentSessions(
              liftName,
              5,
              targetUid || uid,
              sessionTeam
            );
            
            // Check if any session from today matches current week
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTimestamp = today.getTime();
            
            const hasCompletedToday = sessions.some((s) => {
              const sessionDate = s.createdAt || 0;
              return sessionDate >= todayTimestamp && s.week === week;
            });
            
            if (hasCompletedToday) {
              completed.add(liftName);
            }
          })
        );
        
        setCompletedLifts(completed);
      } catch (err) {
        console.debug("Could not load sessions for completion status", err);
      } finally {
        setLoadingSessions(false);
      }
    })();
  }, [uid, week, targetUid, sessionTeam]);

  const unit = profile?.unit || "lb";

  const saveTM = async () => {
    if (!profile || tm === "") return;
    const updated: Profile = {
      ...profile,
      tm: { ...(profile.tm || {}), [lift]: Number(tm) },
    };
    try {
      await saveProfile(updated, { skipLocal: Boolean(targetUid), requireRemote: true });
      setProfile(updated);
      notifyProfileChange();
    } catch (err) {
      console.warn("Failed to save training max", err);
      showToast("Unable to save training max right now. Please try again.", "error");
    }
  };

  const sessionPlan = typeof tm === "number"
    ? (() => {
        const increment = cycleIncrement(lift, unit);
        const cycleTm = tm + (cycle - 1) * increment;
        const warmups = warmupPercents().map((p) => ({
          pct: Math.round(p * 100),
          weight: roundWeight(cycleTm * p, unit),
          reps: "5"
        }));
        const work = PCT[week].map(([p, reps]) => ({
          pct: Math.round(p * 100),
          weight: roundWeight(cycleTm * p, unit),
          reps
        }));
        return { warmups, work };
      })()
    : { warmups: [], work: [] };

  if (coachLoading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading Coach Tools...</div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <h1>Quick Summary</h1>

      {isCoach && !targetUid ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          No Athlete Selected. You Can Still Review The Template Numbers, Or Choose An Athlete From The Roster For Personalized Data.
        </div>
      ) : null}

      {targetUid ? (<div className="text-sm text-gray-600">Viewing: {activeAthleteName}</div>) : null}

      {/* Today's Workout Dashboard */}
      <div className="card space-y-4 bg-gradient-to-br from-brand-50 to-white border-2 border-brand-200">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-brand-700">Today's Workout</h2>
          <div className="badge text-lg px-4 py-2">Week {week}</div>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(["bench","squat","deadlift"] as Lift[]).map(liftName => {
            const isCompleted = completedLifts.has(liftName);
            const hasTM = profile?.tm?.[liftName];
            
            return (
              <button
                key={liftName}
                className={`relative btn text-base py-4 ${
                  lift === liftName ? "btn-primary ring-2 ring-brand-400" : ""
                } ${isCompleted ? "bg-green-100 border-green-300 text-green-700" : ""}`}
                onClick={() => setLift(liftName)}
                disabled={loadingSessions}
              >
                <div className="flex flex-col items-center gap-1">
                  <span className="text-2xl">{icon(liftName)}</span>
                  <span className="font-semibold">{cap(liftName)}</span>
                  {isCompleted && (
                    <span className="text-green-600 text-xl">✓</span>
                  )}
                  {!hasTM && !isCompleted && (
                    <span className="text-xs text-gray-500">Set TM</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {profile?.tm?.[lift] ? (
          <button
            className="btn btn-primary w-full text-xl py-4 font-bold shadow-lg hover:shadow-xl transition-shadow"
            onClick={() => {
              const tmValue = profile.tm?.[lift];
              if (!tmValue) return;
              const params = new URLSearchParams({
                lift,
                week: String(week),
                tm: String(tmValue)
              });
              navigate(`/session?${params.toString()}`);
            }}
          >
            🏋️ Start {cap(lift)} Workout
          </button>
        ) : (
          <div className="text-center py-4 text-gray-600">
            Set A Training Max For {cap(lift)} Below To Start Your Workout
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        <div className="btn">Week</div>
        {[1,2,3].map(w => (
          <button key={w}
            className={`btn ${week===w ? "btn-primary" : ""}`}
            onClick={() => setWeek(w as Week)}>{w}</button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="btn">Cycle</div>
        {[1,2,3].map(c => (
          <button key={c}
            className={`btn ${cycle===c ? "btn-primary" : ""}`}
            onClick={() => setCycle(c)}>{c}</button>
        ))}
      </div>

      <div className="card space-y-3">
        <div className="text-lg font-semibold">Training Max</div>
        <div className="flex items-center gap-3">
          <input
            className="border rounded-xl px-3 py-2 w-40"
            type="number" min={0} step="1" value={tm as any}
            onChange={(e)=> setTm(e.target.value==="" ? "" : Number(e.target.value))}
            placeholder={`TM In ${unit}`}
          />
          <button className="btn btn-primary" onClick={saveTM}>Save TM</button>
          <div className="badge">Units: {unit}</div>
        </div>
        <p className="text-sm text-gray-600">
          TM = Heavy Single You Could Hit For ~2-3 Reps. We'll Do Simple Math And Round Plates.
        </p>
      </div>

      {typeof tm === "number" && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="mb-2 font-bold text-gray-500 uppercase text-sm">Warm Up Sets</h3>
            <ul className="space-y-2 mb-6">
              {sessionPlan.warmups.map((s,i) => (
                <li key={i} className="flex items-center justify-between border rounded-xl px-3 py-2 bg-gray-50">
                  <div className="font-medium text-gray-500">{s.pct}%</div>
                  <div className="text-gray-500">{s.reps}</div>
                  <div className="text-xl font-bold text-gray-700">{s.weight} {unit}</div>
                </li>
              ))}
            </ul>

            <h3 className="mb-2 font-bold text-brand-600 uppercase text-sm">Work Sets</h3>
            <ul className="space-y-2">
              {sessionPlan.work.map((s,i) => (
                <li key={i} className="flex items-center justify-between border-2 border-brand-100 rounded-xl px-3 py-2 bg-white">
                  <div className="font-medium text-brand-600">{s.pct}%</div>
                  <div className="text-brand-600 font-bold">{s.reps}</div>
                  <div className="text-xl font-bold text-black">{s.weight} {unit}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="mb-2">Coach Tips</h3>
            <ul className="list-disc pl-5 text-sm space-y-1">
              <li>Move Fast. Rest 2-3 Min On The Big Sets.</li>
              <li>"+" Means Stop With 1-2 Reps In The Tank. No Grinders.</li>
              <li>After Week 3, Adjust TMs And Start The Next Cycle.</li>
            </ul>
          </div>
        </div>
      )}

      {/* Program Projection Tables */}
      {profile && (
        <div className="mt-12 space-y-8">
          <h2 className="text-2xl font-bold text-gray-800 border-b pb-2">Program Projection</h2>
          
          {LIFTS.map((liftKey) => {
            const baseTm = deriveBaseTm(profile, liftKey);
            
            const increment = cycleIncrement(liftKey, unit);
            const roundStep = unit === "kg" ? 2.5 : 5;

            return (
              <div key={liftKey} className="card overflow-hidden">
                <h3 className="text-lg font-bold uppercase mb-4 text-brand-700">{liftKey}</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
                      <tr>
                        <th className="px-4 py-3">Cycle</th>
                        <th className="px-4 py-3">TM</th>
                        <th className="px-4 py-3">Week 1 (5+)</th>
                        <th className="px-4 py-3">Week 2 (3+)</th>
                        <th className="px-4 py-3">Week 3 (1+)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[1, 2, 3].map((cycle) => {
                        const cycleTm = baseTm + (cycle - 1) * increment;
                        const w1Top = roundToPlate(cycleTm * 0.85, unit, roundStep);
                        const w2Top = roundToPlate(cycleTm * 0.90, unit, roundStep);
                        const w3Top = roundToPlate(cycleTm * 0.95, unit, roundStep);
                        
                        return (
                          <tr key={cycle} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">Cycle {cycle}</td>
                            <td className="px-4 py-3 text-gray-600">{Math.round(cycleTm)}</td>
                            <td className="px-4 py-3 font-bold">{w1Top} <span className="text-xs font-normal text-gray-500">x5+</span></td>
                            <td className="px-4 py-3 font-bold">{w2Top} <span className="text-xs font-normal text-gray-500">x3+</span></td>
                            <td className="px-4 py-3 font-bold">{w3Top} <span className="text-xs font-normal text-gray-500">x1+</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function cap(s:string){ return s[0].toUpperCase()+s.slice(1); }
function icon(k:Lift){ return {bench:"🧰", squat:"🦵", deadlift:"🧲"}[k]; }




