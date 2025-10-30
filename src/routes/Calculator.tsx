import React, { useEffect, useMemo, useState } from "react";
import {
  defaultEquipment,
  ensureAnon,
  loadProfileRemote,
  normalizeEquipment,
  saveProfile,
  type BarOption,
  type EquipmentSettings,
  type Profile,
  type Unit,
} from "../lib/db";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import { estimate1RM, roundToPlate } from "../lib/tm";

type Lift = "bench" | "squat" | "deadlift" | "press";
const lifts: Lift[] = ["bench", "squat", "deadlift", "press"];

const defaultStep = (unit: Unit): number => (unit === "lb" ? 5 : 2.5);
const formatNumber = (value: number, digits = 2): string => {
  const fixed = value.toFixed(digits);
  return Number(fixed).toString();
};

type PlatePlanRow = { weight: number; count: number };

type PlatePlanResult = {
  perSide: PlatePlanRow[];
  difference: number;
  totalUsed: number;
  target: number;
  barWeight: number;
  isPossible: boolean;
};

const computePlatePlan = (
  target: number | "",
  barWeight: number,
  plates: number[]
): PlatePlanResult | null => {
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    return null;
  }
  const usableBarWeight = Number.isFinite(barWeight) && barWeight > 0 ? barWeight : 0;
  const sortedPlates = Array.from(
    new Set(
      plates
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    )
  ).sort((a, b) => b - a);

  const perSide: PlatePlanRow[] = [];
  const plateTotal = target - usableBarWeight;

  if (plateTotal <= 0 || !sortedPlates.length) {
    const difference = Number((target - usableBarWeight).toFixed(3));
    return {
      perSide,
      difference,
      totalUsed: usableBarWeight,
      target,
      barWeight: usableBarWeight,
      isPossible: Math.abs(difference) < 0.1,
    };
  }

  let remainingPerSide = plateTotal / 2;
  sortedPlates.forEach((plate) => {
    const count = Math.floor((remainingPerSide + 1e-6) / plate);
    if (count > 0) {
      perSide.push({ weight: Number(plate.toFixed(3)), count });
      remainingPerSide -= count * plate;
    }
  });

  const totalPlatesWeight =
    perSide.reduce((sum, item) => sum + item.weight * item.count, 0) * 2;
  const totalUsed = usableBarWeight + totalPlatesWeight;
  const difference = Number((target - totalUsed).toFixed(3));
  const tolerance = Math.max(0.1, target * 0.002);

  return {
    perSide,
    difference,
    totalUsed,
    target,
    barWeight: usableBarWeight,
    isPossible: Math.abs(difference) <= tolerance,
  };
};

const flattenPlatesForVisual = (rows: PlatePlanRow[]): number[] =>
  rows.flatMap((row) => Array.from({ length: row.count }, () => row.weight));

const plateColor = (index: number): string => {
  const palette = [
    "#38bdf8",
    "#34d399",
    "#60a5fa",
    "#a855f7",
    "#f97316",
    "#fbbf24",
    "#14b8a6",
    "#f472b6",
  ];
  return palette[index % palette.length];
};

function parseNumeric(value: string): number | "" {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : "";
}

type PlateVisualProps = {
  unit: Unit;
  barWeight: number;
  plates: number[];
  targetWeight: number | "";
};

