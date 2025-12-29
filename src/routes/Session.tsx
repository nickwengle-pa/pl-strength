import { useEffect, useMemo, useRef, useState } from "react";
import {
  estimate1RM,
  warmupPercents,
  weekPercents,
  roundToPlate,
} from "../lib/tm";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import {
  loadProfileRemote,
  saveProfile,
  saveSession,
  bestEst1RM,
  recentSessions,
  defaultEquipment,
  getStoredTeamSelection,
  type Team,
  type Profile,
} from "../lib/db";
import CoachTips from "../components/CoachTips";
import TrendMini from "../components/TrendMini";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { PlateCalculatorDisplay } from "../components/PlateMath";

type Lift = "bench" | "squat" | "deadlift";
type Week = 1 | 2 | 3;
type Unit = "lb" | "kg";

type SetOutcome = { status: "" | "S" | "F"; actualReps: string };

const warmRepLabels = ["5", "5", "3"];
const workRepLabels: Record<Week, [string, string, string]> = {
  1: ["5", "5", "5+"],
  2: ["3", "3", "3+"],
  3: ["5", "3", "1+"],
};

const LIFT_LABELS: Record<Lift, string> = {
  bench: "Bench Press",
  squat: "Back Squat",
  deadlift: "Deadlift",
};

const bumpTrainingMax = (
  tm: Profile["tm"] | undefined,
  lift: Lift,
  unit: Unit
): Profile["tm"] | undefined => {
  if (!tm) return tm;
  const current = tm[lift];
  if (typeof current !== "number" || !Number.isFinite(current)) return tm;
  const isLower = lift === "squat" || lift === "deadlift";
  const increment = unit === "kg" ? (isLower ? 5 : 2.5) : (isLower ? 10 : 5);
  return { ...tm, [lift]: Number((current + increment).toFixed(2)) };
};

const WEEK_THEMES: Record<Week, { name: string; focus: string; blurb: string }> = {
  1: {
    name: "Foundation Volume",
    focus: "Set the tone with crisp sets of five.",
    blurb: "Smooth technique and steady breathing build momentum for the cycle.",
  },
  2: {
    name: "Power Triples",
    focus: "Drive explosively through the sticking point.",
    blurb: "Sharpen power output and keep one rep in the tank on every set.",
  },
  3: {
    name: "Peak Week",
    focus: "Prime the nervous system and chase a confident AMRAP.",
    blurb: "Own each top set and push smartly into PR territory.",
  },
};

const resolveLiftWeek = (profile: Profile | null, lift: Lift): Week =>
  profile?.liftWeeks?.[lift] ?? profile?.currentWeek ?? 1;

const resolveLiftCycle = (profile: Profile | null, lift: Lift): number =>
  profile?.liftCycles?.[lift] ?? profile?.currentCycle ?? 1;

const seedLiftWeeks = (value: Week): Record<Lift, Week> => ({
  bench: value,
  squat: value,
  deadlift: value,
});

const seedLiftCycles = (value: number): Record<Lift, number> => ({
  bench: value,
  squat: value,
  deadlift: value,
});

