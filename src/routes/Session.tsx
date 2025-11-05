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

  if (coachLoading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading coach tools...</div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-3">
        <div className="card space-y-3">
          <h3 className="text-lg font-semibold">Train - {lift.toUpperCase()}</h3>

          {targetUid ? (<div className="text-xs text-gray-500">Viewing: {activeAthleteName}</div>) : null}
          {isCoach && !targetUid ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              No athlete selected. Log your own sessions or pick someone from the roster to load their training plan.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Lift</label>
            <select
              className="border rounded-xl px-2 py-1"
              value={lift}
              onChange={(event) => setLift(event.target.value as Lift)}
            >
              <option value="bench">Bench</option>
              <option value="squat">Squat</option>
              <option value="deadlift">Deadlift</option>
              <option value="press">Press</option>
            </select>

            <label className="text-sm">Week</label>
            <select
              className="border rounded-xl px-2 py-1"
              value={week}
              onChange={(event) => setWeek(Number(event.target.value) as Week)}
            >
              <option value={1}>Week 1 (65/75/85)</option>
              <option value={2}>Week 2 (70/80/90)</option>
              <option value={3}>Week 3 (75/85/95)</option>
              <option value={4}>Deload (40/50/60)</option>
            </select>

            <label className="text-sm">Units</label>
            <div className="text-sm">{unit}</div>

            <label className="text-sm">Training Max</label>
            <div className="text-sm">{tm ?? "- set TM in Calculator"}</div>
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <span className="font-semibold text-gray-700">Set status legend:</span> S = completed all prescribed reps.
            F = stopped early  record the reps completed.
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Warm-ups</div>
            <div className="space-y-2">
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
                <div className="rounded-xl border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-500">
                  No training max set yet.
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-medium">Work sets</div>
            <div className="space-y-2">
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
            </div>
          </div>

          {week !== 4 && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Last set AMRAP reps</label>
              <input
                className="border rounded-xl px-2 py-1"
                type="number"
                min={0}
                value={amrapReps}
                onChange={(event) =>
                  setAmrapReps(Number(event.target.value) || 0)
                }
              />
              <label className="text-sm">Notes</label>
              <input
                className="border rounded-xl px-2 py-1"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Form cues, RPE, reminders"
              />
            </div>
          )}

          <div className="rounded-xl border bg-gray-50 p-3">
            <div className="text-sm">Estimated 1RM</div>
            <div className="text-2xl font-bold">
              {est ? `${est} ${unit}` : "-"}
            </div>
            {prFlag && (
              <div className="text-sm text-green-700">New PR! Great work.</div>
            )}
          </div>

          <button
            className="btn-primary"
            onClick={save}
            disabled={saving || !tm || (week !== 4 && amrapReps <= 0)}
          >
            {week === 4 ? "Deload (no save)" : saving ? "Saving..." : "Save session"}
          </button>
        </div>

        <div className="card">
          <h3 className="mb-2 text-lg font-semibold">
            Recent Sessions ({lift})
          </h3>
          <TrendMini values={estSeries} unit={unit} />
          <ul className="mt-2 space-y-2 text-sm">
            {history.slice(-5).map((session, index) => (
              <li key={index} className="border-b pb-2 last:border-0">
                <div>
                  {session.est1rm
                    ? `est1RM ${session.est1rm} ${session.unit}`
                    : ""}
                  {session.pr ? " - PR" : ""}
                </div>
                <div className="text-gray-600">
                  AMRAP {session.amrap?.weight} x {session.amrap?.reps}{" "}
                  {session.unit} - Week {session.week}
                </div>
              </li>
            ))}
            {history.length === 0 && (
              <li className="text-gray-500">No sessions logged yet.</li>
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

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-3 py-2">
      <div className="min-w-[140px]">
        <div className="text-xs uppercase text-gray-500">
          {phase} {index + 1}
        </div>
        <div className="text-sm font-semibold">{weightLabel}</div>
        <div className="text-xs text-gray-500">
          {percentLabel} | {repsLabel} reps
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => onStatusChange(status === "S" ? "" : "S")}
          className={`px-3 py-1 text-sm font-semibold rounded border transition ${
            status === "S"
              ? "border-green-600 bg-green-100 text-green-700"
              : "border-gray-300 text-gray-700 hover:border-green-500"
          }`}
        >
          S
        </button>
        <button
          type="button"
          onClick={() => onStatusChange(status === "F" ? "" : "F")}
          className={`px-3 py-1 text-sm font-semibold rounded border transition ${
            status === "F"
              ? "border-red-600 bg-red-100 text-red-700"
              : "border-gray-300 text-gray-700 hover:border-red-500"
          }`}
        >
          F
        </button>
      </div>

      {showActualInput && status === "F" && (
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase text-gray-500">Actual reps</span>
          <input
            className="w-20 rounded-lg border border-gray-300 px-2 py-1 text-sm"
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