function PlateVisual({ unit, barWeight, plates, targetWeight }: PlateVisualProps) {
  const hasTarget = typeof targetWeight === "number" && targetWeight > 0;
  const maxPlate = plates.length ? Math.max(...plates) : 0;
  const minHeight = 52;
  const maxHeight = 120;
  const minWidth = 12;
  const maxWidth = 32;
  const scaleHeight = (weight: number): number => {
    if (!maxPlate) return minHeight;
    const ratio = weight / maxPlate;
    return Math.round(minHeight + ratio * (maxHeight - minHeight));
  };
  const scaleWidth = (weight: number): number => {
    if (!maxPlate) return minWidth;
    const ratio = weight / maxPlate;
    return Math.round(minWidth + ratio * (maxWidth - minWidth));
  };

  const plateData = plates.map((weight, index) => ({
    weight,
    height: scaleHeight(weight),
    width: scaleWidth(weight),
    color: plateColor(index),
    key: `${weight}-${index}`,
  }));

  return (
    <div className="relative overflow-hidden rounded-xl bg-slate-900 p-5 text-white shadow-inner">
      <div className="absolute left-8 right-8 top-1/2 h-5 -translate-y-1/2 rounded-full bg-slate-700" />
      <div className="relative flex items-end gap-6">
        <div className="self-center flex h-14 w-20 flex-col items-center justify-center rounded-lg bg-slate-300 text-xs font-semibold text-slate-900 shadow-md">
          {barWeight > 0 ? `${formatNumber(barWeight)} ${unit}` : "Bar"}
        </div>
        <div className="self-center h-14 w-3 rounded-r-md bg-slate-500 shadow-inner" />
        <div className="flex flex-1 items-end">
            <div className="flex items-end gap-3">
              {plateData.length ? (
                plateData.map((plate) => (
                  <div key={plate.key} className="flex flex-col items-center gap-1">
                    <div
                    className="rounded-md border border-slate-900"
                    style={{
                      height: `${plate.height}px`,
                      width: `${plate.width}px`,
                      backgroundColor: plate.color,
                      boxShadow: "inset 0 0 6px rgba(15, 23, 42, 0.45)",
                    }}
                  />
                  <span className="text-[11px] font-semibold text-gray-200">
                    {formatNumber(plate.weight)}
                  </span>
                </div>
              ))
            ) : (
              <div className="text-xs text-gray-300">
                {hasTarget ? "Only the bar is needed." : "Add a target weight to calculate plates."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
  const [saving, setSaving] = useState(false);
  const [equipment, setEquipment] = useState<EquipmentSettings>(defaultEquipment());
  const [targetWeight, setTargetWeight] = useState<number | "">("");
  const [equipmentDirty, setEquipmentDirty] = useState(false);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [equipmentMessage, setEquipmentMessage] = useState<string | null>(null);
  const [manageEquipment, setManageEquipment] = useState(false);
  const [newPlateWeight, setNewPlateWeight] = useState("");
  const [newBarLabel, setNewBarLabel] = useState("");
  const [newBarWeight, setNewBarWeight] = useState("");

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

      const equipmentSource = remote?.equipment ?? (local as any)?.equipment;
      const baseEquipment = normalizeEquipment(
        equipmentSource as EquipmentSettings | undefined
      );

      const baseProfile: Profile = remote
        ? { ...remote, equipment: baseEquipment }
        : {
            uid: resolvedUid,
            firstName: local.firstName ?? "",
            lastName: local.lastName ?? "",
            unit: effectiveUnit,
            team: local.team,
            tm: local.tm ?? {},
            accessCode: local.accessCode ?? null,
            equipment: baseEquipment,
          };

      setProfile(baseProfile);
      setEquipment(baseEquipment);
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const storedOneRm = profile.oneRm?.[lift];
    if (typeof storedOneRm === "number" && storedOneRm > 0) {
      setMeasured1rm(Number(storedOneRm.toFixed(1)));
      return;
    }
    const storedTm = profile.tm?.[lift];
    if (typeof storedTm === "number" && storedTm > 0) {
      const approx = storedTm / 0.9;
      setMeasured1rm(Number(approx.toFixed(1)));
      return;
    }
    setMeasured1rm("");
  }, [profile, lift]);

  useEffect(() => {
    if (!profile) return;
    const stored = profile.tm?.[lift];
    if (typeof stored === "number" && stored > 0 && targetWeight === "") {
      setTargetWeight(stored);
    }
  }, [profile, lift, targetWeight]);

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
    return roundToPlate(estimated1rm * 0.9, unit, roundStep);
  }, [estimated1rm, unit, roundStep]);

  const platesForUnit = useMemo(
    () => equipment.plates[unit] ?? [],
    [equipment, unit]
  );
  const barOptions = useMemo(
    () => equipment.bars[unit] ?? [],
    [equipment, unit]
  );
  const activeBarId =
    equipment.activeBarId[unit] ?? (barOptions[0]?.id ?? null);
  const activeBar =
    barOptions.find((bar) => bar.id === activeBarId) ?? barOptions[0] ?? null;
  const activeBarWeight = activeBar?.weight ?? 0;

  const platePlan = useMemo(
    () => computePlatePlan(targetWeight, activeBarWeight, platesForUnit),
    [targetWeight, activeBarWeight, platesForUnit]
  );

  const platesUsedKeys = useMemo(() => {
    if (!platePlan) return new Set<string>();
    return new Set(
      platePlan.perSide.map((row) => row.weight.toFixed(3))
    );
  }, [platePlan]);

  const visualPlates = useMemo(
    () => (platePlan ? flattenPlatesForVisual(platePlan.perSide) : []),
    [platePlan]
  );

  const perSideTotal = platePlan
    ? platePlan.perSide.reduce((sum, row) => sum + row.weight * row.count, 0)
    : 0;
  const planDifference = platePlan?.difference ?? 0;
  const planSummary = platePlan
    ? platePlan.isPossible
      ? `Load ${formatNumber(perSideTotal)} ${unit} per side on the ${formatNumber(
          activeBarWeight
        )} ${unit} bar.`
      : `You are short ${formatNumber(Math.abs(planDifference))} ${unit} with the current plates.`
    : "Enter a target weight to calculate plates.";

  useEffect(() => {
    if (targetWeight === "" && trainingMax !== null) {
      setTargetWeight(trainingMax);
    }
  }, [trainingMax, targetWeight]);

  useEffect(() => {
    if (!equipmentMessage) return;
    const timer = window.setTimeout(() => setEquipmentMessage(null), 4000);
    return () => window.clearTimeout(timer);
  }, [equipmentMessage]);

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

  const handleTargetWeightChange = (value: string) => {
    const parsed = parseNumeric(value);
    if (parsed === "" || (typeof parsed === "number" && parsed >= 0)) {
      setTargetWeight(parsed);
    }
  };

  const applyEquipmentUpdate = (
    updater: (prev: EquipmentSettings) => EquipmentSettings
  ) => {
    setEquipment((prev) => {
      const next = normalizeEquipment(updater(prev));
      setProfile((prevProfile) =>
        prevProfile ? { ...prevProfile, equipment: next } : prevProfile
      );
      return next;
    });
    setEquipmentDirty(true);
  };

  const handleSelectBar = (id: string) => {
    applyEquipmentUpdate((prev) => ({
      ...prev,
      activeBarId: { ...prev.activeBarId, [unit]: id },
    }));
  };

  const handleAddPlate = () => {
    const parsed = parseNumeric(newPlateWeight);
    if (typeof parsed !== "number" || parsed <= 0) return;
    applyEquipmentUpdate((prev) => {
      const current = prev.plates[unit] ?? [];
      return {
        ...prev,
        plates: { ...prev.plates, [unit]: [...current, parsed] },
      };
    });
    setNewPlateWeight("");
  };

  const handleRemovePlate = (weight: number) => {
    applyEquipmentUpdate((prev) => {
      const current = prev.plates[unit] ?? [];
      const nextList = current.filter(
        (value) => Math.abs(value - weight) > 1e-6
      );
      return {
        ...prev,
        plates: { ...prev.plates, [unit]: nextList },
      };
    });
  };

  const handleAddBar = () => {
    const parsedWeight = parseNumeric(newBarWeight);
    if (typeof parsedWeight !== "number" || parsedWeight <= 0) return;
    const label =
      newBarLabel.trim() || `${formatNumber(parsedWeight)} ${unit} bar`;
    applyEquipmentUpdate((prev) => {
      const current = prev.bars[unit] ?? [];
      return {
        ...prev,
        bars: {
          ...prev.bars,
          [unit]: [...current, { id: "", label, weight: parsedWeight }],
        },
      };
    });
    setNewBarLabel("");
    setNewBarWeight("");
  };

  const handleRemoveBar = (id: string) => {
    applyEquipmentUpdate((prev) => {
      const current = prev.bars[unit] ?? [];
      const nextList = current.filter((bar) => bar.id !== id);
      const wasActive = prev.activeBarId[unit] === id;
      return {
        ...prev,
        bars: { ...prev.bars, [unit]: nextList },
        activeBarId: {
          ...prev.activeBarId,
          [unit]: wasActive ? nextList[0]?.id ?? null : prev.activeBarId[unit],
        },
      };
    });
  };

  const handleResetEquipment = () => {
    applyEquipmentUpdate(() => defaultEquipment());
  };

  const persistEquipmentChanges = async () => {
    if (!profile) return;
    setEquipmentSaving(true);
    const nextProfile: Profile = { ...profile, equipment };
    try {
      await saveProfile(nextProfile);
      setProfile(nextProfile);
      setEquipmentDirty(false);
      setEquipmentMessage("Equipment saved.");
    } catch (err) {
      console.warn("Failed to save equipment", err);
      setEquipmentMessage("Could not save equipment right now.");
    } finally {
      setEquipmentSaving(false);
    }
  };

  const toggleManageState = () => {
    setManageEquipment((prev) => {
      const next = !prev;
      if (!next) {
        setNewPlateWeight("");
        setNewBarLabel("");
        setNewBarWeight("");
      }
      return next;
    });
  };

  async function handleSave() {
    if (!profile) return;
    if (trainingMax === null) {
      alert("Enter a valid 1RM to calculate the training max first.");
      return;
    }

    const nextOneRm = estimated1rm
      ? Number(estimated1rm.toFixed(1))
      : Number((trainingMax / 0.9).toFixed(1));

    const nextProfile: Profile = {
      ...profile,
      unit,
      tm: {
        ...(profile.tm ?? {}),
        [lift]: trainingMax,
      },
      oneRm: {
        ...(profile.oneRm ?? {}),
        [lift]: nextOneRm,
      },
    };

    setSaving(true);
    try {
      await saveProfile(nextProfile);
      setProfile(nextProfile);
      setMeasured1rm(Number(nextOneRm.toFixed(1)));
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
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
              {estimated1rm ? `${estimated1rm.toFixed(1)} ${unit}` : "-"}
            </div>
            <div className="text-sm text-gray-600">
              Training Max (90%):{" "}
              <span className="font-semibold text-gray-900">
                {trainingMax !== null ? `${trainingMax} ${unit}` : "-"}
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

          <div className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Equipment</h2>
              <button
                type="button"
                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                onClick={toggleManageState}
              >
                {manageEquipment ? "Done" : "Manage"}
              </button>
            </div>

            <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Plates ({unit})
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {platesForUnit.length ? (
                      platesForUnit.map((weight) => {
                        const key = weight.toFixed(3);
                        const active = platesUsedKeys.has(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                              active
                                ? "border-brand-400 bg-brand-50 text-brand-700"
                                : "border-gray-200 text-gray-600 hover:border-brand-200 hover:text-brand-700"
                            }`}
                            onClick={() => {
                              if (manageEquipment) handleRemovePlate(weight);
                            }}
                            title={
                              manageEquipment ? "Remove plate size" : undefined
                            }
                          >
                            {formatNumber(weight)} {unit}
                            {manageEquipment && (
                              <span className="ml-2 text-xs text-gray-400">
                                ×
                              </span>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-xs text-gray-400">
                        No plates listed yet.
                      </span>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-wide text-gray-500">
                    Bars ({unit})
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {barOptions.length ? (
                      barOptions.map((bar) => {
                        const isActive = bar.id === activeBarId;
                        return (
                          <button
                            key={bar.id}
                            type="button"
                            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition ${
                              isActive
                                ? "border-brand-400 bg-brand-50 text-brand-700"
                                : "border-gray-200 text-gray-600 hover:border-brand-200 hover:text-brand-700"
                            }`}
                            onClick={() => handleSelectBar(bar.id)}
                          >
                            <span>{bar.label}</span>
                            <span className="text-xs text-gray-500">
                              ({formatNumber(bar.weight)} {unit})
                            </span>
                            {manageEquipment && (
                              <span
                                className="ml-1 text-xs text-gray-400 hover:text-rose-500"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleRemoveBar(bar.id);
                                }}
                              >
                                ×
                              </span>
                            )}
                          </button>
                        );
                      })
                    ) : (
                      <span className="text-xs text-gray-400">
                        No bars saved yet.
                      </span>
                    )}
                  </div>
                </div>

                {manageEquipment && (
                  <div className="space-y-4 border-t border-dashed border-gray-300 pt-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                        <span>Add plate ({unit})</span>
                        <input
                          className="field"
                          inputMode="decimal"
                          value={newPlateWeight}
                          onChange={(e) => setNewPlateWeight(e.target.value)}
                          placeholder={unit === "lb" ? "2.5" : "1.25"}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn px-3 py-2 text-sm"
                        onClick={handleAddPlate}
                        disabled={newPlateWeight.trim() === ""}
                      >
                        Add plate
                      </button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                        <span>Bar label</span>
                        <input
                          className="field"
                          value={newBarLabel}
                          onChange={(e) => setNewBarLabel(e.target.value)}
                          placeholder="Standard"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                        <span>Bar weight ({unit})</span>
                        <input
                          className="field"
                          inputMode="decimal"
                          value={newBarWeight}
                          onChange={(e) => setNewBarWeight(e.target.value)}
                          placeholder={unit === "lb" ? "45" : "20"}
                        />
                      </label>
                      <button
                        type="button"
                        className="btn px-3 py-2 text-sm"
                        onClick={handleAddBar}
                        disabled={newBarWeight.trim() === ""}
                      >
                        Add bar
                      </button>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-xs font-semibold text-rose-600 hover:text-rose-700"
                        onClick={handleResetEquipment}
                      >
                        Reset to defaults
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col gap-2 border-t border-gray-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
                  {equipmentMessage && (
                    <div className="text-xs text-gray-600">{equipmentMessage}</div>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary px-4 py-2 text-sm"
                    onClick={persistEquipmentChanges}
                    disabled={equipmentSaving || !equipmentDirty}
                  >
                    {equipmentSaving ? "Saving..." : "Save equipment"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="card space-y-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <h2 className="text-xl font-semibold">Plate Calculator</h2>
            <div className="flex flex-wrap gap-2 text-xs font-semibold">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 transition ${
                  trainingMax !== null
                    ? "border-brand-200 text-brand-700 hover:bg-brand-50"
                    : "border-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                onClick={() => {
                  if (trainingMax !== null) setTargetWeight(trainingMax);
                }}
                disabled={trainingMax === null}
              >
                Use TM
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1 transition ${
                  estimated1rm
                    ? "border-brand-200 text-brand-700 hover:bg-brand-50"
                    : "border-gray-200 text-gray-400 cursor-not-allowed"
                }`}
                onClick={() => {
                  if (estimated1rm)
                    setTargetWeight(roundToPlate(estimated1rm, unit, roundStep));
                }}
                disabled={!estimated1rm}
              >
                Use 1RM
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:border-brand-200 hover:text-brand-700"
                onClick={() => setTargetWeight("")}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>Target weight ({unit})</span>
              <input
                className="field"
                inputMode="decimal"
                value={targetWeight === "" ? "" : targetWeight}
                onChange={(e) => handleTargetWeightChange(e.target.value)}
                placeholder={unit === "lb" ? "225" : "100"}
              />
            </label>
            <div className="flex gap-2">
              {(["lb", "kg"] as Unit[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    unit === opt
                      ? "border-brand-400 bg-brand-50 text-brand-700"
                      : "border-gray-200 text-gray-600 hover:border-brand-200 hover:text-brand-700"
                  }`}
                  onClick={() => handleUnitChange(opt)}
                >
                  {opt.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1 text-sm text-gray-600">
            <div>
              Target:&nbsp;
              <span className="font-semibold">
                {typeof targetWeight === "number" && targetWeight > 0
                  ? `${formatNumber(targetWeight)} ${unit}`
                  : "-"}
              </span>
            </div>
            <div>
              Bar weight:&nbsp;
              <span className="font-semibold">
                {formatNumber(activeBarWeight)} {unit}
              </span>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-gray-200 bg-gray-900 p-4 text-white">
            <PlateVisual
              unit={unit}
              barWeight={activeBarWeight}
              plates={visualPlates}
              targetWeight={targetWeight}
            />

            {platePlan && platePlan.perSide.length > 0 && (
              <div className="grid gap-x-6 gap-y-1 text-xs text-gray-200 sm:grid-cols-2 sm:text-sm">
                {platePlan.perSide.map((row, idx) => (
                  <React.Fragment key={`${row.weight}-${idx}`}>
                    <div>
                      {row.count} x {formatNumber(row.weight)} {unit}
                    </div>
                    <div className="text-right">
                      {formatNumber(row.weight * row.count)} {unit}/side
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}

            <div
              className={`rounded-xl border px-3 py-2 text-xs sm:text-sm ${
                platePlan
                  ? platePlan.isPossible
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-gray-700 bg-gray-800 text-gray-200"
              }`}
            >
              {planSummary}
              {platePlan && !platePlan.isPossible && (
                <div className="mt-1 text-xs">
                  Add smaller plates or adjust the target weight.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
