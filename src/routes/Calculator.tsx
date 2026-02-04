import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  defaultEquipment,
  ensureAnon,
  getStoredTeamSelection,
  loadProfileRemote,
  normalizeEquipment,
  saveProfile,
  type BarOption,
  type EquipmentSettings,
  type Profile,
  type Team,
  type Unit,
} from "../lib/db";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import { estimate1RM, roundToPlate } from "../lib/tm";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { PageLoadingSkeleton } from "../components/LoadingSkeleton";
import {
  PlateVisual,
  computePlatePlan,
  flattenPlatesForVisual,
  formatNumber,
  type PlatePlanRow,
  type PlatePlanResult,
} from "../components/PlateMath";

type Lift = "bench" | "squat" | "deadlift";
const lifts: Lift[] = ["bench", "squat", "deadlift"];

const defaultStep = (unit: Unit): number => (unit === "lb" ? 5 : 2.5);

function parseNumeric(value: string): number | "" {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const num = Number(trimmed);
  return Number.isFinite(num) && num >= 0 ? num : "";
}

export default function Calculator() {
  const location = useLocation();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [unit, setUnit] = useState<Unit>("lb");
  const [roundStep, setRoundStep] = useState<number>(defaultStep("lb"));
  const [roundStepText, setRoundStepText] = useState<string>(
    String(defaultStep("lb"))
  );
  const [calcSettingsOpen, setCalcSettingsOpen] = useState(false);
  const [lift, setLift] = useState<Lift>(() => {
    const state = location.state as { lift?: Lift } | null;
    return state?.lift || "bench";
  });
  const [useEstimator, setUseEstimator] = useState(false);
  const [measured1rm, setMeasured1rm] = useState<number | "">("");
  const [estimatorWeight, setEstimatorWeight] = useState<number | "">("");
  const [estimatorReps, setEstimatorReps] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [equipment, setEquipment] = useState<EquipmentSettings>(defaultEquipment());
  const [targetWeight, setTargetWeight] = useState<number | "">("");
  const [targetLocked, setTargetLocked] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

  const { activeAthlete, isCoach, loading: coachLoading, notifyProfileChange, version } = useActiveAthlete();
  const targetUid = isCoach && activeAthlete ? activeAthlete.uid : undefined;
  const activeAthleteName = activeAthlete
    ? [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") || activeAthlete.uid
    : "";

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
    let active = true;
    (async () => {
      if (targetUid) {
        try {
          await ensureAnon();
          const remote = await loadProfileRemote(targetUid);
          if (!active) return;
          const normalizedEquip = normalizeEquipment(
            remote?.equipment as EquipmentSettings | undefined
          );
          const profileForAthlete: Profile = remote
            ? { ...remote, equipment: normalizedEquip }
            : {
                uid: targetUid,
                firstName: activeAthlete?.firstName ?? "",
                lastName: activeAthlete?.lastName ?? "",
                team: (activeAthlete?.team as Team | undefined) ?? undefined,
                unit: (activeAthlete?.unit as Unit) || "lb",
                tm: {},
                oneRm: {},
                accessCode: null,
                equipment: normalizedEquip ?? defaultEquipment(),
              };
          const nextUnit = (profileForAthlete.unit || "lb") as Unit;
          const nextRound = defaultStep(nextUnit);
          setUnit(nextUnit);
          setRoundStep(nextRound);
          setRoundStepText(String(nextRound));
          setProfile(profileForAthlete);
          setEquipment(profileForAthlete.equipment ?? defaultEquipment());
          setTargetWeight("");
        } catch (err) {
          if (!active) return;
          console.warn("Failed to load athlete profile", err);
          const fallbackUnit = (activeAthlete?.unit as Unit) || "lb";
          setUnit(fallbackUnit);
          const nextRound = defaultStep(fallbackUnit);
          setRoundStep(nextRound);
          setRoundStepText(String(nextRound));
          const fallbackProfile: Profile = {
            uid: targetUid,
            firstName: activeAthlete?.firstName ?? "",
            lastName: activeAthlete?.lastName ?? "",
            team: (activeAthlete?.team as Team | undefined) ?? undefined,
            unit: fallbackUnit,
            tm: {},
            oneRm: {},
            accessCode: null,
            equipment: defaultEquipment(),
          };
          setProfile(fallbackProfile);
          setEquipment(defaultEquipment());
          setTargetWeight("");
        }
        return;
      }

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
            oneRm: local.oneRm ?? {},
            accessCode: local.accessCode ?? null,
            equipment: baseEquipment,
          };

      setProfile(baseProfile);
      setEquipment(baseEquipment);
      setTargetWeight("");
    })();
    return () => {
      active = false;
    };
  }, [targetUid, activeAthlete, version, teamSelection]);


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
    if (
      typeof stored === "number" &&
      stored > 0 &&
      targetWeight === "" &&
      !targetLocked
    ) {
      setTargetWeight(stored);
    }
  }, [profile, lift, targetWeight, targetLocked]);

  useEffect(() => {
    setTargetLocked(false);
  }, [lift, unit, targetUid, teamSelection]);

  const estimated1rm = useMemo(() => {
    if (useEstimator) {
      if (
        typeof estimatorWeight === "number" &&
        typeof estimatorReps === "number" &&
        estimatorWeight > 0 &&
        estimatorReps > 0
      ) {
        // Round to nearest 5 lb (or 2.5 kg)
        const raw = estimate1RM(estimatorWeight, estimatorReps);
        return roundToPlate(raw, unit, unit === "lb" ? 5 : 2.5);
      }
      return null;
    }
    if (typeof measured1rm === "number" && measured1rm > 0) {
      // Round measured 1RM to nearest 5 lb (or 2.5 kg) as well
      return roundToPlate(measured1rm, unit, unit === "lb" ? 5 : 2.5);
    }
    return null;
  }, [useEstimator, measured1rm, estimatorWeight, estimatorReps, unit]);

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
    if (!targetLocked && trainingMax !== null) {
      setTargetWeight(trainingMax);
    }
  }, [trainingMax, targetLocked]);

  function handleUnitChange(next: Unit) {
    const step = defaultStep(next);
    setUnit(next);
    setRoundStep(step);
    setRoundStepText(String(step));
    setTargetLocked(false);
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
      setTargetLocked(true);
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
  };

  const handleSelectBar = async (id: string) => {
    applyEquipmentUpdate((prev) => ({
      ...prev,
      activeBarId: { ...prev.activeBarId, [unit]: id },
    }));
    // Persist bar selection to profile
    if (profile) {
      const nextEquipment = { ...equipment, activeBarId: { ...equipment.activeBarId, [unit]: id } };
      const nextProfile = { ...profile, equipment: nextEquipment };
      try {
        await saveProfile(nextProfile, { skipLocal: Boolean(targetUid) });
      } catch (err) {
        console.warn("Failed to persist bar selection", err);
      }
    }
  };

  async function handleSave() {
    if (!profile) return;
    if (trainingMax === null) {
      alert("Enter a valid 1RM to calculate the training max first.");
      return;
    }

    const nextOneRm = estimated1rm
      ? estimated1rm
      : roundToPlate(trainingMax / 0.9, unit, unit === "lb" ? 5 : 2.5);

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
      await saveProfile(nextProfile, { skipLocal: Boolean(targetUid) });
      setProfile(nextProfile);
      setMeasured1rm(Number(nextOneRm.toFixed(1)));
      setTargetWeight(trainingMax);
      notifyProfileChange();
      alert("Training max saved for this lift.");
    } catch (err) {
      console.warn("Failed to save training max", err);
      alert("Unable to sync with Firebase right now. We kept it locally.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!profile) return;
    if (!confirm(`Are you sure you want to clear your ${lift} max?`)) return;

    const nextProfile: Profile = {
      ...profile,
      tm: { ...(profile.tm ?? {}) },
      oneRm: { ...(profile.oneRm ?? {}) },
    };
    
    delete nextProfile.tm![lift];
    delete nextProfile.oneRm![lift];

    setSaving(true);
    try {
      await saveProfile(nextProfile, { skipLocal: Boolean(targetUid) });
      setProfile(nextProfile);
      setMeasured1rm("");
      setTargetWeight("");
      setEstimatorWeight("");
      setEstimatorReps("");
      notifyProfileChange();
    } catch (err) {
      console.warn("Failed to clear max", err);
      alert("Unable to sync with Firebase right now.");
    } finally {
      setSaving(false);
    }
  }

  if (coachLoading) {
    return <PageLoadingSkeleton rows={2} />;
  }

  return (
    <div className="container py-6 space-y-6">
      <div>
        <h1>Training Max Calculator</h1>
        {targetUid ? (<div className="mt-1 text-sm text-gray-600">Viewing: {activeAthleteName}</div>) : null}
        {isCoach && !targetUid ? (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
            No athlete selected. Use the calculator for quick estimates, or pick someone from the roster to load their numbers.
          </div>
        ) : null}
        <p className="mt-2 text-sm text-gray-600">
          Pick the lift, enter a 1RM (or estimate it), and we will round the
          5/3/1 sets using your plate math.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-6">
          <div className="card space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Training Max Calculator</h2>
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 shadow-sm transition hover:border-brand-200 hover:text-brand-700"
              onClick={() => setCalcSettingsOpen((prev) => !prev)}
              aria-expanded={calcSettingsOpen}
              aria-label="Calculator settings"
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

          {calcSettingsOpen && (
            <div className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4">
              <div className="grid gap-4 md:grid-cols-2">
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
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span>Plate Rounding Step</span>
                  <input
                    className="field"
                    inputMode="decimal"
                    value={roundStepText}
                    onChange={(e) => handleRoundStepInput(e.target.value)}
                    onBlur={handleRoundStepBlur}
                    placeholder={String(defaultStep(unit))}
                    disabled={!isCoach}
                  />
                </label>
              </div>
              {!isCoach && (
                <div className="text-xs text-gray-500">
                  Plate Rounding Is Coach-Only.
                </div>
              )}
            </div>
          )}

          <div className="grid gap-4">
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

            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                checked={useEstimator}
                onChange={(e) => toggleEstimator(e.target.checked)}
              />
              Use Rep-Max Estimator
            </label>

            {useEstimator ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  <span>Weight Lifted ({unit})</span>
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
              {estimated1rm ? `${formatNumber(estimated1rm)} ${unit}` : "-"}
            </div>
            <div className="text-sm text-gray-600">
              Training Max (90%):{" "}
              <span className="font-semibold text-gray-900">
                {trainingMax !== null ? `${trainingMax} ${unit}` : "-"}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              className="btn btn-primary w-full justify-center py-3 text-base"
              onClick={handleSave}
              disabled={saving || trainingMax === null}
            >
              {saving ? "Saving..." : "Save As TM For This Lift"}
            </button>

            {(profile?.tm?.[lift] || profile?.oneRm?.[lift]) && (
              <button
                className="btn w-full justify-center py-3 text-base text-red-600 border-red-200 hover:bg-red-50"
                onClick={handleClear}
                disabled={saving}
              >
                Clear {lift} Max
              </button>
            )}
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
                  if (trainingMax !== null) {
                    setTargetLocked(false);
                    setTargetWeight(trainingMax);
                  }
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
                  if (estimated1rm) {
                    setTargetLocked(true);
                    setTargetWeight(roundToPlate(estimated1rm, unit, roundStep));
                  }
                }}
                disabled={!estimated1rm}
              >
                Use 1RM
              </button>
              <button
                type="button"
                className="rounded-full border border-gray-200 px-3 py-1 text-gray-600 hover:border-brand-200 hover:text-brand-700"
                onClick={() => {
                  setTargetLocked(true);
                  setTargetWeight("");
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="grid gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
              <span>Target Weight ({unit})</span>
              <input
                className="field"
                inputMode="decimal"
                value={targetWeight === "" ? "" : targetWeight}
                onChange={(e) => handleTargetWeightChange(e.target.value)}
                placeholder={unit === "lb" ? "225" : "100"}
              />
            </label>
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
              Bar Weight:&nbsp;
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




