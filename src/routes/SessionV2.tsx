import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  updateSession,
  bestEst1RM,
  recentSessions,
  defaultEquipment,
  getStoredTeamSelection,
  type Team,
  type Profile,
  type SessionRecord,
} from "../lib/db";
import CoachTips from "../components/CoachTips";
import TrendMini from "../components/TrendMini";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { PlateCalculatorDisplay } from "../components/PlateMath";
import { useDevice } from "../lib/device";
import { useAuth } from "../lib/auth";
import { useToast } from "../context/ToastContext";

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

const trainingMaxIncrement = (lift: Lift, unit: Unit): number => {
  const isLower = lift === "squat" || lift === "deadlift";
  return unit === "kg" ? (isLower ? 5 : 2.5) : (isLower ? 10 : 5);
};

const bumpTrainingMax = (
  tm: Profile["tm"] | undefined,
  lift: Lift,
  unit: Unit
): Profile["tm"] | undefined => {
  if (!tm) return tm;
  const current = tm[lift];
  if (typeof current !== "number" || !Number.isFinite(current)) return tm;
  const increment = trainingMaxIncrement(lift, unit);
  return { ...tm, [lift]: Number((current + increment).toFixed(2)) };
};

const adjustTrainingMaxByCycles = (
  tm: Profile["tm"] | undefined,
  lift: Lift,
  unit: Unit,
  deltaCycles: number
): Profile["tm"] | undefined => {
  if (!tm || !Number.isFinite(deltaCycles) || deltaCycles === 0) return tm;
  const current = tm[lift];
  if (typeof current !== "number" || !Number.isFinite(current)) return tm;
  const increment = trainingMaxIncrement(lift, unit);
  const next = current + increment * deltaCycles;
  return { ...tm, [lift]: Number(Math.max(0, next).toFixed(2)) };
};

const WEEK_THEMES: Record<Week, { name: string; focus: string; blurb: string }> = {
  1: {
    name: "Foundation Volume",
    focus: "Set The Tone With Crisp Sets Of Five.",
    blurb: "Smooth Technique And Steady Breathing Build Momentum For The Cycle.",
  },
  2: {
    name: "Power Triples",
    focus: "Drive Explosively Through The Sticking Point.",
    blurb: "Sharpen Power Output And Keep One Rep In The Tank On Every Set.",
  },
  3: {
    name: "Peak Week",
    focus: "Prime The Nervous System And Chase A Confident AMRAP.",
    blurb: "Own Each Top Set And Push Smartly Into PR Territory.",
  },
};

const clampCycle = (value: number): number => {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(3, Math.floor(value));
};

const nextCycleAfter = (value: number): number => {
  const normalized = clampCycle(value);
  return normalized >= 3 ? 1 : normalized + 1;
};

const toLocalDayKey = (value: number): string => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const isSameLocalDay = (value: number, reference = Date.now()): boolean =>
  toLocalDayKey(value) === toLocalDayKey(reference);

const hasLiftWeekMap = (profile: Profile | null): boolean =>
  Boolean(profile?.liftWeeks && Object.keys(profile.liftWeeks).length > 0);

const hasLiftCycleMap = (profile: Profile | null): boolean =>
  Boolean(profile?.liftCycles && Object.keys(profile.liftCycles).length > 0);

const resolveLiftWeek = (profile: Profile | null, lift: Lift): Week => {
  const direct = profile?.liftWeeks?.[lift];
  if (direct === 1 || direct === 2 || direct === 3) return direct;
  if (!hasLiftWeekMap(profile)) {
    const fallback = profile?.currentWeek;
    if (fallback === 1 || fallback === 2 || fallback === 3) return fallback;
  }
  return 1;
};

const resolveLiftCycle = (profile: Profile | null, lift: Lift): number => {
  const direct = profile?.liftCycles?.[lift];
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return clampCycle(direct);
  }
  if (!hasLiftCycleMap(profile)) {
    return clampCycle(profile?.currentCycle ?? 1);
  }
  return 1;
};

