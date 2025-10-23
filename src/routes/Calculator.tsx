import React, { useEffect, useMemo, useState } from "react";
import {
  ensureAnon,
  loadProfileRemote,
  saveProfile,
  type Profile,
  type Unit,
} from "../lib/db";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import {
  estimate1RM,
  roundToPlate,
  warmupPercents,
  weekPercents,
} from "../lib/tm";

type Lift = "bench" | "squat" | "deadlift" | "press";
type Week = 1 | 2 | 3 | 4;

const lifts: Lift[] = ["bench", "squat", "deadlift", "press"];
const weekLabels: Record<Week, string> = {
  1: "Week 1 (65/75/85)",
  2: "Week 2 (70/80/90)",
  3: "Week 3 (75/85/95)",
  4: "Week 4 (Deload 40/50/60)",
};
const warmupRepScheme = ["5", "5", "3"];
const workRepScheme: Record<Week, [string, string, string]> = {
  1: ["5", "5", "5+"],
  2: ["3", "3", "3+"],
  3: ["5", "3", "1+"],
  4: ["5", "5", "5"],
};

const defaultStep = (unit: Unit) => (unit === "lb" ? 5 : 2.5);
const percentLabel = (pct: number) => `${Math.round(pct * 100)}%`;
const formatWeight = (value: number | null, unit: Unit) =>
  value && value > 0 ? `${value} ${unit}` : "—";

function parseNumeric(value: string): number | "" {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : "";
}

