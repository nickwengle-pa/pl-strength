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
  const [plateCalcOpen, setPlateCalcOpen] = useState(false);
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

  const [plateCalcOpen, setPlateCalcOpen] = useState(false);

  if (coachLoading) {
    return <PageLoadingSkeleton rows={2} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white pb-8">
      {/* Header */}
      <div className="bg-brand-600 text-white px-4 py-4 shadow-lg">
        <h1 className="text-xl font-bold">🧮 Training Max Calculator</h1>
        {targetUid ? (
          <div className="text-brand-100 text-sm mt-1">Viewing: {activeAthleteName}</div>
        ) : (
          <p className="text-brand-100 text-sm mt-1">Calculate your 5/3/1 training max</p>
        )}
      </div>

      {isCoach && !targetUid && (
        <div className="mx-4 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          ⚠️ No athlete selected. Pick someone from the roster to load their numbers.
        </div>
      )}

      <div className="px-4 py-5 space-y-4 max-w-lg mx-auto">
        {/* Lift Selector - Pill Buttons */}
        <div className="flex gap-2 justify-center">
          {lifts.map((l) => {
            const isActive = lift === l;
            const colors = l === "squat" 
              ? "bg-brand-600 text-white" 
              : l === "bench" 
              ? "bg-blue-600 text-white" 
              : "bg-purple-600 text-white";
            return (
              <button
                key={l}
                onClick={() => setLift(l)}
                className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                  isActive
                    ? `${colors} shadow-md`
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                }`}
              >
                {l === "squat" ? "🦵" : l === "bench" ? "🏋️" : "💪"} {l.charAt(0).toUpperCase() + l.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Main Calculator Card */}
        <div className="bg-white rounded-2xl shadow-md overflow-hidden">
          {/* Settings Toggle */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors"
            onClick={() => setCalcSettingsOpen((prev) => !prev)}
          >
            <span className="text-sm font-medium text-gray-600">⚙️ Settings</span>
            <svg 
              className={`w-4 h-4 text-gray-400 transition-transform ${calcSettingsOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {calcSettingsOpen && (
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-500">Units</span>
                  <select
                    className="field text-sm"
                    value={unit}
                    onChange={(e) => handleUnitChange(e.target.value as Unit)}
                  >
                    <option value="lb">Pounds (lb)</option>
                    <option value="kg">Kilograms (kg)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-500">Rounding</span>
                  <input
                    className="field text-sm"
                    inputMode="decimal"
                    value={roundStepText}
                    onChange={(e) => handleRoundStepInput(e.target.value)}
                    onBlur={handleRoundStepBlur}
                    placeholder={String(defaultStep(unit))}
                    disabled={!isCoach}
                  />
                </label>
              </div>
            </div>
          )}

          {/* Input Section */}
          <div className="p-4 space-y-4">
            {/* Estimator Toggle */}
            <label className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 cursor-pointer">
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                checked={useEstimator}
                onChange={(e) => toggleEstimator(e.target.checked)}
              />
              <div>
                <div className="text-sm font-medium text-gray-800">Use Rep-Max Estimator</div>
                <div className="text-xs text-gray-500">Don't know your 1RM? Estimate it from reps</div>
              </div>
            </label>

            {useEstimator ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-500">Weight ({unit})</span>
                  <input
                    className="field text-lg font-semibold text-center"
                    inputMode="decimal"
                    value={estimatorWeight === "" ? "" : estimatorWeight}
                    onChange={(e) => setEstimatorWeight(parseNumeric(e.target.value))}
                    placeholder="200"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-gray-500">Reps</span>
                  <input
                    className="field text-lg font-semibold text-center"
                    inputMode="numeric"
                    value={estimatorReps === "" ? "" : estimatorReps}
                    onChange={(e) => setEstimatorReps(parseNumeric(e.target.value))}
                    placeholder="5"
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">Your 1RM ({unit})</span>
                <input
                  className="field text-xl font-bold text-center"
                  inputMode="decimal"
                  value={measured1rm === "" ? "" : measured1rm}
                  onChange={(e) => setMeasured1rm(parseNumeric(e.target.value))}
                  placeholder={`Enter max in ${unit}`}
                />
              </label>
            )}
          </div>

          {/* Results Section */}
          <div className="bg-gradient-to-r from-brand-500 to-brand-600 p-4 text-white">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="text-xs text-brand-100 uppercase tracking-wide">Est. 1RM</div>
                <div className="text-2xl font-bold">
                  {estimated1rm ? formatNumber(estimated1rm) : "—"}
                </div>
                <div className="text-xs text-brand-200">{unit}</div>
              </div>
              <div className="text-center border-l border-brand-400">
                <div className="text-xs text-brand-100 uppercase tracking-wide">Training Max</div>
                <div className="text-2xl font-bold">
                  {trainingMax !== null ? trainingMax : "—"}
                </div>
                <div className="text-xs text-brand-200">90% • {unit}</div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="p-4 space-y-2">
            <button
              className="w-full py-3 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white font-bold rounded-xl shadow transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
              disabled={saving || trainingMax === null}
            >
              {saving ? "Saving..." : `💾 Save ${lift.charAt(0).toUpperCase() + lift.slice(1)} TM`}
            </button>

            {(profile?.tm?.[lift] || profile?.oneRm?.[lift]) && (
              <button
                className="w-full py-2 text-red-600 text-sm font-medium hover:bg-red-50 rounded-xl transition-colors"
                onClick={handleClear}
                disabled={saving}
              >
                Clear {lift} Max
              </button>
            )}
          </div>
        </div>

        {/* Plate Calculator - Collapsible */}
        <details 
          className="bg-white rounded-2xl shadow-md overflow-hidden"
          open={plateCalcOpen}
          onToggle={(e) => setPlateCalcOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-4 py-4 cursor-pointer flex items-center justify-between hover:bg-gray-50 transition-colors list-none">
            <div className="flex items-center gap-2">
              <span className="text-lg">🍽️</span>
              <span className="font-semibold text-gray-800">Plate Calculator</span>
            </div>
            <svg 
              className={`w-5 h-5 text-gray-400 transition-transform ${plateCalcOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>

          <div className="border-t border-gray-100">
            {/* Quick Actions */}
            <div className="flex gap-2 px-4 py-3 bg-gray-50 border-b border-gray-100">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  trainingMax !== null
                    ? "bg-brand-100 text-brand-700 hover:bg-brand-200"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
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
                className={`flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  estimated1rm
                    ? "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    : "bg-gray-200 text-gray-400 cursor-not-allowed"
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
                className="flex-1 rounded-lg px-3 py-2 text-xs font-semibold bg-gray-200 text-gray-600 hover:bg-gray-300"
                onClick={() => {
                  setTargetLocked(true);
                  setTargetWeight("");
                }}
              >
                Clear
              </button>
            </div>

            {/* Target Weight Input */}
            <div className="p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-gray-500">Target Weight ({unit})</span>
                <input
                  className="field text-lg font-semibold text-center"
                  inputMode="decimal"
                  value={targetWeight === "" ? "" : targetWeight}
                  onChange={(e) => handleTargetWeightChange(e.target.value)}
                  placeholder={unit === "lb" ? "225" : "100"}
                />
              </label>

              <div className="flex justify-between text-xs text-gray-500 mt-2">
                <span>Bar: {formatNumber(activeBarWeight)} {unit}</span>
                <span>Target: {typeof targetWeight === "number" ? `${formatNumber(targetWeight)} ${unit}` : "—"}</span>
              </div>
            </div>

            {/* Plate Visual */}
            <div className="bg-gray-900 p-4 text-white">
              <PlateVisual
                unit={unit}
                barWeight={activeBarWeight}
                plates={visualPlates}
                targetWeight={targetWeight}
              />

              {platePlan && platePlan.perSide.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-1 text-xs text-gray-300">
                  {platePlan.perSide.map((row, idx) => (
                    <div key={`${row.weight}-${idx}`} className="flex justify-between px-2">
                      <span>{row.count} × {formatNumber(row.weight)}</span>
                      <span className="text-gray-500">{formatNumber(row.weight * row.count)}/side</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Summary */}
            <div className={`px-4 py-3 text-sm ${
              platePlan
                ? platePlan.isPossible
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
                : "bg-gray-50 text-gray-600"
            }`}>
              {planSummary}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}