export default function Session() {
  const [lift, setLift] = useState<Lift>("bench");
  const [week, setWeek] = useState<Week>(1);
  const [cycle, setCycle] = useState<number>(1);
  const [unit, setUnit] = useState<Unit>("lb");
  const [tm, setTm] = useState<number | null>(null);
  const [mobileMode, setMobileMode] = useState(false);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [liftConfirmed, setLiftConfirmed] = useState(false);
  const [showWeekAdvancePrompt, setShowWeekAdvancePrompt] = useState(false);
  const [plateCalcTarget, setPlateCalcTarget] = useState<number | null>(null);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());
  const autoAdvanceRef = useRef(false);

  const [step, setStep] = useState(5);
  const [amrapReps, setAmrapReps] = useState<number>(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [est, setEst] = useState<number | null>(null);
  const [prFlag, setPrFlag] = useState<boolean>(false);
  const [warmOutcomes, setWarmOutcomes] = useState<SetOutcome[]>([]);
  const [workOutcomes, setWorkOutcomes] = useState<SetOutcome[]>([]);
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
    setShowWeekAdvancePrompt(false);
    setLiftConfirmed(false);
  }, [sessionTeam]);


  useEffect(() => {
    (async () => {
      if (targetUid) {
        const p = await loadProfileRemote(targetUid);
        if (p) {
          setProfile(p);
          const nextUnit = (p.unit || "lb") as Unit;
          setUnit(nextUnit);
          setStep(nextUnit === "lb" ? 5 : 2.5);
          const tmForLift = p.tm?.[lift] ?? null;
          setTm(tmForLift ?? null);
          const nextWeek = resolveLiftWeek(p, lift);
          const nextCycle = resolveLiftCycle(p, lift);
          if (!liftConfirmed) {
            setWeek(nextWeek);
            setCycle(nextCycle);
          }
        } else {
          setProfile(null);
          setUnit("lb");
          setStep(5);
          setTm(null);
        }
      } else {
        const remote = await loadProfileRemote();
        const local = loadProfileLocal();
        const p = remote || local;
        if (p) {
          setProfile(p);
          const nextUnit = (p.unit || "lb") as Unit;
          setUnit(nextUnit);
          setStep(nextUnit === "lb" ? 5 : 2.5);
          const tmForLift = p.tm?.[lift] ?? null;
          setTm(tmForLift ?? null);
          const nextWeek = resolveLiftWeek(p, lift);
          const nextCycle = resolveLiftCycle(p, lift);
          if (!liftConfirmed) {
            setWeek(nextWeek);
            setCycle(nextCycle);
          }
        } else {
          setProfile(null);
          setTm(null);
        }
      }
      setAmrapReps(0);
      setNote("");
      setPrFlag(false);
    })();
  }, [lift, targetUid, version, teamSelection]);

  const warm = useMemo(() => {
    if (!tm) return [];
    return warmupPercents().map((pct, index) => ({
      pct,
      weight: roundToPlate(tm * pct, unit, step),
      reps: Number(warmRepLabels[index]),
      repsDisplay: warmRepLabels[index],
    }));
  }, [tm, unit, step]);

  const work = useMemo(() => {
    if (!tm) return [];
    const percents = weekPercents(week);
    const repsDisplay = workRepLabels[week];
    const numericReps = week === 1 ? [5, 5, 5] : week === 2 ? [3, 3, 3] : [5, 3, 1];
    return percents.map((pct, index) => ({
      pct,
      weight: roundToPlate(tm * pct, unit, step),
      reps: numericReps[index],
      repsDisplay: repsDisplay[index],
    }));
  }, [tm, unit, step, week]);

  useEffect(() => {
    setWarmOutcomes(warm.map(() => ({ status: "", actualReps: "" })));
  }, [warm]);

  useEffect(() => {
    setWorkOutcomes(work.map(() => ({ status: "", actualReps: "" })));
  }, [work]);

  const lastWorkWeight = work[2]?.weight || 0;

  useEffect(() => {
    if (!tm || work.length === 0 || amrapReps <= 0) {
      setEst(null);
      return;
    }
    const estimate = estimate1RM(lastWorkWeight, amrapReps);
    setEst(Number(estimate.toFixed(1)));
  }, [amrapReps, work, tm, lastWorkWeight]);

  useEffect(() => {
    if (coachLoading) return;
    if (isCoach && !targetUid) {
      setHistory([]);
      return;
    }
    (async () => {
      const rows = await recentSessions(lift, 12, targetUid, sessionTeam);
      // rows are returned newest-first (descending).
      // We reverse them for the chart (oldest-first).
      const chartHistory = [...rows].reverse();
      setHistory(chartHistory);

      // Smart Default Logic:
      // If the user hasn't manually picked a week yet (liftConfirmed is false),
      // try to guess the next week based on the most recent session for this lift.
      const hasLiftProgress =
        typeof profile?.liftWeeks?.[lift] === "number" ||
        typeof profile?.liftCycles?.[lift] === "number";
      if (!liftConfirmed && rows.length > 0 && !hasLiftProgress) {
        const lastSession = rows[0]; // Newest session
        const lastWeek = lastSession.week;
        const lastCycle = lastSession.cycle ?? 1;
        // Simple cycle logic: 1->2->3->1
        const nextWeek: Week = lastWeek === 1 ? 2 : lastWeek === 2 ? 3 : 1;
        const nextCycle = lastWeek === 3 ? lastCycle + 1 : lastCycle;
        setWeek(nextWeek);
        setCycle(nextCycle);
      }
    })();
  }, [lift, targetUid, isCoach, coachLoading, version, liftConfirmed, sessionTeam, profile]);

  const setWarmStatus = (index: number, status: "" | "S" | "F") => {
    setWarmOutcomes((prev) => {
      const next = [...prev];
      const current = next[index] ?? { status: "", actualReps: "" };
      next[index] = {
        status,
        actualReps: status === "F" ? current.actualReps : "",
      };
      return next;
    });
  };

  const setWarmActual = (index: number, value: string) => {
    setWarmOutcomes((prev) => {
      const next = [...prev];
      next[index] = { status: "F", actualReps: value };
      return next;
    });
  };

  const setWorkStatus = (index: number, status: "" | "S" | "F") => {
    setWorkOutcomes((prev) => {
      const next = [...prev];
      const current = next[index] ?? { status: "", actualReps: "" };
      next[index] = {
        status,
        actualReps: status === "F" ? current.actualReps : "",
      };
      return next;
    });
  };

  const setWorkActual = (index: number, value: string) => {
    setWorkOutcomes((prev) => {
      const next = [...prev];
      next[index] = { status: "F", actualReps: value };
      return next;
    });
  };

  const statusValue = (outcome?: SetOutcome): "S" | "F" | undefined =>
    outcome?.status === "S" || outcome?.status === "F" ? outcome.status : undefined;

  const actualValue = (outcome?: SetOutcome): number | undefined => {
    if (!outcome || outcome.status !== "F") return undefined;
    const parsed = Number(outcome.actualReps);
    if (!Number.isFinite(parsed) || parsed < 0) return undefined;
    return parsed;
  };

  const mergeSets = (
    sets: Array<{ pct: number; weight: number; reps: number }>,
    outcomes: SetOutcome[]
  ) =>
    sets.map((set, index) => {
      const status = statusValue(outcomes[index]);
      const actual = actualValue(outcomes[index]);
      return {
        ...set,
        ...(status ? { status } : {}),
        ...(typeof actual === "number" ? { actualReps: actual } : {}),
      };
    });

  async function save() {
    if (!tm || work.length === 0 || amrapReps <= 0) {
      alert("Set a training max and enter AMRAP reps.");
      return;
    }
    const missingActual = [...warmOutcomes, ...workOutcomes].some(
      (outcome) => outcome?.status === "F" && !outcome.actualReps.trim()
    );
    if (missingActual) {
      alert("Enter the actual reps completed for any set marked as a fail.");
      return;
    }

    const warmWithResults = mergeSets(warm, warmOutcomes);
    const workWithResults = mergeSets(work, workOutcomes);

    setSaving(true);
    try {
      const est1rm = Number(estimate1RM(lastWorkWeight, amrapReps).toFixed(1));
      const best = await bestEst1RM(lift, 20, targetUid, sessionTeam);
      const pr = est1rm > best;

      await saveSession(
        {
          lift,
          week,
          cycle,
          team: sessionTeam,
          unit,
          tm,
          warmups: warmWithResults,
          work: workWithResults,
          amrap: { weight: lastWorkWeight, reps: amrapReps },
          est1rm,
          note,
          pr,
        },
        targetUid
      );

      setPrFlag(pr);
      setEst(est1rm);

      const rows = await recentSessions(lift, 12, targetUid, sessionTeam);
      setHistory(rows.reverse());
      notifyProfileChange();

      if (week === 3) {
        const nextCycle = cycle + 1;
        await advanceWeek();
        alert(
          `Week 3 complete. ${LIFT_LABELS[lift]} moved to Cycle ${nextCycle}. Training max updated.`
        );
        return;
      }

      setShowWeekAdvancePrompt(true);
    } catch (err) {
      console.warn("Failed to save session", err);
      alert("Unable to save session right now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const persistLiftProgress = async (
    nextWeek: Week,
    nextCycle: number,
    nextTm?: Profile["tm"]
  ) => {
    setWeek(nextWeek);
    setCycle(nextCycle);
    setLiftConfirmed(true);
    if (!profile) return;
    const baseWeek = profile.currentWeek ?? week;
    const baseCycle = profile.currentCycle ?? cycle;
    const nextLiftWeeks =
      profile.liftWeeks && Object.keys(profile.liftWeeks).length > 0
        ? { ...seedLiftWeeks(baseWeek), ...profile.liftWeeks }
        : seedLiftWeeks(baseWeek);
    nextLiftWeeks[lift] = nextWeek;
    const nextLiftCycles =
      profile.liftCycles && Object.keys(profile.liftCycles).length > 0
        ? { ...seedLiftCycles(baseCycle), ...profile.liftCycles }
        : seedLiftCycles(baseCycle);
    nextLiftCycles[lift] = nextCycle;
    const updatedProfile: Profile = {
      ...profile,
      liftWeeks: nextLiftWeeks,
      liftCycles: nextLiftCycles,
      currentWeek: nextWeek,
      currentCycle: nextCycle,
      tm: nextTm ?? profile.tm,
    };
    await saveProfile(updatedProfile, { skipLocal: Boolean(targetUid) });
    setProfile(updatedProfile);
    const nextTmValue = updatedProfile.tm?.[lift];
    setTm(typeof nextTmValue === "number" && Number.isFinite(nextTmValue) ? nextTmValue : null);
    notifyProfileChange();
  };

  // Handle week change and save to profile
  const handleWeekChange = async (newWeek: Week) => {
    await persistLiftProgress(newWeek, cycle);
  };

  const handleCycleChange = async (newCycle: number) => {
    const normalized = Number.isFinite(newCycle) && newCycle >= 1 ? Math.floor(newCycle) : 1;
    await persistLiftProgress(week, normalized);
  };

  // Advance to next week (1->2->3->1) and bump TMs on new cycle
  const advanceWeek = async () => {
    if (autoAdvanceRef.current) return;
    autoAdvanceRef.current = true;
    const effectiveWeek: Week = week;
    try {
      if (effectiveWeek === 3) {
        const nextCycle = cycle + 1;
        const nextTm = bumpTrainingMax(profile?.tm, lift, unit);
        await persistLiftProgress(1, nextCycle, nextTm);
      } else {
        const nextWeek: Week = effectiveWeek === 1 ? 2 : 3;
        await persistLiftProgress(nextWeek, cycle);
      }
      setShowWeekAdvancePrompt(false);
    } finally {
      autoAdvanceRef.current = false;
    }
  };

  const maybeAutoAdvanceWeek3 = async () => {
    if (autoAdvanceRef.current) return false;
    if (!profile) return false;
    const effectiveWeek = resolveLiftWeek(profile, lift);
    const effectiveCycle = resolveLiftCycle(profile, lift);
    if (effectiveWeek !== 3) return false;
    const latest = history[history.length - 1];
    if (!latest || latest.week !== 3) return false;
    if ((latest.cycle ?? 1) !== effectiveCycle) return false;
    setShowWeekAdvancePrompt(false);
    await advanceWeek();
    return true;
  };

  useEffect(() => {
    void maybeAutoAdvanceWeek3();
  }, [history, profile, lift, cycle, week]);

  const estSeries = history
    .map((row) => row.est1rm)
    .filter((value: number) => typeof value === "number" && !Number.isNaN(value));
  const prevBest = estSeries.length ? Math.max(...estSeries) : 0;

  // Rest timer countdown
  useEffect(() => {
    if (!timerActive || restTimer <= 0) {
      setTimerActive(false);
      return;
    }
    
    const interval = setInterval(() => {
      setRestTimer(prev => {
        if (prev <= 1) {
          setTimerActive(false);
          // Play a sound or vibrate on completion
          if ('vibrate' in navigator) {
            navigator.vibrate([200, 100, 200]);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [timerActive, restTimer]);

  const startRestTimer = (seconds: number) => {
    setRestTimer(seconds);
    setTimerActive(true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const allSets = [...warm.map((s, i) => ({ ...s, phase: 'warm' as const, index: i })), 
                   ...work.map((s, i) => ({ ...s, phase: 'work' as const, index: i }))];

  const theme = WEEK_THEMES[week];
  const liftLabel = LIFT_LABELS[lift];
  const cycleNumber = cycle;
  const quickStats = [
    { label: "Lift", value: liftLabel },
    { label: "Week", value: `Cycle ${cycleNumber} / Week ${week} | ${theme.name}` },
    {
      label: "Training Max",
      value: tm && Number.isFinite(tm) ? `${tm} ${unit}` : "Set in Calculator",
    },
    {
      label: "Best Est. 1RM",
      value: prevBest > 0 ? `${prevBest} ${unit}` : "Log a session",
    },
  ];
  const heroBadge = targetUid
    ? `Working with ${activeAthleteName}`
    : "Personal session";

  if (coachLoading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading coach tools...</div>
      </div>
    );
  }

  // Mobile Workout Mode - Full screen simplified UI
  if (mobileMode && tm) {
    const currentSet = allSets[currentSetIndex];
    const isLastSet = currentSetIndex === allSets.length - 1;
    const isAMRAPSet = currentSet?.phase === 'work' && currentSetIndex === allSets.length - 1;
    
    return (
      <div className="fixed inset-0 z-50 bg-gradient-to-br from-brand-600 to-brand-800 text-white flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/20 flex-shrink-0">
          <div>
            <div className="text-xs opacity-80">Cycle {cycleNumber} · Week {week}</div>
            <div className="text-lg font-bold">{LIFT_LABELS[lift]}</div>
          </div>
          <button
            onClick={() => setMobileMode(false)}
            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg font-semibold text-sm"
          >
            Exit
          </button>
        </div>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {/* Set Counter */}
          <div className="px-4 py-3 text-center">
            <div className="text-xs opacity-80 uppercase tracking-wide">
              {currentSet?.phase === 'warm' ? 'Warm-up' : 'Work Set'}
            </div>
            <div className="text-5xl font-bold my-1">
              {currentSetIndex + 1} / {allSets.length}
            </div>
          </div>

          {/* Current Set Info */}
          {currentSet && (
            <div className="px-4 py-2 space-y-4">
              <div className="text-center space-y-3">
                <div className="text-8xl font-black leading-none">
                  {currentSet.weight}
                </div>
                <div className="text-2xl opacity-90">{unit}</div>
                <div className="text-xl mt-2">
                  {currentSet.phase === 'warm' 
                    ? `${warmRepLabels[currentSet.index]} reps`
                    : `${workRepLabels[week][currentSet.index]}`
                  }
                </div>
                <div className="text-base opacity-70">
                  {Math.round(currentSet.pct * 100)}% of TM
                </div>
                {isAMRAPSet && (
                  <div className="mt-4 mx-4 px-4 py-2 bg-yellow-400/20 rounded-xl border-2 border-yellow-300">
                    <div className="text-xl font-bold text-yellow-200">AMRAP SET!</div>
                    <div className="text-xs mt-1">Leave 1-2 reps in the tank</div>
                  </div>
                )}
              </div>

              {/* Rest Timer */}
              {timerActive && (
                <div className="text-center space-y-2 py-4">
                  <div className="text-xs uppercase tracking-wide opacity-80">Rest Timer</div>
                  <div className="text-6xl font-bold text-yellow-300">
                    {formatTime(restTimer)}
                  </div>
                  <button
                    onClick={() => setTimerActive(false)}
                    className="px-4 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-sm"
                  >
                    Cancel Timer
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Fixed Action Buttons at Bottom */}
        <div className="px-4 py-4 space-y-2 bg-gradient-to-t from-black/20 to-transparent flex-shrink-0 border-t border-white/10">
          {!timerActive && currentSet && (
            <>
              {/* Rest Timer Shortcuts */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => startRestTimer(60)}
                  className="py-3 bg-blue-500/30 hover:bg-blue-500/40 rounded-xl font-semibold"
                >
                  1:00
                </button>
                <button
                  onClick={() => startRestTimer(120)}
                  className="py-3 bg-blue-500/30 hover:bg-blue-500/40 rounded-xl font-semibold"
                >
                  2:00
                </button>
                <button
                  onClick={() => startRestTimer(180)}
                  className="py-3 bg-blue-500/30 hover:bg-blue-500/40 rounded-xl font-semibold"
                >
                  3:00
                </button>
              </div>

              {/* Mark Success/Fail */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    if (currentSet.phase === 'warm') {
                      setWarmStatus(currentSet.index, 'S');
                    } else {
                      setWorkStatus(currentSet.index, 'S');
                    }
                    if (!isLastSet) {
                      setCurrentSetIndex(prev => prev + 1);
                      // Only auto-start timer if NEXT set is also a work set (not transitioning from warm-up)
                      const nextSet = allSets[currentSetIndex + 1];
                      if (currentSet.phase === 'work' && nextSet?.phase === 'work') {
                        startRestTimer(150); // Auto-start 2:30 rest between work sets
                      }
                    }
                  }}
                  className="py-5 bg-green-500 hover:bg-green-600 rounded-xl font-bold text-xl shadow-lg"
                >
                  ✓ Done
                </button>
                <button
                  onClick={() => {
                    const reps = prompt('How many reps did you complete?');
                    if (reps) {
                      if (currentSet.phase === 'warm') {
                        setWarmStatus(currentSet.index, 'F');
                        setWarmActual(currentSet.index, reps);
                      } else {
                        setWorkStatus(currentSet.index, 'F');
                        setWorkActual(currentSet.index, reps);
                      }
                      if (!isLastSet) {
                        setCurrentSetIndex(prev => prev + 1);
                      }
                    }
                  }}
                  className="py-5 bg-red-500 hover:bg-red-600 rounded-xl font-bold text-xl shadow-lg"
                >
                  ✗ Failed
                </button>
              </div>

              {/* Navigation */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCurrentSetIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentSetIndex === 0}
                  className="py-2 bg-white/10 hover:bg-white/20 rounded-lg disabled:opacity-30 text-sm"
                >
                  ← Previous
                </button>
                <button
                  onClick={() => setCurrentSetIndex(prev => Math.min(allSets.length - 1, prev + 1))}
                  disabled={isLastSet}
                  className="py-2 bg-white/10 hover:bg-white/20 rounded-lg disabled:opacity-30 text-sm"
                >
                  Next →
                </button>
              </div>

              {isLastSet && isAMRAPSet && (
                <button
                  onClick={() => {
                    const reps = prompt('How many AMRAP reps did you get?');
                    if (reps) {
                      setAmrapReps(Number(reps));
                      setMobileMode(false);
                    }
                  }}
                  className="w-full py-5 bg-yellow-500 hover:bg-yellow-600 rounded-xl font-bold text-xl shadow-lg"
                >
                  Log AMRAP & Finish
                </button>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-8">
      {/* Week Advance Prompt Modal */}
      {showWeekAdvancePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl space-y-4">
            <div className="text-center space-y-2">
              <div className="text-4xl">🎉</div>
              <h3 className="text-xl font-bold text-gray-900">Week {week} Complete!</h3>
              <p className="text-sm text-gray-600">
                You've logged {liftLabel} for Week {week}. Nice work!
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4 text-center">
              <p className="text-sm font-medium text-emerald-800">
                Ready to advance {liftLabel} to Week {week === 3 ? 1 : week + 1} (Cycle {week === 3 ? cycleNumber + 1 : cycleNumber})?
              </p>
              {week === 3 && (
                <p className="mt-1 text-xs text-emerald-700">
                  Training max will increase for this lift.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowWeekAdvancePrompt(false)}
                className="px-4 py-3 rounded-xl border border-gray-200 text-gray-700 font-semibold hover:bg-gray-50"
              >
                Not Yet
              </button>
              <button
                onClick={advanceWeek}
                className="px-4 py-3 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 shadow-lg"
              >
                Yes, Advance →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plate Calculator Modal */}
      {plateCalcTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPlateCalcTarget(null)}
        >
          <div
            className="w-full max-w-2xl rounded-3xl bg-gray-900 p-1 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-[20px] bg-gray-900 p-6 space-y-4 border border-gray-800">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-bold text-white">Plate Math</h3>
                <button
                  onClick={() => setPlateCalcTarget(null)}
                  className="text-gray-400 hover:text-white px-3 py-1 rounded-lg hover:bg-gray-800"
                >
                  Close
                </button>
              </div>
              <PlateCalculatorDisplay
                targetWeight={plateCalcTarget}
                unit={unit}
                equipment={profile?.equipment ?? defaultEquipment()}
              />
            </div>
          </div>
        </div>
      )}

      {/* Prominent Week Selector Tabs */}
      <div className="rounded-2xl bg-gradient-to-r from-gray-900 to-gray-800 p-1 shadow-lg">
        <div className="grid grid-cols-3 gap-1">
          {([1, 2, 3] as Week[]).map((w) => {
            const isActive = week === w;
            // Check if this week was completed recently (in the last 3 sessions)
            // history is oldest->newest. We want to check the newest entries.
            const recentHistory = history.slice(-3); 
            // Use filter + pop instead of findLast for compatibility
            const lastDone = recentHistory.filter((h: any) => h.week === w).pop();
            const isDone = Boolean(lastDone);
            
            const weekTheme = WEEK_THEMES[w];
            const weekColors: Record<Week, string> = {
              1: "from-blue-500 to-blue-600",
              2: "from-emerald-500 to-emerald-600",
              3: "from-amber-500 to-amber-600",
            };
            return (
              <button
                key={w}
                onClick={() => handleWeekChange(w)}
                className={`relative rounded-xl px-2 py-3 text-center transition-all ${
                  isActive
                    ? `bg-gradient-to-br ${weekColors[w]} text-white shadow-lg scale-[1.02]`
                    : "bg-gray-700/50 text-gray-300 hover:bg-gray-700 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <div className="text-xs font-medium uppercase tracking-wide opacity-80">
                    Week {w}
                  </div>
                  {isDone && !isActive && (
                    <span className="text-[10px] text-emerald-400" title="Completed recently">✓</span>
                  )}
                </div>
                <div className={`text-lg font-bold ${isActive ? "" : "text-gray-100"}`}>
                  {w === 1 ? "65/75/85" : w === 2 ? "70/80/90" : "75/85/95"}
                </div>
                {isActive && (
                  <div className="mt-1 text-[10px] font-medium opacity-90 truncate">
                    {weekTheme.name}
                  </div>
                )}
                {isDone && isActive && (
                   <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-white/30" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-lg ring-1 ring-gray-100/80 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">Let's Train</h1>
            <p className="text-sm font-semibold text-gray-700">
              Cycle {cycleNumber} - Week {week} - {theme.name}
            </p>
            <p className="text-sm text-gray-600">{theme.focus}</p>
            <p className="text-xs text-gray-500">{theme.blurb}</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
            {heroBadge}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickStats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 shadow-inner"
            >
              <div className="text-[11px] uppercase tracking-wide text-gray-500">
                {stat.label}
              </div>
              <div className="mt-1 text-lg font-semibold text-gray-900">
                {stat.value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card space-y-6 bg-white/95 shadow-xl ring-1 ring-gray-100/80">
            <div className="flex flex-col gap-3 border-b border-gray-100 pb-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-[0.35em] text-brand-600">
                  Session Builder
                </span>
                <h3 className="text-2xl font-semibold text-gray-900">Let's Train - {liftLabel}</h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {tm ? (
                  <button
                    onClick={() => {
                      setCurrentSetIndex(0);
                      setMobileMode(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600 px-4 py-2 text-sm font-bold text-white shadow-lg hover:from-brand-600 hover:to-brand-700"
                  >
                    📱 Mobile Workout Mode
                  </button>
                ) : (
                  <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 text-sm text-gray-500">
                    📱 Mobile Workout Mode
                    <span className="text-xs">(Set TM first)</span>
                  </div>
                )}
                {targetUid ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                    Viewing {activeAthleteName}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
                    Personal session
                  </span>
                )}
                {isCoach && !targetUid ? (
                  <span className="inline-flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                    No athlete selected. Log your own session or pick someone from the roster to load their plan.
                  </span>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50/80 p-4 shadow-inner">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Lift</span>
                  <select
                    className="rounded-xl border-2 border-brand-300 bg-white px-3 py-3 text-base font-bold text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    value={lift}
                    onChange={(event) => {
                      setLift(event.target.value as Lift);
                      // Reset confirmation so auto-logic can run for the new lift
                      setLiftConfirmed(false);
                    }}
                  >
                    <option value="bench">Bench Press</option>
                    <option value="squat">Back Squat</option>
                    <option value="deadlift">Deadlift</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Week</span>
                  <select
                    className="rounded-xl border-2 border-brand-300 bg-white px-3 py-3 text-base font-bold text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    value={week}
                    onChange={(event) => handleWeekChange(Number(event.target.value) as Week)}
                  >
                    <option value={1}>Week 1 — 65/75/85%</option>
                    <option value={2}>Week 2 — 70/80/90%</option>
                    <option value={3}>Week 3 — 75/85/95%</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Cycle</span>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="rounded-xl border-2 border-brand-300 bg-white px-3 py-3 text-base font-bold text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
                    value={cycle}
                    onChange={(event) => handleCycleChange(Number(event.target.value))}
                  />
                </label>

                <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Units</span>
                  <div className="inline-flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm">
                    <span>{unit.toUpperCase()}</span>
                    <span className="text-xs uppercase text-gray-500">auto</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Training max</span>
                  {tm && Number.isFinite(tm) ? (
                    <div className="inline-flex items-center justify-between rounded-xl border border-brand-200 bg-white px-3 py-2 text-sm font-semibold text-brand-700 shadow-sm">
                      <span>{tm} {unit}</span>
                      <span className="text-xs uppercase text-brand-600">ready</span>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500">
                      Set training max in Calculator.
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Visual confirmation of what's being logged */}
            <div className="rounded-2xl border-2 border-brand-200 bg-gradient-to-r from-brand-50 to-brand-100 p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="session-now-label text-xs font-semibold uppercase tracking-wide text-brand-600">Now Logging</div>
                  <div className="text-xl font-bold text-brand-800">
                    {LIFT_LABELS[lift]} - Cycle {cycleNumber} - Week {week}
                  </div>
                  <div className="text-sm text-brand-600">{WEEK_THEMES[week].focus}</div>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black text-brand-700">
                    {week === 1 ? "65/75/85" : week === 2 ? "70/80/90" : "75/85/95"}%
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white/90 px-4 py-3 text-xs text-gray-600 shadow-inner">
              <span className="font-semibold text-gray-700">Set status legend:</span> S = completed all prescribed reps. F = stopped early - record the reps completed.
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-sky-900">Warm-up ramp</p>
                    <p className="text-xs text-sky-800/80">Prime the groove with smooth sets.</p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700">
                    Warm-up
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {warm.map((set, index) => (
                    <SetRow
                      key={`warm-${index}`}
                      phase="Warm-up"
                      index={index}
                      set={set}
                      unit={unit}
                      repsLabel={set.repsDisplay}
                      outcome={warmOutcomes[index]}
                      onStatusChange={(status) => setWarmStatus(index, status)}
                      onActualChange={(value) => setWarmActual(index, value)}
                      onPlateCalc={(w) => setPlateCalcTarget(w)}
                      showActualInput
                    />
                  ))}
                  {warm.length === 0 && (
                    <div className="rounded-xl border border-dashed border-sky-200 px-3 py-2 text-sm text-sky-700">
                      Add a training max to unlock warm-ups.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-brand-100 bg-brand-50 p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-brand-700">Main work</p>
                    <p className="text-xs text-brand-600">Own each top set and log how it felt.</p>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">
                    Work sets
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {work.map((set, index) => (
                    <SetRow
                      key={`work-${index}`}
                      phase="Work"
                      index={index}
                      set={set}
                      unit={unit}
                      repsLabel={set.repsDisplay}
                      outcome={workOutcomes[index]}
                      onStatusChange={(status) => setWorkStatus(index, status)}
                      onActualChange={(value) => setWorkActual(index, value)}
                      onPlateCalc={(w) => setPlateCalcTarget(w)}
                      showActualInput
                    />
                  ))}
                  {work.length === 0 && (
                    <div className="rounded-xl border border-dashed border-brand-200 px-3 py-2 text-sm text-brand-700">
                      Add a training max to populate the working weights.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4 shadow-sm">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-amber-900">
                  <span className="text-xs uppercase tracking-wide text-amber-700">Last set AMRAP reps</span>
                  <input
                    className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm font-semibold text-amber-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    type="number"
                    min={0}
                    value={amrapReps}
                    onChange={(event) => setAmrapReps(Number(event.target.value) || 0)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-amber-900">
                  <span className="text-xs uppercase tracking-wide text-amber-700">Session notes</span>
                  <input
                    className="rounded-xl border border-amber-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Form cues, RPE, reminders"
                  />
                </label>
              </div>
            </div>

            <div
              className={`rounded-2xl px-4 py-4 text-white shadow-lg ${
                est ? "bg-gradient-to-r from-emerald-500 to-emerald-600" : "bg-slate-500/90"
              }`}
            >
              <div className="text-xs uppercase tracking-wide text-white/80">Estimated 1RM</div>
              <div className="text-3xl font-bold">
                {est ? `${est} ${unit}` : "Log reps to calculate"}
              </div>
              {prFlag && (
                <div className="mt-1 text-sm font-medium text-white">
                  New PR unlocked! Record it before you forget.
                </div>
              )}
            </div>

            <button
              className="btn btn-primary w-full justify-center py-3 text-base"
              onClick={save}
              disabled={saving || !tm || amrapReps <= 0}
            >
              {saving ? "Saving..." : "Save session"}
            </button>
          </div>
        </div>

        <div className="card space-y-5 bg-white/95 shadow-xl ring-1 ring-gray-100/80">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Recent sessions</h3>
            <span className="text-xs uppercase tracking-wide text-gray-400">{liftLabel}</span>
          </div>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
            <TrendMini values={estSeries} unit={unit} />
          </div>
          <ul className="space-y-3 text-sm text-gray-700">
            {history.slice(-5).map((session, index) => {
              const weekColors: Record<number, string> = {
                1: "bg-blue-100 text-blue-700 border-blue-200",
                2: "bg-emerald-100 text-emerald-700 border-emerald-200",
                3: "bg-amber-100 text-amber-700 border-amber-200",
              };
              const cycleLabel = session.cycle ?? 1;
              return (
                <li key={index} className="rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-[11px] font-bold ${weekColors[session.week] || weekColors[1]}`}>
                        C{cycleLabel} W{session.week}
                      </span>
                      <span className="font-semibold text-gray-900">
                        {session.est1rm ? `est1RM ${session.est1rm} ${session.unit}` : "Logged"}
                      </span>
                    </div>
                    {session.pr ? (
                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        PR
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    AMRAP {session.amrap?.weight} x {session.amrap?.reps} {session.unit}
                  </div>
                </li>
              );
            })}
            {history.length === 0 && (
              <li className="rounded-2xl border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-500">
                Log your first session to see trends here.
              </li>
            )}
          </ul>
        </div>
      </div>

      <CoachTips
        week={week}
        amrapReps={amrapReps}
        unit={unit}
        tm={tm}
        est1rm={est}
        prevBest={prevBest}
        lastWeight={lastWorkWeight || 0}
        lift={lift}
      />
    </div>
  );

}

type SetRowProps = {
  phase: "Warm-up" | "Work";
  index: number;
  set: {
    pct: number;
    weight: number;
    reps: number;
  };
  unit: Unit;
  repsLabel: string;
  outcome?: SetOutcome;
  onStatusChange: (status: "" | "S" | "F") => void;
  onActualChange: (value: string) => void;
  onPlateCalc: (weight: number) => void;
  showActualInput?: boolean;
};

function SetRow({
  phase,
  index,
  set,
  unit,
  repsLabel,
  outcome,
  onStatusChange,
  onActualChange,
  onPlateCalc,
  showActualInput = false,
}: SetRowProps) {
  const status = outcome?.status ?? "";
  const weightLabel =
    set.weight && Number.isFinite(set.weight) ? `${set.weight} ${unit}` : "-";
  const percentLabel = `${Math.round(set.pct * 100)}%`;
  const accentClass =
    phase === "Work"
      ? "border-l-4 border-brand-300 bg-white shadow-sm"
      : "border-l-4 border-sky-300 bg-white shadow-sm";

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 px-4 py-3 ${accentClass}`}
    >
      <div className="min-w-[160px]">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
              phase === "Work" ? "bg-brand-50 text-brand-700" : "bg-sky-50 text-sky-700"
            }`}
          >
            {phase}
          </span>
          <span className="text-xs text-gray-500">Set {index + 1}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="text-sm font-semibold text-gray-900">{weightLabel}</div>
          {set.weight > 0 && (
            <button
              type="button"
              onClick={() => onPlateCalc(set.weight)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-[10px] text-gray-500 hover:bg-brand-100 hover:text-brand-700 transition-colors"
              title="Show plate math"
            >
              💿
            </button>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {percentLabel} | {repsLabel} reps
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStatusChange(status === "S" ? "" : "S")}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition ${
            status === "S"
              ? "border-emerald-500 bg-emerald-100 text-emerald-700 shadow-sm"
              : "border-gray-300 bg-white text-gray-400 hover:border-emerald-400 hover:text-emerald-600"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(status === "F" ? "" : "F")}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition ${
            status === "F"
              ? "border-rose-500 bg-rose-100 text-rose-700 shadow-sm"
              : "border-gray-300 bg-white text-gray-400 hover:border-rose-400 hover:text-rose-600"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showActualInput && status === "F" && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="font-semibold uppercase tracking-wide">Actual reps</span>
          <input
            className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm shadow-sm focus:border-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-100"
            type="number"
            min={0}
            step={1}
            value={outcome?.actualReps ?? ""}
            onChange={(event) => onActualChange(event.target.value)}
            placeholder="0"
          />
        </div>
      )}
    </div>
  );
}