export default function Calculator() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [unit, setUnit] = useState<Unit>("lb");
  const [roundStep, setRoundStep] = useState<number>(defaultStep("lb"));
  const [roundStepText, setRoundStepText] = useState<string>(
    String(defaultStep("lb"))
  );
  const [lift, setLift] = useState<Lift>("bench");
  const [useEstimator, setUseEstimator] = useState(false);
  const [measured1rm, setMeasured1rm] = useState<number | "">("");
  const [estimatorWeight, setEstimatorWeight] = useState<number | "">("");
  const [estimatorReps, setEstimatorReps] = useState<number | "">("");
  const [week, setWeek] = useState<Week>(1);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      let resolvedUid = "local";
      try {
        resolvedUid = await ensureAnon();
      } catch {
        resolvedUid = "local";
      }

      const local = (loadProfileLocal() ?? {}) as Partial<Profile>;
      let remote: Profile | null = null;
      try {
        remote = await loadProfileRemote(resolvedUid);
      } catch {
        remote = null;
      }

      const effectiveUnit = (remote?.unit ?? local.unit ?? "lb") as Unit;
      const defaultRound = defaultStep(effectiveUnit);

      setUnit(effectiveUnit);
      setRoundStep(defaultRound);
      setRoundStepText(String(defaultRound));

      const baseProfile: Profile = remote ?? {
        uid: remote?.uid ?? resolvedUid,
        firstName: remote?.firstName ?? local.firstName ?? "",
        lastName: remote?.lastName ?? local.lastName ?? "",
        unit: effectiveUnit,
        team: local.team,
        tm: remote?.tm ?? local.tm ?? {},
      };

      setProfile(baseProfile);
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const stored = profile.tm?.[lift];
    if (typeof stored === "number" && stored > 0) {
      const approx = stored / 0.9;
      setMeasured1rm(Number(approx.toFixed(1)));
    } else {
      setMeasured1rm("");
    }
  }, [profile, lift]);

  const estimated1rm = useMemo(() => {
    if (useEstimator) {
      if (
        typeof estimatorWeight === "number" &&
        typeof estimatorReps === "number" &&
        estimatorWeight > 0 &&
        estimatorReps > 0
      ) {
        return Number(estimate1RM(estimatorWeight, estimatorReps).toFixed(1));
      }
      return null;
    }
    if (typeof measured1rm === "number" && measured1rm > 0) {
      return Number(measured1rm.toFixed(1));
    }
    return null;
  }, [useEstimator, measured1rm, estimatorWeight, estimatorReps]);

  const trainingMax = useMemo(() => {
    if (!estimated1rm) return null;
    return Math.round(estimated1rm * 0.9);
  }, [estimated1rm]);

  const warmupRows = useMemo(
    () =>
      warmupPercents().map((pct, idx) => ({
        pct,
        reps: warmupRepScheme[idx],
        weight:
          trainingMax !== null
            ? roundToPlate(trainingMax * pct, unit, roundStep)
            : null,
      })),
    [trainingMax, unit, roundStep]
  );

  const workRows = useMemo(() => {
    const reps = workRepScheme[week];
    const percents = weekPercents(week);
    return percents.map((pct, idx) => ({
      pct,
      reps: reps[idx],
      weight:
        trainingMax !== null
          ? roundToPlate(trainingMax * pct, unit, roundStep)
          : null,
    }));
  }, [trainingMax, unit, roundStep, week]);

  function handleUnitChange(next: Unit) {
    const step = defaultStep(next);
    setUnit(next);
    setRoundStep(step);
    setRoundStepText(String(step));
  }

  function handleRoundStepInput(value: string) {
    setRoundStepText(value);
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      setRoundStep(num);
    }
  }

  function handleRoundStepBlur() {
    const num = Number(roundStepText);
    if (!Number.isFinite(num) || num <= 0) {
      const fallback = defaultStep(unit);
      setRoundStep(fallback);
      setRoundStepText(String(fallback));
    }
  }

  function toggleEstimator(next: boolean) {
    setUseEstimator(next);
    if (!next) {
      setEstimatorWeight("");
      setEstimatorReps("");
    }
  }

  async function handleSave() {
    if (!profile) return;
    if (trainingMax === null) {
      alert("Enter a valid 1RM to calculate the training max first.");
      return;
    }

    const nextProfile: Profile = {
      ...profile,
      unit,
      tm: {
        ...(profile.tm ?? {}),
        [lift]: trainingMax,
      },
    };

    setSaving(true);
    try {
      await saveProfile(nextProfile);
      setProfile(nextProfile);
      alert("Training max saved for this lift.");
    } catch (err) {
      console.warn("Failed to save training max", err);
      alert("Unable to sync with Firebase right now. We kept it locally.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1>Training Max Calculator</h1>
        <p className="mt-2 text-sm text-gray-600">
          Pick the lift, enter a 1RM (or estimate it), and we will round the
          5/3/1 sets using your plate math.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card space-y-5">
          <h2 className="text-xl font-semibold">Training Max Calculator</h2>

          <div className="grid gap-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Lift</span>
                <select
                  className="field"
                  value={lift}
                  onChange={(e) => setLift(e.target.value as Lift)}
                >
                  {lifts.map((l) => (
                    <option key={l} value={l}>
                      {l.charAt(0).toUpperCase() + l.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Units</span>
                <select
                  className="field"
                  value={unit}
                  onChange={(e) => handleUnitChange(e.target.value as Unit)}
                >
                  <option value="lb">lb</option>
                  <option value="kg">kg</option>
                </select>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>Plate rounding step</span>
              <input
                className="field"
                inputMode="decimal"
                value={roundStepText}
                onChange={(e) => handleRoundStepInput(e.target.value)}
                onBlur={handleRoundStepBlur}
                placeholder={String(defaultStep(unit))}
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                checked={useEstimator}
                onChange={(e) => toggleEstimator(e.target.checked)}
              />
              Use rep-max estimator
            </label>

            {useEstimator ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span>Weight lifted ({unit})</span>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={estimatorWeight === "" ? "" : estimatorWeight}
                    onChange={(e) =>
                      setEstimatorWeight(parseNumeric(e.target.value))
                    }
                    placeholder="e.g., 200"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span>Reps</span>
                  <input
                    className="field"
                    inputMode="numeric"
                    value={estimatorReps === "" ? "" : estimatorReps}
                    onChange={(e) =>
                      setEstimatorReps(parseNumeric(e.target.value))
                    }
                    placeholder="e.g., 5"
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                <span>Measured 1RM ({unit})</span>
                <input
                  className="field"
                  inputMode="decimal"
                  value={measured1rm === "" ? "" : measured1rm}
                  onChange={(e) => setMeasured1rm(parseNumeric(e.target.value))}
                  placeholder={`Enter 1RM in ${unit}`}
                />
              </label>
            )}
          </div>

          <div className="space-y-2 rounded-2xl border border-gray-200 bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-700">
              Estimated 1RM
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {estimated1rm ? `${estimated1rm.toFixed(1)} ${unit}` : "—"}
            </div>
            <div className="text-sm text-gray-600">
              Training Max (90%):{" "}
              <span className="font-semibold text-gray-900">
                {trainingMax !== null ? `${trainingMax} ${unit}` : "—"}
              </span>
            </div>
          </div>

          <button
            className="btn btn-primary w-full justify-center py-3 text-base"
            onClick={handleSave}
            disabled={saving || trainingMax === null}
          >
            {saving ? "Saving..." : "Save as TM for this lift"}
          </button>
        </div>

        <div className="card space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-xl font-semibold">Week Table</h2>
            <select
              className="field md:w-56"
              value={week}
              onChange={(e) => setWeek(Number(e.target.value) as Week)}
            >
              {(Object.keys(weekLabels) as unknown as Week[]).map((w) => (
                <option key={w} value={w}>
                  {weekLabels[w]}
                </option>
              ))}
            </select>
          </div>

          {trainingMax !== null ? (
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <div className="mb-1 font-semibold">Warm-ups</div>
                <ul className="list-disc space-y-1 pl-5">
                  {warmupRows.map((row, idx) => (
                    <li key={row.pct}>
                      {percentLabel(row.pct)} -{" "}
                      <span className="font-semibold">
                        {formatWeight(row.weight, unit)}
                      </span>{" "}
                      x {warmupRepScheme[idx]}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="mb-1 font-semibold">Work sets</div>
                <ul className="list-disc space-y-1 pl-5">
                  {workRows.map((row, idx) => (
                    <li key={row.pct}>
                      {percentLabel(row.pct)} -{" "}
                      <span className="font-semibold">
                        {formatWeight(row.weight, unit)}
                      </span>{" "}
                      x {workRepScheme[week][idx]}
                    </li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-gray-500">
                Rounding uses your plate step ({roundStep} {unit}). Adjust the
                step if you keep change plates on hand.
              </p>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center text-sm text-gray-500">
              Enter a 1RM to generate warm-up and work-set numbers for this
              week.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
