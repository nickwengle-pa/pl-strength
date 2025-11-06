import { useEffect, useMemo, useState } from "react";
import {
  estimate1RM,
  warmupPercents,
  weekPercents,
  roundToPlate,
} from "../lib/tm";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import {
  loadProfileRemote,
  saveSession,
  bestEst1RM,
  recentSessions,
} from "../lib/db";
import CoachTips from "../components/CoachTips";
import TrendMini from "../components/TrendMini";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

type Lift = "bench" | "squat" | "deadlift" | "press";
type Week = 1 | 2 | 3 | 4;
type Unit = "lb" | "kg";

type SetOutcome = { status: "" | "S" | "F"; actualReps: string };

const warmRepLabels = ["5", "5", "3"];
const workRepLabels: Record<Week, [string, string, string]> = {
  1: ["5", "5", "5+"],
  2: ["3", "3", "3+"],
  3: ["5", "3", "1+"],
  4: ["5", "5", "5"],
};

const LIFT_LABELS: Record<Lift, string> = {
  bench: "Bench Press",
  squat: "Back Squat",
  deadlift: "Deadlift",
  press: "Overhead Press",
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
  4: {
    name: "Deload Reset",
    focus: "Move well, recover hard, and stay fast.",
    blurb: "Keep the groove light so you return fresher next week.",
  },
};

export default function Session() {
  const [lift, setLift] = useState<Lift>("bench");
  const [week, setWeek] = useState<Week>(1);
  const [unit, setUnit] = useState<Unit>("lb");
  const [tm, setTm] = useState<number | null>(null);

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


  useEffect(() => {
    (async () => {
      if (targetUid) {
        const profile = await loadProfileRemote(targetUid);
        if (profile) {
          const nextUnit = (profile.unit || "lb") as Unit;
          setUnit(nextUnit);
          setStep(nextUnit === "lb" ? 5 : 2.5);
          const tmForLift = profile.tm?.[lift] ?? null;
          setTm(tmForLift ?? null);
        } else {
          setUnit("lb");
          setStep(5);
          setTm(null);
        }
      } else {
        const remote = await loadProfileRemote();
        const local = loadProfileLocal();
        const profile = remote || local;
        if (profile) {
          const nextUnit = (profile.unit || "lb") as Unit;
          setUnit(nextUnit);
          setStep(nextUnit === "lb" ? 5 : 2.5);
          const tmForLift = profile.tm?.[lift] ?? null;
          setTm(tmForLift ?? null);
        } else {
          setTm(null);
        }
      }
      setAmrapReps(0);
      setNote("");
      setPrFlag(false);
    })();
  }, [lift, targetUid, version]);

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
    const numericReps = week === 1 ? [5, 5, 5] : week === 2 ? [3, 3, 3] : week === 3 ? [5, 3, 1] : [5, 5, 5];
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
    if (!tm || work.length === 0 || amrapReps <= 0 || week === 4) {
      setEst(null);
      return;
    }
    const estimate = estimate1RM(lastWorkWeight, amrapReps);
    setEst(Number(estimate.toFixed(1)));
  }, [amrapReps, work, tm, week, lastWorkWeight]);

  useEffect(() => {
    if (coachLoading) return;
    if (isCoach && !targetUid) {
      setHistory([]);
      return;
    }
    (async () => {
      const rows = await recentSessions(lift, 12, targetUid);
      setHistory(rows.reverse());
    })();
  }, [lift, targetUid, isCoach, coachLoading, version]);

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
    if (week === 4) {
      alert("Deload week: no AMRAP logging.");
      return;
    }
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
      const best = await bestEst1RM(lift, 20, targetUid);
      const pr = est1rm > best;

      await saveSession(
        {
          lift,
          week,
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

      const rows = await recentSessions(lift, 12, targetUid);
      setHistory(rows.reverse());
      notifyProfileChange();
      alert(
        pr
          ? `Saved. PR! New estimated 1RM ${est1rm} ${unit}`
          : `Saved. Estimated 1RM ${est1rm} ${unit}`
      );
    } catch (err) {
      console.warn("Failed to save session", err);
      alert("Unable to save session right now. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const estSeries = history
    .map((row) => row.est1rm)
    .filter((value: number) => typeof value === "number" && !Number.isNaN(value));
  const prevBest = estSeries.length ? Math.max(...estSeries) : 0;

  const theme = WEEK_THEMES[week];
  const liftLabel = LIFT_LABELS[lift];
  const quickStats = [
    { label: "Lift", value: liftLabel },
    { label: "Week", value: `Week ${week} | ${theme.name}` },
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

  return (
    <div className="container py-6 space-y-8">
      <div className="rounded-3xl border border-gray-100 bg-white p-6 shadow-lg ring-1 ring-gray-100/80 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold text-gray-900">Let's Train</h1>
            <p className="text-sm font-semibold text-gray-700">
              Week {week} - {theme.name}
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
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Lift</span>
                  <select
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    value={lift}
                    onChange={(event) => setLift(event.target.value as Lift)}
                  >
                    <option value="bench">Bench Press</option>
                    <option value="squat">Back Squat</option>
                    <option value="deadlift">Deadlift</option>
                    <option value="press">Overhead Press</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span className="text-xs uppercase tracking-wide text-gray-500">Week</span>
                  <select
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100"
                    value={week}
                    onChange={(event) => setWeek(Number(event.target.value) as Week)}
                  >
                    <option value={1}>Week 1 - 65/75/85</option>
                    <option value={2}>Week 2 - 70/80/90</option>
                    <option value={3}>Week 3 - 75/85/95</option>
                    <option value={4}>Deload - 40/50/60</option>
                  </select>
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

            {week !== 4 && (
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
            )}

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
              disabled={saving || !tm || (week !== 4 && amrapReps <= 0)}
            >
              {week === 4 ? "Deload (no save)" : saving ? "Saving..." : "Save session"}
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
            {history.slice(-5).map((session, index) => (
              <li key={index} className="rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-gray-900">
                    {session.est1rm ? `est1RM ${session.est1rm} ${session.unit}` : "Logged session"}
                  </div>
                  {session.pr ? (
                    <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                      PR
                    </span>
                  ) : null}
                </div>
                <div className="text-xs text-gray-500">
                  AMRAP {session.amrap?.weight} x {session.amrap?.reps} {session.unit} - Week {session.week}
                </div>
              </li>
            ))}
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
        <div className="text-sm font-semibold text-gray-900">{weightLabel}</div>
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
              : "border-gray-300 bg-white text-gray-700 hover:border-emerald-400 hover:text-emerald-600"
          }`}
        >
          S
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(status === "F" ? "" : "F")}
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold transition ${
            status === "F"
              ? "border-rose-500 bg-rose-100 text-rose-700 shadow-sm"
              : "border-gray-300 bg-white text-gray-700 hover:border-rose-400 hover:text-rose-600"
          }`}
        >
          F
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