export default function SessionV2() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const showToast = useToast();
  const [lift, setLift] = useState<Lift>(() => {
    const state = location.state as { lift?: Lift } | null;
    return state?.lift || "bench";
  });
  const [week, setWeek] = useState<Week>(1);
  const [cycle, setCycle] = useState<number>(1);
  const [unit, setUnit] = useState<Unit>("lb");
  const [tm, setTm] = useState<number | null>(null);
  const [sessionMode, setSessionMode] = useState<"simple" | "full">("simple");
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false);
  const [currentSetIndex, setCurrentSetIndex] = useState(0);
  const [restTimer, setRestTimer] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [liftConfirmed, setLiftConfirmed] = useState(false);
  const [showWeekAdvancePrompt, setShowWeekAdvancePrompt] = useState(false);
  const [showPrPopup, setShowPrPopup] = useState(false);
  const [allEstMaxes, setAllEstMaxes] = useState<Record<Lift, number>>({ squat: 0, bench: 0, deadlift: 0 });
  const [allPrFlags, setAllPrFlags] = useState<Record<Lift, boolean>>({ squat: false, bench: false, deadlift: false });
  const [pendingPostSave, setPendingPostSave] = useState<(() => void) | null>(null);
  const [plateCalcTarget, setPlateCalcTarget] = useState<number | null>(null);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());
  const autoAdvanceRef = useRef(false);
  const savingRef = useRef(false);

  const [step, setStep] = useState(5);
  const [amrapReps, setAmrapReps] = useState<number>(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [est, setEst] = useState<number | null>(null);
  const [prFlag, setPrFlag] = useState<boolean>(false);
  const [warmOutcomes, setWarmOutcomes] = useState<SetOutcome[]>([]);
  const [workOutcomes, setWorkOutcomes] = useState<SetOutcome[]>([]);
  const [existingTodaySession, setExistingTodaySession] = useState<SessionRecord | null>(null);
  const { activeAthlete, isCoach, loading: coachLoading, notifyProfileChange, version } = useActiveAthlete();
  const device = useDevice();
  const isMobileDevice = device.isMobile || (device.isTouch && !device.isDesktop);
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
      if (!user) {
        const local = loadProfileLocal();
        if (local) {
          setProfile(local);
          const nextUnit = (local.unit || "lb") as Unit;
          setUnit(nextUnit);
          setStep(nextUnit === "lb" ? 5 : 2.5);
          const tmForLift = local.tm?.[lift] ?? null;
          setTm(tmForLift ?? null);
          if (local.sessionMode) {
            setSessionMode(local.sessionMode);
          }
        } else {
          setProfile(null);
          setTm(null);
        }
        return;
      }
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
          const hasExplicitLiftData =
            typeof p.liftWeeks?.[lift] === "number" ||
            typeof p.liftCycles?.[lift] === "number";
          if (!liftConfirmed || hasExplicitLiftData) {
            setWeek(nextWeek);
            setCycle(nextCycle);
          }
          if (p.sessionMode) {
            setSessionMode(p.sessionMode);
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
          const hasExplicitLiftData =
            typeof p.liftWeeks?.[lift] === "number" ||
            typeof p.liftCycles?.[lift] === "number";
          if (!liftConfirmed || hasExplicitLiftData) {
            setWeek(nextWeek);
            setCycle(nextCycle);
          }
          if (p.sessionMode) {
            setSessionMode(p.sessionMode);
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
  }, [lift, targetUid, version, teamSelection, user]);

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
    setEst(roundToPlate(estimate, unit, step));
  }, [amrapReps, work, tm, lastWorkWeight]);

  useEffect(() => {
    if (coachLoading) return;
    if (!user) {
      setHistory([]);
      return;
    }
    if (isCoach && !targetUid) {
      setHistory([]);
      return;
    }
    (async () => {
      const rows = await recentSessions(lift, 12, targetUid, sessionTeam);
      const chartHistory = [...rows].reverse();
      setHistory(chartHistory);

      const hasLiftProgress =
        typeof profile?.liftWeeks?.[lift] === "number" ||
        typeof profile?.liftCycles?.[lift] === "number";
      if (!liftConfirmed && rows.length > 0 && !hasLiftProgress) {
        const lastSession = rows[0];
        const lastWeek = lastSession.week;
        const lastCycle = lastSession.cycle ?? 1;
        const nextWeek: Week = lastWeek === 1 ? 2 : lastWeek === 2 ? 3 : 1;
        const nextCycle = lastWeek === 3 ? nextCycleAfter(lastCycle) : lastCycle;
        setWeek(nextWeek);
        setCycle(clampCycle(nextCycle));
      }
    })();
  }, [lift, targetUid, isCoach, coachLoading, version, liftConfirmed, sessionTeam, profile, user]);

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

  async function save(options?: { allowUpdate?: boolean }) {
    if (savingRef.current) return;
    savingRef.current = true;

    if (!tm || work.length === 0 || amrapReps <= 0) {
      savingRef.current = false;
      showToast("Set a training max and enter AMRAP reps.", "warning");
      return;
    }
    const missingActual = [...warmOutcomes, ...workOutcomes.slice(0, workOutcomes.length - 1)].some(
      (outcome) => outcome?.status === "F" && !outcome.actualReps.trim()
    );
    if (missingActual) {
      savingRef.current = false;
      showToast("Enter the actual reps completed for any set marked as a fail.", "warning");
      return;
    }

    const warmWithResults = mergeSets(warm, warmOutcomes);
    const workWithResults = mergeSets(work, workOutcomes);

    if (options?.allowUpdate) {
      setExistingTodaySession(null);
    }

    setSaving(true);
    try {
      const recent = await recentSessions(lift, 25, targetUid, sessionTeam);
      const existingForToday = recent.find((row) => {
        if (row.source !== "remote" || !row.id) return false;
        const createdAt = typeof row.createdAt === "number" ? row.createdAt : 0;
        return createdAt > 0 && isSameLocalDay(createdAt);
      });

      if (existingForToday && !options?.allowUpdate) {
        setExistingTodaySession(existingForToday);
        savingRef.current = false;
        return;
      }

      const est1rm = roundToPlate(estimate1RM(lastWorkWeight, amrapReps), unit, step);
      const best = await bestEst1RM(lift, 20, targetUid, sessionTeam);
      const pr = est1rm > best;

      const payload = {
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
      };

      if (existingForToday?.id) {
        const ownerUid = targetUid ?? user?.uid;
        if (!ownerUid) {
          throw new Error("Unable to resolve athlete UID for session update.");
        }
        await updateSession(ownerUid, existingForToday.id, payload);
      } else {
        await saveSession(payload, targetUid, { requireRemote: !!targetUid });
      }

      setExistingTodaySession(null);

      setPrFlag(pr);
      setEst(est1rm);

      const allLifts: Lift[] = ["squat", "bench", "deadlift"];
      const otherLifts = allLifts.filter((l) => l !== lift);
      const [other1, other2] = await Promise.all(
        otherLifts.map((l) => bestEst1RM(l, 20, targetUid, sessionTeam))
      );
      const maxes: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
      maxes[lift] = est1rm;
      maxes[otherLifts[0]] = other1;
      maxes[otherLifts[1]] = other2;
      const prFlags: Record<Lift, boolean> = { squat: false, bench: false, deadlift: false };
      prFlags[lift] = pr;
      setAllEstMaxes(maxes);
      setAllPrFlags(prFlags);

      if (week === 3) {
        setPendingPostSave(() => async () => {
          autoAdvanceRef.current = true;
          const nextCyc = nextCycleAfter(cycle);
          const resetCycle = clampCycle(cycle) === 3;
          await advanceWeek();
          showToast(
            resetCycle
              ? `Week 3 complete. ${LIFT_LABELS[lift]} reset to Cycle 1. Re-test your 1RM and start Week 1.`
              : `Week 3 complete. ${LIFT_LABELS[lift]} moved to Cycle ${nextCyc}. Training max updated.`,
            "success"
          );
          navigate("/");
        });
      } else {
        const rows = await recentSessions(lift, 12, targetUid, sessionTeam);
        setHistory(rows.reverse());
        notifyProfileChange();

        if (sessionMode === "simple") {
          setPendingPostSave(() => () => navigate("/"));
        } else {
          setPendingPostSave(() => () => setShowWeekAdvancePrompt(true));
        }
      }
      setShowPrPopup(true);
    } catch (err) {
      console.warn("Failed to save session", err);
      showToast("Unable to save session right now. Please try again.", "error");
      savingRef.current = false;
    } finally {
      setSaving(false);
      autoAdvanceRef.current = false;
    }
  }

  const persistLiftProgress = async (
    nextWeek: Week,
    nextCycle: number,
    nextTm?: Profile["tm"]
  ) => {
    const clampedCycle = clampCycle(nextCycle);
    setWeek(nextWeek);
    setCycle(clampedCycle);
    setLiftConfirmed(true);
    if (!profile) return;
    const nextLiftWeeks = { ...(profile.liftWeeks ?? {}) };
    nextLiftWeeks[lift] = nextWeek;
    const nextLiftCycles = { ...(profile.liftCycles ?? {}) };
    nextLiftCycles[lift] = clampedCycle;
    const updatedProfile: Profile = {
      ...profile,
      liftWeeks: nextLiftWeeks,
      liftCycles: nextLiftCycles,
      currentWeek: nextWeek,
      currentCycle: clampedCycle,
      tm: nextTm ?? profile.tm,
    };
    await saveProfile(updatedProfile, { skipLocal: Boolean(targetUid), requireRemote: true });
    setProfile(updatedProfile);
    const nextTmValue = updatedProfile.tm?.[lift];
    setTm(typeof nextTmValue === "number" && Number.isFinite(nextTmValue) ? nextTmValue : null);
    notifyProfileChange();
  };

  const toggleSessionMode = async () => {
    const newMode = sessionMode === "simple" ? "full" : "simple";
    setSessionMode(newMode);
    setCurrentSetIndex(0);

    if (profile) {
      const updatedProfile: Profile = { ...profile, sessionMode: newMode };
      await saveProfile(updatedProfile, { skipLocal: Boolean(targetUid), requireRemote: true });
      setProfile(updatedProfile);
      notifyProfileChange();
    }
  };

  const handleWeekChange = async (newWeek: Week) => {
    await persistLiftProgress(newWeek, cycle);
  };

  const handleCycleChange = async (newCycle: number) => {
    const normalized = clampCycle(newCycle);
    const baseCycle = profile ? resolveLiftCycle(profile, lift) : clampCycle(cycle);
    const delta = normalized - baseCycle;
    const nextTm =
      delta === 0 ? profile?.tm : adjustTrainingMaxByCycles(profile?.tm, lift, unit, delta);
    await persistLiftProgress(week, normalized, nextTm);
  };

  const advanceWeek = async () => {
    const alreadyLocked = autoAdvanceRef.current;
    if (!alreadyLocked) autoAdvanceRef.current = true;
    const effectiveWeek: Week = week;
    try {
      if (effectiveWeek === 3) {
        const currentCycle = clampCycle(cycle);
        const nextCycle = nextCycleAfter(currentCycle);
        const nextTm =
          currentCycle === 3 ? profile?.tm : bumpTrainingMax(profile?.tm, lift, unit);
        await persistLiftProgress(1, nextCycle, nextTm);
      } else {
        const nextWeek: Week = effectiveWeek === 1 ? 2 : 3;
        await persistLiftProgress(nextWeek, cycle);
      }
      setShowWeekAdvancePrompt(false);
    } finally {
      if (!alreadyLocked) autoAdvanceRef.current = false;
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
    if (clampCycle(latest.cycle ?? 1) !== effectiveCycle) return false;
    setShowWeekAdvancePrompt(false);
    await advanceWeek();
    return true;
  };

  useEffect(() => {
    void maybeAutoAdvanceWeek3();
  }, [history, profile, lift, cycle, week]);

  const estSeries = history
    .map((row) =>
      typeof row.est1rm === "number"
        ? roundToPlate(
            row.est1rm,
            row.unit,
            row.unit === "lb" ? 5 : 2.5
          )
        : undefined
    )
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  const prevBest = estSeries.length ? Math.max(...estSeries) : 0;

  useEffect(() => {
    if (!timerActive || restTimer <= 0) {
      setTimerActive(false);
      return;
    }

    const interval = setInterval(() => {
      setRestTimer(prev => {
        if (prev <= 1) {
          setTimerActive(false);
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

  const existingSessionModal = existingTodaySession ? (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-v2-xl bg-v2-surface-900 border border-v2-surface-800 p-6 shadow-v2-elev-2 space-y-4">
        <div className="space-y-1">
          <h3 className="font-v2-heading uppercase tracking-[0.18em] text-xl font-bold text-v2-ink-50">Lift Already Recorded Today</h3>
          <p className="text-sm text-v2-ink-300">
            A {LIFT_LABELS[lift]} session is already saved with{" "}
            <span className="font-v2-mono tabular-nums font-semibold text-v2-ink-50">
              {existingTodaySession.amrap?.weight ?? 0} {existingTodaySession.unit} x{" "}
              {existingTodaySession.amrap?.reps ?? 0}
            </span>
            .
          </p>
          <p className="text-sm text-v2-ink-300">Do you want to update that entry?</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setExistingTodaySession(null)}
            className={`min-h-touch px-4 py-2 rounded-v2-md border border-v2-surface-800 text-v2-ink-300 font-semibold hover:bg-v2-surface-800 duration-v2-quick`}
          >
            Keep Existing
          </button>
          <button
            type="button"
            onClick={() => void save({ allowUpdate: true })}
            className={`min-h-touch px-4 py-2 rounded-v2-md bg-v2-accent-700 text-v2-ink-50 font-semibold hover:bg-v2-accent-800 duration-v2-quick`}
          >
            Update Entry
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (coachLoading) {
    return (
      <div className="bg-v2-surface-950 min-h-screen flex items-center justify-center">
        <div className="font-v2-heading uppercase tracking-[0.2em] text-v2-ink-500 animate-pulse text-sm">Loading coach tools...</div>
      </div>
    );
  }

  if (sessionMode === "simple" && tm) {
    const currentSet = allSets[currentSetIndex];
    const isLastSet = currentSetIndex === allSets.length - 1;
    const isAMRAPSet = currentSet?.phase === 'work' && currentSetIndex === allSets.length - 1;

    return (
      <>
        {existingSessionModal}
        {plateCalcTarget !== null && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setPlateCalcTarget(null)}
          >
            <div
              className="w-full max-w-2xl rounded-v2-xl bg-v2-surface-900 p-1 shadow-v2-elev-2"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-v2-lg bg-v2-surface-900 p-6 space-y-4 border border-v2-surface-800">
                <div className="flex justify-between items-center">
                  <h3 className="font-v2-heading uppercase tracking-[0.18em] text-xl font-bold text-v2-ink-50">Plate Math</h3>
                  <button
                    onClick={() => setPlateCalcTarget(null)}
                    className="text-v2-ink-500 hover:text-v2-ink-50 px-3 py-1 rounded-v2-sm hover:bg-v2-surface-800 duration-v2-quick"
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

        <div
          className={`fixed inset-0 z-50 text-v2-ink-50 flex flex-col overflow-hidden relative ${
            currentSet?.phase === 'warm'
              ? 'bg-v2-info-900'
              : 'bg-v2-surface-950'
          }`}
        >
          {currentSet?.phase === 'work' && (
            <div
              className="absolute inset-0 bg-center bg-contain bg-no-repeat opacity-10 pointer-events-none"
              style={{ backgroundImage: 'url(/assets/dragon.png)' }}
            />
          )}
        <div className="flex items-center justify-between px-4 py-3 border-b border-v2-surface-800 flex-shrink-0 relative">
          <div>
            <div className="text-[11px] font-v2-heading uppercase tracking-[0.22em] text-v2-ink-500">Cycle {cycleNumber} · Week {week}</div>
            <div className="text-lg font-v2-heading uppercase tracking-[0.08em] font-bold text-v2-ink-50">{LIFT_LABELS[lift]}</div>
          </div>
          <button
            onClick={toggleSessionMode}
            className="min-h-touch px-3 py-1.5 bg-v2-surface-900 hover:bg-v2-surface-800 border border-v2-surface-800 rounded-v2-sm font-v2-heading uppercase tracking-[0.12em] text-xs text-v2-ink-300 duration-v2-quick"
          >
            Full View
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
          <div className="px-4 py-2 text-center">
            <div className={`font-v2-heading text-2xl font-bold uppercase tracking-[0.18em] ${
              currentSet?.phase === 'warm' ? 'text-v2-info-300' : 'text-v2-accent-300'
            }`}>
              {currentSet?.phase === 'warm' ? 'Warm-Up' : 'Work Set'} {currentSetIndex + 1}/{allSets.length}
            </div>
          </div>

          {currentSet && (
            <div className="px-4 py-2 space-y-3">
              <div className="text-center space-y-3">
                <div className="flex items-end justify-center gap-2 leading-none">
                  <div className="font-v2-mono tabular-nums text-7xl font-bold text-v2-ink-50">{currentSet.weight}</div>
                  <div className="pb-2 text-2xl font-v2-heading uppercase tracking-[0.14em] text-v2-ink-300">{unit}</div>
                </div>
                {Number.isFinite(currentSet.weight) && currentSet.weight > 0 && (
                  <button
                    type="button"
                    onClick={() => setPlateCalcTarget(currentSet.weight)}
                    className="mx-auto inline-flex items-center gap-2 rounded-full bg-v2-surface-900 border border-v2-surface-800 px-3 py-1 font-v2-heading uppercase tracking-[0.14em] text-[11px] font-semibold text-v2-ink-300 hover:bg-v2-surface-800 duration-v2-quick"
                  >
                    Plate Calc
                  </button>
                )}
                <div className="text-base mt-1 text-v2-ink-300">
                  <span className="font-v2-mono tabular-nums">
                    {currentSet.phase === 'warm'
                      ? `${warmRepLabels[currentSet.index]} reps`
                      : `${workRepLabels[week][currentSet.index]} reps`
                    }
                  </span>
                  {" "}<span className="text-v2-ink-500">•</span>{" "}
                  <span className="font-v2-mono tabular-nums">{Math.round(currentSet.pct * 100)}%</span>{" "}
                  <span className="font-v2-heading uppercase tracking-[0.14em] text-xs text-v2-ink-500">TM</span>
                </div>
                {isAMRAPSet && (
                  <>
                    <div className="mt-3 mx-4 px-4 py-2 rounded-v2-md border bg-v2-danger-950/40 border-v2-danger-700">
                      <div className="font-v2-heading uppercase tracking-[0.2em] text-lg font-bold text-v2-danger-300">AMRAP Set</div>
                      <div className="text-[11px] mt-1 text-v2-ink-300">Leave 1-2 reps in reserve</div>
                    </div>
                    <div className="mt-3 mx-4 px-4 py-3 rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 space-y-2">
                      <div className="font-v2-heading text-xs uppercase tracking-[0.22em] text-v2-ink-500">Reps Completed</div>
                      <div className="flex items-center justify-center gap-4">
                        <button
                          onClick={() => setAmrapReps(prev => Math.max(0, prev - 1))}
                          className="w-12 h-12 rounded-full bg-v2-surface-800 border border-v2-surface-800 text-2xl font-bold text-v2-ink-50 active:bg-v2-surface-900 duration-v2-quick"
                        >
                          −
                        </button>
                        <div className="font-v2-mono tabular-nums text-5xl font-bold w-20 text-center text-v2-ink-50">{amrapReps}</div>
                        <button
                          onClick={() => setAmrapReps(prev => prev + 1)}
                          className="w-12 h-12 rounded-full bg-v2-surface-800 border border-v2-surface-800 text-2xl font-bold text-v2-ink-50 active:bg-v2-surface-900 duration-v2-quick"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {timerActive && (
                <div className="text-center space-y-2 py-4">
                  <div className="font-v2-heading text-xs uppercase tracking-[0.22em] text-v2-ink-500">Rest Timer</div>
                  <div className="font-v2-mono tabular-nums text-6xl font-bold text-v2-warn-300">
                    {formatTime(restTimer)}
                  </div>
                  <button
                    onClick={() => setTimerActive(false)}
                    className="px-4 py-1.5 bg-v2-surface-900 border border-v2-surface-800 hover:bg-v2-surface-800 rounded-v2-sm font-v2-heading uppercase tracking-[0.14em] text-xs text-v2-ink-300 duration-v2-quick"
                  >
                    Cancel Timer
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-4 py-4 space-y-2 bg-v2-surface-950 flex-shrink-0 border-t border-v2-surface-800 relative">
          {!timerActive && currentSet && (
            <>
              {!isAMRAPSet && (
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => startRestTimer(60)}
                    className="min-h-touch py-3 bg-v2-info-950/60 hover:bg-v2-info-900 border border-v2-info-800 text-v2-info-300 rounded-v2-md font-v2-mono tabular-nums font-semibold duration-v2-quick"
                  >
                    1:00
                  </button>
                  <button
                    onClick={() => startRestTimer(120)}
                    className="min-h-touch py-3 bg-v2-info-950/60 hover:bg-v2-info-900 border border-v2-info-800 text-v2-info-300 rounded-v2-md font-v2-mono tabular-nums font-semibold duration-v2-quick"
                  >
                    2:00
                  </button>
                  <button
                    onClick={() => startRestTimer(180)}
                    className="min-h-touch py-3 bg-v2-info-950/60 hover:bg-v2-info-900 border border-v2-info-800 text-v2-info-300 rounded-v2-md font-v2-mono tabular-nums font-semibold duration-v2-quick"
                  >
                    3:00
                  </button>
                </div>
              )}

              {!isAMRAPSet ? (
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
                        const nextSet = allSets[currentSetIndex + 1];
                        if (currentSet.phase === 'work' && nextSet?.phase === 'work') {
                          startRestTimer(150);
                        }
                      }
                    }}
                    className="min-h-touch-lg py-5 bg-v2-success-600 hover:bg-v2-success-700 text-v2-ink-50 rounded-v2-md font-v2-heading uppercase tracking-[0.14em] font-bold text-xl shadow-v2-elev-1 duration-v2-quick"
                  >
                    Done
                  </button>
                  <button
                    onClick={() => {
                      const reps = prompt('How Many Reps Did You Complete?');
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
                    className="min-h-touch-lg py-5 bg-v2-danger-600 hover:bg-v2-danger-700 text-v2-ink-50 rounded-v2-md font-v2-heading uppercase tracking-[0.14em] font-bold text-xl shadow-v2-elev-1 duration-v2-quick"
                  >
                    Failed
                  </button>
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setCurrentSetIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentSetIndex === 0}
                  className="py-1.5 bg-v2-surface-900 hover:bg-v2-surface-800 rounded-v2-sm disabled:opacity-20 font-v2-heading uppercase tracking-[0.14em] text-[11px] text-v2-ink-500 duration-v2-quick"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setCurrentSetIndex(prev => Math.min(allSets.length - 1, prev + 1))}
                  disabled={isLastSet}
                  className="py-1.5 bg-v2-surface-900 hover:bg-v2-surface-800 rounded-v2-sm disabled:opacity-20 font-v2-heading uppercase tracking-[0.14em] text-[11px] text-v2-ink-500 duration-v2-quick"
                >
                  Next →
                </button>
              </div>

              {isAMRAPSet && (
                <button
                  onClick={() => void save()}
                  disabled={saving || amrapReps <= 0}
                  className="min-h-touch-lg w-full py-3 bg-v2-accent-700 hover:bg-v2-accent-800 disabled:bg-v2-surface-800 disabled:opacity-50 text-v2-ink-50 rounded-v2-md font-v2-heading uppercase tracking-[0.14em] font-bold text-base shadow-v2-elev-1 duration-v2-quick"
                >
                  {saving ? "Saving..." : amrapReps > 0 ? "Save Session" : "Add Reps ↑"}
                </button>
              )}
            </>
          )}
        </div>
        </div>

        {showPrPopup && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-v2-xl bg-v2-surface-900 p-6 shadow-v2-elev-2 space-y-5 animate-in fade-in zoom-in duration-200 border border-v2-surface-800">
              <div className="text-center space-y-1">
                {Object.values(allPrFlags).some(Boolean) ? (
                  <h3 className="font-v2-heading text-2xl font-bold uppercase tracking-[0.2em] text-v2-warn-300">
                    New Personal Record
                  </h3>
                ) : (
                  <h3 className="font-v2-heading text-xl font-bold uppercase tracking-[0.18em] text-v2-ink-50">Session Complete</h3>
                )}
                <p className="text-sm text-v2-ink-500">Estimated Max Overview</p>
              </div>
              <div className="space-y-3">
                {(["squat", "bench", "deadlift"] as Lift[]).map((l) => {
                  const isPr = allPrFlags[l];
                  const value = allEstMaxes[l];
                  const liftColors: Record<Lift, { bg: string; border: string; text: string; accent: string }> = {
                    squat: { bg: "bg-v2-accent-950/50", border: "border-v2-accent-800", text: "text-v2-accent-300", accent: "text-v2-accent-100" },
                    bench: { bg: "bg-v2-info-950/50", border: "border-v2-info-800", text: "text-v2-info-300", accent: "text-v2-info-100" },
                    deadlift: { bg: "bg-v2-warn-950/50", border: "border-v2-warn-800", text: "text-v2-warn-300", accent: "text-v2-warn-100" },
                  };
                  const colors = liftColors[l];
                  return (
                    <div
                      key={l}
                      className={`relative rounded-v2-md border p-4 duration-v2-quick ${
                        isPr
                          ? "border-v2-warn-500 bg-v2-warn-950/60"
                          : `${colors.bg} ${colors.border}`
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className={`font-v2-heading text-[11px] font-semibold uppercase tracking-[0.22em] ${isPr ? "text-v2-warn-300" : colors.text}`}>
                            {LIFT_LABELS[l]}
                          </div>
                          <div className={`font-v2-mono tabular-nums text-3xl font-bold ${isPr ? "text-v2-warn-300" : colors.accent}`}>
                            {value > 0 ? `${value} ${unit}` : "—"}
                          </div>
                        </div>
                        {isPr && (
                          <span className="inline-flex items-center rounded-full border border-v2-warn-700 bg-v2-warn-950/60 px-2 py-0.5 font-v2-heading text-[10px] font-bold uppercase tracking-[0.2em] text-v2-warn-300">
                            PR
                          </span>
                        )}
                      </div>
                      {isPr && (
                        <div className="mt-1">
                          <span className="inline-flex items-center gap-1 rounded-full bg-v2-warn-950/60 border border-v2-warn-700 px-2.5 py-0.5 font-v2-heading text-[11px] font-bold text-v2-warn-300 uppercase tracking-[0.18em]">
                            New Personal Record
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  setShowPrPopup(false);
                  if (pendingPostSave) {
                    pendingPostSave();
                    setPendingPostSave(null);
                  }
                }}
                className="min-h-touch-lg w-full py-4 rounded-v2-md bg-v2-accent-700 hover:bg-v2-accent-800 text-v2-ink-50 font-v2-heading uppercase tracking-[0.14em] font-bold text-lg shadow-v2-elev-1 duration-v2-quick"
              >
                Back to Home
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="bg-v2-surface-950 min-h-screen">
      <div className="container py-2 space-y-3 sm:py-6 sm:space-y-8">
      {existingSessionModal}
      {showWeekAdvancePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-v2-xl bg-v2-surface-900 border border-v2-surface-800 p-6 shadow-v2-elev-2 space-y-4">
            <div className="text-center space-y-2">
              <h3 className="font-v2-heading text-xl font-bold uppercase tracking-[0.18em] text-v2-ink-50">Week {week} Complete!</h3>
              <p className="text-sm text-v2-ink-300">
                You've Logged {liftLabel} For Week {week}. Nice Work!
              </p>
            </div>
            <div className="rounded-v2-md bg-v2-success-950/60 border border-v2-success-700 p-4 text-center">
              <p className="text-sm font-medium text-v2-success-300">
                Ready To Advance {liftLabel} To Week {week === 3 ? 1 : week + 1} (Cycle {week === 3 ? nextCycleAfter(cycleNumber) : cycleNumber})?
              </p>
              {week === 3 && (
                <p className="mt-1 text-xs text-v2-success-300">
                  {cycleNumber >= 3
                    ? "Cycle resets to 1. Re-test your 1RM before starting over."
                    : "Training Max will increase for this lift."}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShowWeekAdvancePrompt(false)}
                className="min-h-touch px-4 py-3 rounded-v2-md border border-v2-surface-800 text-v2-ink-300 font-semibold hover:bg-v2-surface-800 duration-v2-quick"
              >
                Not Yet
              </button>
              <button
                onClick={advanceWeek}
                className="min-h-touch px-4 py-3 rounded-v2-md bg-v2-accent-700 text-v2-ink-50 font-semibold hover:bg-v2-accent-800 shadow-v2-elev-1 duration-v2-quick"
              >
                Yes, Advance →
              </button>
            </div>
          </div>
        </div>
      )}

      {showPrPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-v2-xl bg-v2-surface-900 p-6 shadow-v2-elev-2 space-y-5 animate-in fade-in zoom-in duration-200 border border-v2-surface-800">
            <div className="text-center space-y-1">
              {Object.values(allPrFlags).some(Boolean) ? (
                <h3 className="font-v2-heading text-2xl font-bold uppercase tracking-[0.2em] text-v2-warn-300">
                  New Personal Record
                </h3>
              ) : (
                <h3 className="font-v2-heading text-xl font-bold uppercase tracking-[0.18em] text-v2-ink-50">Session Complete</h3>
              )}
              <p className="text-sm text-v2-ink-500">Estimated Max Overview</p>
            </div>

            <div className="space-y-3">
              {(["squat", "bench", "deadlift"] as Lift[]).map((l) => {
                const isPr = allPrFlags[l];
                const value = allEstMaxes[l];
                const liftColors: Record<Lift, { bg: string; border: string; text: string; accent: string }> = {
                  squat: { bg: "bg-v2-accent-950/50", border: "border-v2-accent-800", text: "text-v2-accent-300", accent: "text-v2-accent-100" },
                  bench: { bg: "bg-v2-info-950/50", border: "border-v2-info-800", text: "text-v2-info-300", accent: "text-v2-info-100" },
                  deadlift: { bg: "bg-v2-warn-950/50", border: "border-v2-warn-800", text: "text-v2-warn-300", accent: "text-v2-warn-100" },
                };
                const colors = liftColors[l];
                return (
                  <div
                    key={l}
                    className={`relative rounded-v2-md border p-4 duration-v2-quick ${
                      isPr
                        ? "border-v2-warn-500 bg-v2-warn-950/60"
                        : `${colors.bg} ${colors.border}`
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`font-v2-heading text-[11px] font-semibold uppercase tracking-[0.22em] ${isPr ? "text-v2-warn-300" : colors.text}`}>
                          {LIFT_LABELS[l]}
                        </div>
                        <div className={`font-v2-mono tabular-nums text-3xl font-bold ${isPr ? "text-v2-warn-300" : colors.accent}`}>
                          {value > 0 ? `${value} ${unit}` : "—"}
                        </div>
                      </div>
                      {isPr && (
                        <span className="inline-flex items-center rounded-full border border-v2-warn-700 bg-v2-warn-950/60 px-2 py-0.5 font-v2-heading text-[10px] font-bold uppercase tracking-[0.2em] text-v2-warn-300">
                          PR
                        </span>
                      )}
                    </div>
                    {isPr && (
                      <div className="mt-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-v2-warn-950/60 border border-v2-warn-700 px-2.5 py-0.5 font-v2-heading text-[11px] font-bold text-v2-warn-300 uppercase tracking-[0.18em]">
                          New Personal Record
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => {
                setShowPrPopup(false);
                if (pendingPostSave) {
                  pendingPostSave();
                  setPendingPostSave(null);
                }
              }}
              className="min-h-touch-lg w-full py-4 rounded-v2-md bg-v2-accent-700 hover:bg-v2-accent-800 text-v2-ink-50 font-v2-heading uppercase tracking-[0.14em] font-bold text-lg shadow-v2-elev-1 duration-v2-quick"
            >
              Back to Home
            </button>
          </div>
        </div>
      )}

      {plateCalcTarget !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={() => setPlateCalcTarget(null)}
        >
          <div
            className="w-full max-w-2xl rounded-v2-xl bg-v2-surface-900 p-1 shadow-v2-elev-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-v2-lg bg-v2-surface-900 p-6 space-y-4 border border-v2-surface-800">
              <div className="flex justify-between items-center">
                <h3 className="font-v2-heading text-xl font-bold uppercase tracking-[0.18em] text-v2-ink-50">Plate Math</h3>
                <button
                  onClick={() => setPlateCalcTarget(null)}
                  className="text-v2-ink-500 hover:text-v2-ink-50 px-3 py-1 rounded-v2-sm hover:bg-v2-surface-800 duration-v2-quick"
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

      <div className="rounded-v2-lg bg-v2-surface-900 border border-v2-surface-800 p-1 shadow-v2-elev-1">
        <div className="grid grid-cols-3 gap-1">
          {([1, 2, 3] as Week[]).map((w) => {
            const isActive = week === w;
            const recentHistory = history.slice(-3);
            const lastDone = recentHistory.filter((h: any) => h.week === w).pop();
            const isDone = Boolean(lastDone);

            const weekTheme = WEEK_THEMES[w];
            const weekColors: Record<Week, string> = {
              1: "from-v2-info-600 to-v2-info-700",
              2: "from-v2-success-600 to-v2-success-700",
              3: "from-v2-warn-600 to-v2-warn-700",
            };
            return (
              <button
                key={w}
                onClick={() => handleWeekChange(w)}
                className={`relative rounded-v2-md px-2 py-2 sm:py-3 text-center duration-v2-quick ${
                  isActive
                    ? `bg-gradient-to-br ${weekColors[w]} text-v2-ink-50 shadow-v2-elev-1 scale-[1.02]`
                    : "bg-v2-surface-950 text-v2-ink-300 hover:bg-v2-surface-800 hover:text-v2-ink-50"
                }`}
              >
                <div className="flex items-center justify-center gap-1">
                  <div className="font-v2-heading text-[10px] font-medium uppercase tracking-[0.22em] opacity-85">
                    Week {w}
                  </div>
                  {isDone && !isActive && (
                    <span className="text-[10px] text-v2-success-300" title="Completed Recently">✓</span>
                  )}
                </div>
                <div className={`font-v2-mono tabular-nums text-lg font-bold ${isActive ? "" : "text-v2-ink-50"}`}>
                  {w === 1 ? "65/75/85" : w === 2 ? "70/80/90" : "75/85/95"}
                </div>
                {isActive && (
                  <div className="mt-1 font-v2-heading text-[10px] font-medium uppercase tracking-[0.16em] opacity-90 truncate">
                    {weekTheme.name}
                  </div>
                )}
                {isDone && isActive && (
                   <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-white/40" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`rounded-v2-xl border border-v2-surface-800 bg-v2-surface-900 p-6 shadow-v2-elev-2 space-y-4 ${isMobileDevice ? 'hidden' : ''}`}>
        <>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="space-y-1">
                <h1 className="font-v2-heading text-2xl font-bold uppercase tracking-[0.14em] text-v2-ink-50">Let's Train</h1>
                <p className="text-sm font-semibold text-v2-ink-300">
                  Cycle {cycleNumber} - Week {week} - {theme.name}
                </p>
                <p className="text-sm text-v2-ink-300">{theme.focus}</p>
                <p className="text-xs text-v2-ink-500">{theme.blurb}</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full bg-v2-accent-950/50 border border-v2-accent-800 px-3 py-1 font-v2-heading text-[11px] font-semibold uppercase tracking-[0.22em] text-v2-accent-300">
                {heroBadge}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {quickStats.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 px-4 py-3"
                >
                  <div className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">
                    {stat.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-v2-ink-50">
                    {stat.value}
                  </div>
                </div>
              ))}
            </div>
          </>
      </div>

      <div className="grid gap-3 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-3 sm:space-y-6 lg:col-span-2">
          <div className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-2 space-y-1.5 shadow-v2-elev-2 sm:p-6 sm:space-y-6">
            <div className="flex flex-col gap-2 border-b border-v2-surface-800 pb-2 sm:gap-3 sm:pb-4">
              <div className="flex items-center justify-between gap-2 sm:hidden">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-v2-heading text-lg font-bold uppercase tracking-[0.1em] text-v2-ink-50">{liftLabel}</h2>
                    <span className="bg-v2-surface-800 text-v2-ink-300 px-2 py-0.5 rounded-full font-v2-mono tabular-nums text-xs font-medium">C{cycleNumber} W{week}</span>
                    <span className="font-v2-mono tabular-nums text-xs text-v2-ink-500">TM:{tm ?? '—'}</span>
                    <span className="font-v2-mono tabular-nums text-xs text-v2-ink-500">Best:{prevBest > 0 ? prevBest : '—'}</span>
                  </div>
                  <div className="inline-flex items-center rounded-full bg-v2-surface-800 p-0.5">
                    <button
                      onClick={() => sessionMode !== "simple" && toggleSessionMode()}
                      className={`p-1.5 rounded-full duration-v2-quick ${
                        sessionMode === "simple" ? "bg-v2-accent-700 text-v2-ink-50 shadow-v2-elev-1" : "text-v2-ink-500"
                      }`}
                      title="Simple"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                        <line x1="12" y1="18" x2="12" y2="18"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => sessionMode !== "full" && toggleSessionMode()}
                      className={`p-1.5 rounded-full duration-v2-quick ${
                        sessionMode === "full" ? "bg-v2-accent-700 text-v2-ink-50 shadow-v2-elev-1" : "text-v2-ink-500"
                      }`}
                      title="Full"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                        <line x1="2" y1="20" x2="22" y2="20"/>
                      </svg>
                    </button>
                  </div>
                </div>
              <div className="hidden sm:block">
                  <div className="space-y-1">
                    <span className="font-v2-heading text-xs font-semibold uppercase tracking-[0.35em] text-v2-accent-300">
                      Session Builder
                    </span>
                    <h3 className="font-v2-heading text-2xl font-bold uppercase tracking-[0.1em] text-v2-ink-50">Let's Train - {liftLabel}</h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center rounded-full bg-v2-surface-800 p-1" title="Simple = step-by-step, Full = all details">
                      <button
                        onClick={() => sessionMode !== "simple" && toggleSessionMode()}
                        className={`p-2 rounded-full duration-v2-quick ${
                          sessionMode === "simple"
                            ? "bg-v2-accent-700 text-v2-ink-50 shadow-v2-elev-1"
                            : "text-v2-ink-500 hover:text-v2-ink-50"
                        }`}
                        title="Simple Mode (Step-by-step)"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                          <line x1="12" y1="18" x2="12" y2="18"/>
                    </svg>
                  </button>
                  <button
                    onClick={() => sessionMode !== "full" && toggleSessionMode()}
                    className={`p-2 rounded-full duration-v2-quick ${
                      sessionMode === "full"
                        ? "bg-v2-accent-700 text-v2-ink-50 shadow-v2-elev-1"
                        : "text-v2-ink-500 hover:text-v2-ink-50"
                    }`}
                    title="Full Mode (All details)"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                      <line x1="2" y1="20" x2="22" y2="20"/>
                    </svg>
                  </button>
                </div>
                {targetUid ? (
                  <span className="inline-flex items-center gap-2 rounded-full bg-v2-accent-950/50 border border-v2-accent-800 px-3 py-1 font-v2-heading text-[11px] font-semibold uppercase tracking-[0.18em] text-v2-accent-300">
                    Viewing {activeAthleteName}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2 rounded-full bg-v2-accent-950/50 border border-v2-accent-800 px-3 py-1 font-v2-heading text-[11px] font-semibold uppercase tracking-[0.18em] text-v2-accent-300">
                    Personal Session
                  </span>
                )}
                {isCoach && !targetUid ? (
                  <span className="inline-flex items-start gap-2 rounded-v2-md bg-v2-warn-950/40 border border-v2-warn-800 px-3 py-2 text-xs font-medium text-v2-warn-300">
                    No Athlete Selected. Log Your Own Session Or Pick Someone From The Roster To Load Their Plan.
                  </span>
                ) : null}
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-v2-surface-800 bg-v2-surface-950 text-v2-ink-500 shadow-v2-elev-1 duration-v2-quick hover:border-v2-accent-600 hover:text-v2-accent-300"
                  onClick={() => setSessionSettingsOpen((prev) => !prev)}
                  aria-expanded={sessionSettingsOpen}
                  aria-label="Session settings"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9.5 1.75h5l.73 2.2a7.5 7.5 0 012 .84l2.19-.79 2.5 4.33-1.85 1.33a7.6 7.6 0 010 2.68l1.85 1.33-2.5 4.33-2.19-.79a7.5 7.5 0 01-2 .84l-.73 2.2h-5l-.73-2.2a7.5 7.5 0 01-2-.84l-2.19.79-2.5-4.33 1.85-1.33a7.6 7.6 0 010-2.68l-1.85-1.33 2.5-4.33 2.19.79a7.5 7.5 0 012-.84l.73-2.2Z"
                    />
                    <circle cx="12" cy="12" r="3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                  </div>
                </div>
            </div>

            {sessionSettingsOpen && (
              <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 px-4 py-3 text-xs text-v2-ink-300">
                <div className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Units</div>
                <div className="mt-1 flex items-center justify-between text-sm font-semibold text-v2-ink-50">
                  <span className="font-v2-mono tabular-nums">{unit.toUpperCase()}</span>
                  <span className="font-v2-heading text-xs uppercase tracking-[0.22em] text-v2-ink-500">auto</span>
                </div>
              </div>
            )}

            <div className={`rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 ${isMobileDevice ? 'p-3' : 'p-4'}`}>
              <div className={`grid ${isMobileDevice ? 'gap-2' : 'gap-4'}`}>
                <label className="flex flex-col gap-1 text-sm font-medium text-v2-ink-300">
                  <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Lift</span>
                  <select
                    className={`rounded-v2-md border border-v2-accent-800 bg-v2-surface-900 px-3 ${isMobileDevice ? 'py-2' : 'py-3'} text-base font-bold text-v2-ink-50 shadow-v2-elev-1 focus:border-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/40 duration-v2-quick`}
                    value={lift}
                    onChange={(event) => {
                      setLift(event.target.value as Lift);
                      setLiftConfirmed(false);
                    }}
                  >
                    <option value="bench">Bench Press</option>
                    <option value="squat">Back Squat</option>
                    <option value="deadlift">Deadlift</option>
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-4">
                  <label className="flex flex-col gap-1 text-sm font-medium text-v2-ink-300">
                    <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Cycle</span>
                    <select
                      className={`rounded-v2-md border border-v2-accent-800 bg-v2-surface-900 px-3 ${isMobileDevice ? 'py-2' : 'py-3'} text-base font-bold text-v2-ink-50 shadow-v2-elev-1 focus:border-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/40 duration-v2-quick`}
                      value={cycle}
                      onChange={(event) => handleCycleChange(Number(event.target.value))}
                    >
                      <option value={1}>Cycle 1</option>
                      <option value={2}>Cycle 2</option>
                      <option value={3}>Cycle 3</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-sm font-medium text-v2-ink-300">
                    <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Week</span>
                    <select
                      className={`rounded-v2-md border border-v2-accent-800 bg-v2-surface-900 px-3 ${isMobileDevice ? 'py-2' : 'py-3'} text-base font-bold text-v2-ink-50 shadow-v2-elev-1 focus:border-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/40 duration-v2-quick`}
                      value={week}
                      onChange={(event) => handleWeekChange(Number(event.target.value) as Week)}
                    >
                      <option value={1}>Week 1 - 65/75/85%</option>
                      <option value={2}>Week 2 - 70/80/90%</option>
                      <option value={3}>Week 3 - 75/85/95%</option>
                    </select>
                  </label>
                </div>

                <div className="flex flex-col gap-1 text-sm font-medium text-v2-ink-300">
                  <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Training Max</span>
                  {tm && Number.isFinite(tm) ? (
                    <div className="inline-flex items-center justify-between rounded-v2-md border border-v2-accent-800 bg-v2-surface-900 px-3 py-2 text-sm font-semibold text-v2-accent-300 shadow-v2-elev-1">
                      <span className="font-v2-mono tabular-nums">{tm} {unit}</span>
                      <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-accent-300">ready</span>
                    </div>
                  ) : (
                    <div className="rounded-v2-md border border-dashed border-v2-surface-800 px-3 py-2 text-sm text-v2-ink-500">
                      Set Training Max In Calculator.
                    </div>
                  )}
                </div>
              </div>
            </div>
            {!isMobileDevice && (
              <div className="rounded-v2-md border border-v2-accent-800 bg-gradient-to-br from-v2-accent-950/60 via-v2-surface-950 to-v2-surface-950 p-4 shadow-v2-elev-1">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-v2-heading text-[11px] font-semibold uppercase tracking-[0.22em] text-v2-info-300">Now Logging</div>
                    <div className="font-v2-heading text-xl font-bold uppercase tracking-[0.08em] text-v2-ink-50">
                      {LIFT_LABELS[lift]} - Cycle {cycleNumber} - Week {week}
                    </div>
                    <div className="text-sm text-v2-ink-300">{WEEK_THEMES[week].focus}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-v2-mono tabular-nums text-3xl font-bold text-v2-ink-50">
                      {week === 1 ? "65/75/85" : week === 2 ? "70/80/90" : "75/85/95"}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!isMobileDevice && (
              <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 px-4 py-3 text-xs text-v2-ink-300">
                <span className="font-v2-heading font-semibold uppercase tracking-[0.18em] text-v2-ink-50">Set Status Legend:</span> S = Completed All Prescribed Reps. F = Stopped Early - Record The Reps Completed.
              </div>
            )}

            <div className="space-y-1.5 sm:space-y-4">
              <div className="rounded-v2-md border border-v2-info-800 bg-v2-info-950/40 p-2 sm:p-4 shadow-v2-elev-1">
                <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="font-v2-heading text-sm font-semibold uppercase tracking-[0.14em] text-v2-info-300">Warm-Up Ramp</p>
                      <p className="text-xs text-v2-info-300/80">Prime The Groove With Smooth Sets.</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-v2-surface-900 border border-v2-info-800 px-2 py-0.5 font-v2-heading text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-info-300">
                      Warm-Up
                    </span>
                  </div>
                <div className="flex items-center gap-1.5 mb-1 sm:hidden">
                    <div className="font-v2-heading text-[11px] font-semibold text-v2-info-300 uppercase tracking-[0.22em]">Warm-Up</div>
                    <span className="font-v2-mono tabular-nums text-[10px] font-semibold text-v2-info-300 bg-v2-surface-900 border border-v2-info-800 rounded-full px-1.5 py-0.5">1–{warm.length}</span>
                  </div>
                <div className="space-y-1 sm:space-y-2">
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
                      compact={isMobileDevice}
                    />
                  ))}
                  {warm.length === 0 && (
                    <div className="rounded-v2-sm border border-dashed border-v2-info-800 px-3 py-2 text-sm text-v2-info-300">
                      Add A Training Max To Unlock Warm-Ups.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-v2-md border border-v2-accent-800 bg-v2-accent-950/50 p-2 sm:p-4 shadow-v2-elev-1">
                <div className="hidden sm:flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div>
                      <p className="font-v2-heading text-sm font-semibold uppercase tracking-[0.14em] text-v2-accent-300">Main Work</p>
                      <p className="text-xs text-v2-accent-300/80">Own Each Top Set And Log How It Felt.</p>
                    </div>
                    <span className="inline-flex items-center rounded-full bg-v2-surface-900 border border-v2-accent-800 px-2 py-0.5 font-v2-heading text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-accent-300">
                      Work Sets
                    </span>
                  </div>
                <div className="flex items-center gap-1.5 mb-1 sm:hidden">
                    <div className="font-v2-heading text-[11px] font-semibold text-v2-accent-300 uppercase tracking-[0.22em]">Work Sets</div>
                    <span className="font-v2-mono tabular-nums text-[10px] font-semibold text-v2-accent-300 bg-v2-surface-900 border border-v2-accent-800 rounded-full px-1.5 py-0.5">{warm.length + 1}–{warm.length + work.length}</span>
                  </div>
                <div className="space-y-1 sm:space-y-2">
                  {work.map((set, index) => {
                    const isAMRAPRow = index === work.length - 1;
                    if (isAMRAPRow) {
                      return (
                        <Fragment key={`work-${index}`}>
                          <div className="flex items-center justify-between gap-2 rounded-v2-sm border border-v2-warn-800 bg-v2-warn-950/40 px-2 py-1.5 sm:hidden">
                          <button
                            type="button"
                            onClick={() => setPlateCalcTarget(set.weight)}
                            className="font-v2-mono tabular-nums text-xs font-semibold text-v2-warn-300 hover:text-v2-warn-100 duration-v2-quick"
                          >
                            {set.weight} {unit}
                          </button>
                          <span className="font-v2-heading text-[11px] font-semibold text-v2-warn-300 uppercase tracking-[0.22em]">AMRAP ↓</span>
                        </div>
                          <div className="hidden sm:flex items-center justify-between gap-3 rounded-v2-sm border border-v2-warn-800 bg-v2-warn-950/40 px-4 py-3">
                          <div className="flex items-center gap-4">
                            <span className="font-v2-mono tabular-nums text-sm font-bold text-v2-warn-300 w-6">{index + warm.length + 1}</span>
                            <button
                              type="button"
                              onClick={() => setPlateCalcTarget(set.weight)}
                              className="font-v2-mono tabular-nums text-base font-bold text-v2-warn-300 hover:text-v2-warn-100 duration-v2-quick"
                            >
                              {set.weight} <span className="font-v2-heading font-normal text-v2-warn-300/80 uppercase text-sm tracking-[0.14em]">{unit}</span>
                            </button>
                            <span className="font-v2-mono tabular-nums text-sm font-medium text-v2-warn-300">× {set.repsDisplay}</span>
                          </div>
                          <span className="font-v2-heading text-xs font-semibold text-v2-warn-300 uppercase tracking-[0.22em]">AMRAP — Enter Reps Below</span>
                        </div>
                        </Fragment>
                      );
                    }
                    return (
                      <SetRow
                        key={`work-${index}`}
                        phase="Work"
                        index={index + warm.length}
                        set={set}
                        unit={unit}
                        repsLabel={set.repsDisplay}
                        outcome={workOutcomes[index]}
                        onStatusChange={(status) => setWorkStatus(index, status)}
                        onActualChange={(value) => setWorkActual(index, value)}
                        onPlateCalc={(w) => setPlateCalcTarget(w)}
                        showActualInput
                        compact={isMobileDevice}
                      />
                    );
                  })}
                  {work.length === 0 && (
                    <div className="rounded-v2-sm border border-dashed border-v2-accent-800 px-3 py-2 text-sm text-v2-accent-300">
                      Add A Training Max To Populate The Working Weights.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-v2-md border border-v2-warn-700 bg-v2-warn-950/60 p-2 shadow-v2-elev-2 space-y-1.5 sticky bottom-0 z-30 sm:hidden">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="font-v2-heading text-[10px] font-semibold text-v2-warn-300 uppercase tracking-[0.18em] whitespace-nowrap">
                    AMRAP<br/><span className="font-v2-mono tabular-nums">{work.length > 0 ? Math.round((work[work.length - 1]?.pct ?? 0) * 100) : 0}%</span> TM
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAmrapReps(prev => Math.max(0, prev - 1))}
                      className="w-7 h-7 rounded-full bg-v2-surface-900 border border-v2-warn-700 text-base font-bold text-v2-warn-300 shadow-v2-elev-1 active:scale-95 flex items-center justify-center duration-v2-quick"
                    >
                      −
                    </button>
                    <div className="font-v2-mono tabular-nums text-xl font-bold text-v2-warn-300 w-8 text-center">{amrapReps}</div>
                    <button
                      onClick={() => setAmrapReps(prev => prev + 1)}
                      className="w-7 h-7 rounded-full bg-v2-surface-900 border border-v2-warn-700 text-base font-bold text-v2-warn-300 shadow-v2-elev-1 active:scale-95 flex items-center justify-center duration-v2-quick"
                    >
                      +
                    </button>
                  </div>
                  {amrapReps > 0 && est ? (
                    <div className="rounded-v2-sm px-2 py-1 bg-v2-success-600 text-v2-ink-50 text-center">
                      <div className="font-v2-heading text-[9px] uppercase tracking-[0.22em] opacity-85">Est 1RM</div>
                      <div className="font-v2-mono tabular-nums text-xs font-bold leading-tight">
                        {est} {unit}
                        {prFlag && (
                          <svg className="inline ml-1 w-3 h-3 text-v2-warn-300" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.719c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
                          </svg>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="w-12" />
                  )}
                </div>
                <button
                  className="min-h-touch w-full py-2 rounded-v2-md bg-v2-accent-700 hover:bg-v2-accent-800 disabled:bg-v2-surface-800 disabled:opacity-50 text-v2-ink-50 font-v2-heading uppercase tracking-[0.14em] font-bold text-sm shadow-v2-elev-1 active:scale-[0.98] duration-v2-quick"
                  onClick={() => void save()}
                  disabled={saving || !tm || amrapReps <= 0}
                >
                  {saving ? "Saving..." : amrapReps > 0 ? "Save Session" : "Enter Reps Above"}
                </button>
              </div>
            <div className="hidden sm:block space-y-4">
                <div className="rounded-v2-md border border-v2-warn-800 bg-v2-warn-950/40 p-4 shadow-v2-elev-1">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm font-medium text-v2-warn-300">
                      <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-warn-300/80">Last Set AMRAP Reps</span>
                      <input
                        className="rounded-v2-md border border-v2-warn-800 bg-v2-surface-900 px-3 py-2 font-v2-mono tabular-nums text-sm font-semibold text-v2-warn-300 shadow-v2-elev-1 focus:border-v2-warn-600 focus:outline-none focus:ring-2 focus:ring-v2-warn-700/40 duration-v2-quick"
                        type="number"
                        min={0}
                        value={amrapReps}
                        onChange={(event) => setAmrapReps(Number(event.target.value) || 0)}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-v2-warn-300">
                      <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-warn-300/80">Session Notes</span>
                      <input
                        className="rounded-v2-md border border-v2-warn-800 bg-v2-surface-900 px-3 py-2 text-sm text-v2-ink-50 shadow-v2-elev-1 focus:border-v2-warn-600 focus:outline-none focus:ring-2 focus:ring-v2-warn-700/40 duration-v2-quick"
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Form Cues, RPE, Reminders"
                      />
                    </label>
                  </div>
                </div>

                <div
                  className={`rounded-v2-md px-4 py-4 text-v2-ink-50 shadow-v2-elev-1 border ${
                    est ? "bg-v2-success-600 border-v2-success-700" : "bg-v2-surface-900 border-v2-surface-800"
                  }`}
                >
                  <div className="font-v2-heading text-xs uppercase tracking-[0.22em] text-v2-ink-50/85">Estimated 1RM</div>
                  <div className="font-v2-mono tabular-nums text-3xl font-bold">
                    {est ? `${est} ${unit}` : "Log Reps To Calculate"}
                  </div>
                  {prFlag && (
                    <div className="mt-1 font-v2-heading text-sm font-medium uppercase tracking-[0.14em] text-v2-ink-50">
                      New PR Unlocked! Record It Before You Forget.
                    </div>
                  )}
                </div>

                <button
                  className="min-h-touch-lg w-full py-3 text-base rounded-v2-md bg-v2-accent-700 hover:bg-v2-accent-800 disabled:bg-v2-surface-800 disabled:opacity-50 text-v2-ink-50 font-v2-heading uppercase tracking-[0.14em] font-bold shadow-v2-elev-1 duration-v2-quick"
                  onClick={() => void save()}
                  disabled={saving || !tm || amrapReps <= 0}
                >
                  {saving ? "Saving..." : "Save Session"}
                </button>
              </div>
          </div>
        </div>

        {!isMobileDevice && (
          <div className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-6 space-y-5 shadow-v2-elev-2">
            <div className="flex items-center justify-between">
              <h3 className="font-v2-heading text-lg font-bold uppercase tracking-[0.14em] text-v2-ink-50">Recent Sessions</h3>
              <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">{liftLabel}</span>
            </div>
            <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 p-3">
              <TrendMini values={estSeries} unit={unit} />
            </div>
            <ul className="space-y-3 text-sm text-v2-ink-300">
              {history.slice(-5).map((session, index) => {
                const weekColors: Record<number, string> = {
                  1: "bg-v2-info-950/60 text-v2-info-300 border-v2-info-800",
                  2: "bg-v2-success-950/60 text-v2-success-300 border-v2-success-800",
                  3: "bg-v2-warn-950/60 text-v2-warn-300 border-v2-warn-800",
                };
                const cycleLabel = session.cycle ?? 1;
                const isRemax = session.type === "remax";
                return (
                  <li key={index} className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-950 px-3 py-2 shadow-v2-elev-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        {isRemax ? (
                          <span className="inline-flex items-center rounded-v2-sm border border-v2-accent-800 bg-v2-accent-950/60 px-2 py-0.5 font-v2-heading text-[11px] font-bold uppercase tracking-[0.18em] text-v2-accent-300">
                            Remax
                          </span>
                        ) : (
                          <span className={`inline-flex items-center rounded-v2-sm border px-2 py-0.5 font-v2-mono tabular-nums text-[11px] font-bold ${weekColors[session.week] || weekColors[1]}`}>
                            C{cycleLabel} W{session.week}
                          </span>
                        )}
                        <span className="font-v2-mono tabular-nums font-semibold text-v2-ink-50">
                          {isRemax
                            ? `TM: ${session.tm ?? 0} ${session.unit} / Est 1RM: ${roundToPlate(
                                session.est1rm,
                                session.unit,
                                session.unit === "lb" ? 5 : 2.5
                              )} ${session.unit}`
                            : session.est1rm
                              ? `est1RM ${roundToPlate(
                                  session.est1rm,
                                  session.unit,
                                  session.unit === "lb" ? 5 : 2.5
                                )} ${session.unit}`
                              : "Logged"}
                        </span>
                      </div>
                      {session.pr ? (
                        <span className="inline-flex items-center rounded-full bg-v2-success-950/60 border border-v2-success-700 px-2 py-0.5 font-v2-heading text-[10px] font-semibold uppercase tracking-[0.22em] text-v2-success-300">
                          PR
                        </span>
                      ) : null}
                    </div>
                    {isRemax ? (
                      <div className="font-v2-mono tabular-nums text-xs text-v2-ink-500 mt-1">
                        {(session.amrap?.weight ?? 0) > 0
                          ? `${session.amrap?.weight} ${session.unit} × ${session.amrap?.reps}`
                          : `Est 1RM: ${roundToPlate(session.est1rm, session.unit, session.unit === "lb" ? 5 : 2.5)} ${session.unit}`}
                      </div>
                    ) : (
                      <div className="font-v2-mono tabular-nums text-xs text-v2-ink-500 mt-1">
                        AMRAP {session.amrap?.weight} x {session.amrap?.reps} {session.unit}
                      </div>
                    )}
                  </li>
                );
              })}
              {history.length === 0 && (
                <li className="rounded-v2-md border border-dashed border-v2-surface-800 px-3 py-3 text-sm text-v2-ink-500">
                  Log Your First Session To See Trends Here.
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {!isMobileDevice && (
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
      )}
      </div>
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
  compact?: boolean;
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
  compact = false,
}: SetRowProps) {
  const status = outcome?.status ?? "";
  const weightLabel =
    set.weight && Number.isFinite(set.weight) ? `${set.weight}` : "-";
  const percentLabel = `${Math.round(set.pct * 100)}%`;

  if (compact) {
    const bgColor = phase === "Work" ? "bg-v2-accent-950/40" : "bg-v2-info-950/40";
    const borderColor = phase === "Work" ? "border-v2-accent-800" : "border-v2-info-800";
    const textColor = phase === "Work" ? "text-v2-accent-300" : "text-v2-info-300";
    return (
      <div className={`flex items-center justify-between gap-2 rounded-v2-sm border ${borderColor} ${bgColor} px-2 py-1`}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPlateCalc(set.weight)}
            className={`font-v2-mono tabular-nums text-xs font-bold ${textColor} hover:opacity-70 whitespace-nowrap duration-v2-quick`}
          >
            {weightLabel} {unit}
          </button>
          <span className={`font-v2-mono tabular-nums text-xs font-medium ${phase === "Work" ? "text-v2-accent-300/80" : "text-v2-info-300/80"}`}>× {repsLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onStatusChange(status === "S" ? "" : "S")}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border font-semibold duration-v2-quick ${
              status === "S"
                ? "border-v2-success-600 bg-v2-success-600 text-v2-ink-50"
                : "border-v2-surface-800 bg-v2-surface-900 text-v2-ink-500"
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => onStatusChange(status === "F" ? "" : "F")}
            className={`inline-flex h-6 w-6 items-center justify-center rounded-full border font-semibold duration-v2-quick ${
              status === "F"
                ? "border-v2-danger-600 bg-v2-danger-600 text-v2-ink-50"
                : "border-v2-surface-800 bg-v2-surface-900 text-v2-ink-500"
            }`}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {showActualInput && status === "F" && (
          <input
            className="w-14 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-2 py-1 font-v2-mono tabular-nums text-sm text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/40 duration-v2-quick"
            type="number"
            min={0}
            value={outcome?.actualReps ?? ""}
            onChange={(event) => onActualChange(event.target.value)}
            placeholder="#"
          />
        )}
      </div>
    );
  }

  const accentClass =
    phase === "Work"
      ? "border-l-4 border-v2-accent-600 bg-v2-surface-900 shadow-v2-elev-1"
      : "border-l-4 border-v2-info-600 bg-v2-surface-900 shadow-v2-elev-1";

  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-v2-md border border-v2-surface-800 px-4 py-3 ${accentClass}`}
    >
      <div className="min-w-[160px]">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-v2-heading text-[10px] font-semibold uppercase tracking-[0.22em] ${
              phase === "Work" ? "bg-v2-accent-950/60 text-v2-accent-300 border border-v2-accent-800" : "bg-v2-info-950/60 text-v2-info-300 border border-v2-info-800"
            }`}
          >
            {phase}
          </span>
          <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">Set {index + 1}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <div className="font-v2-mono tabular-nums text-sm font-semibold text-v2-ink-50">{weightLabel}</div>
          {set.weight > 0 && (
            <button
              type="button"
              onClick={() => onPlateCalc(set.weight)}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-v2-surface-800 text-v2-ink-500 hover:bg-v2-accent-950/60 hover:text-v2-accent-300 duration-v2-quick"
              title="Show Plate Math"
              aria-label="Show Plate Math"
            >
              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <ellipse cx="10" cy="5" rx="6" ry="2" />
                <path d="M4 5v4c0 1.1 2.69 2 6 2s6-.9 6-2V5" />
                <path d="M4 9v4c0 1.1 2.69 2 6 2s6-.9 6-2V9" />
                <path d="M4 13v2c0 1.1 2.69 2 6 2s6-.9 6-2v-2" />
              </svg>
            </button>
          )}
        </div>
        <div className="font-v2-mono tabular-nums text-xs text-v2-ink-500">
          {percentLabel} | {repsLabel} reps
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStatusChange(status === "S" ? "" : "S")}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold duration-v2-quick ${
            status === "S"
              ? "border-v2-success-600 bg-v2-success-600 text-v2-ink-50 shadow-v2-elev-1"
              : "border-v2-surface-800 bg-v2-surface-950 text-v2-ink-500 hover:border-v2-success-600 hover:text-v2-success-300"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(status === "F" ? "" : "F")}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold duration-v2-quick ${
            status === "F"
              ? "border-v2-danger-600 bg-v2-danger-600 text-v2-ink-50 shadow-v2-elev-1"
              : "border-v2-surface-800 bg-v2-surface-950 text-v2-ink-500 hover:border-v2-danger-600 hover:text-v2-danger-300"
          }`}
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {showActualInput && status === "F" && (
        <div className="flex items-center gap-2 text-xs text-v2-ink-300">
          <span className="font-v2-heading font-semibold uppercase tracking-[0.18em]">Actual Reps</span>
          <input
            className="w-20 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-900 px-2 py-1 font-v2-mono tabular-nums text-sm text-v2-ink-50 shadow-v2-elev-1 focus:border-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/40 duration-v2-quick"
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
