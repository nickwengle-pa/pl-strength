import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  defaultEquipment,
  ensureAnon,
  getStoredTeamSelection,
  loadProfileRemote,
  normalizeEquipment,
  saveProfile,
  saveRemaxEvent,
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
import { useToast } from "../context/ToastContext";
import { ConfirmModal } from "../components/ConfirmModal";
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

export default function CalculatorV2() {
  const showToast = useToast();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
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
  const navigate = useNavigate();

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
        const raw = estimate1RM(estimatorWeight, estimatorReps);
        return roundToPlate(raw, unit, unit === "lb" ? 5 : 2.5);
      }
      return null;
    }
    if (typeof measured1rm === "number" && measured1rm > 0) {
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
    if (profile) {
      const nextEquipment = { ...equipment, activeBarId: { ...equipment.activeBarId, [unit]: id } };
      const nextProfile = { ...profile, equipment: nextEquipment };
      try {
        await saveProfile(nextProfile, { skipLocal: Boolean(targetUid), requireRemote: true });
      } catch (err) {
        console.warn("Failed to persist bar selection", err);
      }
    }
  };

  async function handleSave() {
    if (!profile) return;
    if (trainingMax === null) {
      showToast("Enter a valid 1RM to calculate the training max first.", "warning");
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
      liftWeeks: {
        ...(profile.liftWeeks ?? {}),
        [lift]: 1,
      },
      liftCycles: {
        ...(profile.liftCycles ?? {}),
        [lift]: 1,
      },
    };

    setSaving(true);
    try {
      await saveProfile(nextProfile, { skipLocal: Boolean(targetUid), requireRemote: true });
      await saveRemaxEvent(
        lift, trainingMax, nextOneRm, unit,
        getStoredTeamSelection() || undefined, targetUid,
        useEstimator && estimatorWeight ? Number(estimatorWeight) : Number(nextOneRm),
        useEstimator && estimatorReps ? Number(estimatorReps) : 1
      );
      setProfile(nextProfile);
      setMeasured1rm(Number(nextOneRm.toFixed(1)));
      setTargetWeight(trainingMax);
      notifyProfileChange();
      showToast("Training max saved. Cycle reset to Week 1, Cycle 1.", "success");
    } catch (err) {
      console.warn("Failed to save training max", err);
      showToast("Unable to sync with Firebase right now. We kept it locally.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function doClear() {
    if (!profile) return;

    const nextProfile: Profile = {
      ...profile,
      tm: { ...(profile.tm ?? {}) },
      oneRm: { ...(profile.oneRm ?? {}) },
    };

    delete nextProfile.tm![lift];
    delete nextProfile.oneRm![lift];

    setSaving(true);
    try {
      await saveProfile(nextProfile, { skipLocal: Boolean(targetUid), requireRemote: true });
      setProfile(nextProfile);
      setMeasured1rm("");
      setTargetWeight("");
      setEstimatorWeight("");
      setEstimatorReps("");
      notifyProfileChange();
    } catch (err) {
      console.warn("Failed to clear max", err);
      showToast("Unable to sync with Firebase right now.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (coachLoading) {
    return <PageLoadingSkeleton rows={2} />;
  }

  // Shared input class for gym-grade dark fields
  const inputCls =
    "bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 px-3 py-2 text-sm focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick";
  const numericInputCls =
    "bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 font-v2-mono text-lg font-bold text-center px-3 py-3 focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick";

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-8 relative overflow-hidden">
      {/* Atmospheric warm glow — subtle crimson wash under the header */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.18) 0%, transparent 70%)",
        }}
      />

      <ConfirmModal
        isOpen={clearConfirmOpen}
        title="Clear Training Max"
        message={`Are you sure you want to clear your ${lift} max? This cannot be undone.`}
        confirmLabel="Clear"
        onConfirm={() => { setClearConfirmOpen(false); doClear(); }}
        onCancel={() => setClearConfirmOpen(false)}
        variant="danger"
      />

      {/* Header — editorial rule + thin crimson divider */}
      <div className="relative z-10 bg-v2-surface-900/60 backdrop-blur-sm border-b border-v2-surface-800 px-4 py-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center w-11 h-11 rounded-v2-md border border-v2-surface-700 text-v2-ink-300 hover:border-v2-accent-600 hover:text-v2-accent-300 transition-colors duration-v2-quick"
            aria-label="Back to lifts"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                5/3/1
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-2xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none mt-1">
              Training Max
            </h1>
            {targetUid ? (
              <div className="text-v2-ink-400 font-v2-body text-v2-xs uppercase tracking-wide mt-1">
                Viewing: <span className="text-v2-ink-200">{activeAthleteName}</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {isCoach && !targetUid && (
        <div className="relative z-10 mx-4 mt-4 max-w-lg md:mx-auto rounded-v2-md border-l-[3px] border-v2-warn-500 bg-v2-warn-900/30 px-4 py-3 text-v2-sm text-v2-warn-300 font-v2-body">
          No athlete selected. Pick someone from the roster to load their numbers.
        </div>
      )}

      <div className="relative z-10 px-4 py-5 space-y-4 max-w-lg mx-auto">
        {/* Lift Selector — three hard-edge tiles */}
        <div className="grid grid-cols-3 gap-1">
          {lifts.map((l) => {
            const isActive = lift === l;
            return (
              <button
                key={l}
                onClick={() => setLift(l)}
                className={`py-3 font-v2-heading font-bold uppercase tracking-widest text-v2-sm border transition-all duration-v2-quick ${
                  isActive
                    ? "bg-v2-accent-700 border-v2-accent-600 text-v2-ink-50 shadow-v2-elev-1"
                    : "bg-v2-surface-900 border-v2-surface-700 text-v2-ink-400 hover:border-v2-surface-600 hover:text-v2-ink-100"
                }`}
              >
                {l}
              </button>
            );
          })}
        </div>

        {/* Main Calculator Card */}
        <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1">
          {/* Settings Toggle */}
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 border-b border-v2-surface-800 hover:bg-v2-surface-800/60 transition-colors duration-v2-quick"
            onClick={() => setCalcSettingsOpen((prev) => !prev)}
          >
            <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.2em]">
              Settings
            </span>
            <svg
              className={`w-4 h-4 text-v2-ink-500 transition-transform duration-v2-quick ${calcSettingsOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {calcSettingsOpen && (
            <div className="px-4 py-3 bg-v2-surface-950 border-b border-v2-surface-800">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                    Units
                  </span>
                  <select
                    className={inputCls}
                    value={unit}
                    onChange={(e) => handleUnitChange(e.target.value as Unit)}
                  >
                    <option value="lb">Pounds (lb)</option>
                    <option value="kg">Kilograms (kg)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                    Rounding
                  </span>
                  <input
                    className={inputCls}
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
            <label className="flex items-center gap-3 p-3 rounded-v2-sm border border-v2-surface-700 cursor-pointer hover:border-v2-surface-600 transition-colors duration-v2-quick">
              <input
                type="checkbox"
                className="h-5 w-5 rounded-sm bg-v2-surface-800 border-v2-surface-600 text-v2-accent-600 focus:ring-v2-accent-500 focus:ring-offset-v2-surface-900 cursor-pointer"
                checked={useEstimator}
                onChange={(e) => toggleEstimator(e.target.checked)}
              />
              <div>
                <div className="font-v2-body text-v2-sm font-semibold text-v2-ink-100">
                  Rep-Max Estimator
                </div>
                <div className="font-v2-body text-v2-xs text-v2-ink-500">
                  Calculate 1RM from weight × reps
                </div>
              </div>
            </label>

            {useEstimator ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                    Weight ({unit})
                  </span>
                  <input
                    className={numericInputCls}
                    inputMode="decimal"
                    value={estimatorWeight === "" ? "" : estimatorWeight}
                    onChange={(e) => setEstimatorWeight(parseNumeric(e.target.value))}
                    placeholder="200"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                    Reps
                  </span>
                  <input
                    className={numericInputCls}
                    inputMode="numeric"
                    value={estimatorReps === "" ? "" : estimatorReps}
                    onChange={(e) => setEstimatorReps(parseNumeric(e.target.value))}
                    placeholder="5"
                  />
                </label>
              </div>
            ) : (
              <label className="flex flex-col gap-1">
                <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                  Your 1RM ({unit})
                </span>
                <input
                  className="bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 font-v2-mono text-v2-xl font-bold text-center px-3 py-4 focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick"
                  inputMode="decimal"
                  value={measured1rm === "" ? "" : measured1rm}
                  onChange={(e) => setMeasured1rm(parseNumeric(e.target.value))}
                  placeholder={`Enter max in ${unit}`}
                />
              </label>
            )}
          </div>

          {/* Results Section — oversized numerals, the centerpiece */}
          <div className="bg-v2-surface-950 border-t border-v2-surface-800 p-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] font-semibold">
                  Est. 1RM
                </div>
                <div className="font-v2-mono text-v2-3xl font-bold text-v2-ink-50 tabular-nums mt-1">
                  {estimated1rm ? formatNumber(estimated1rm) : "—"}
                </div>
                <div className="font-v2-body text-v2-xs text-v2-ink-600 uppercase tracking-wide">
                  {unit}
                </div>
              </div>
              <div className="text-center border-l border-v2-surface-800">
                <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] font-semibold">
                  Training Max
                </div>
                <div className="font-v2-mono text-v2-3xl font-bold text-v2-accent-400 tabular-nums mt-1">
                  {trainingMax !== null ? trainingMax : "—"}
                </div>
                <div className="font-v2-body text-v2-xs text-v2-ink-600 uppercase tracking-wide">
                  90% • {unit}
                </div>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <div className="p-4 space-y-2 border-t border-v2-surface-800">
            <button
              className="w-full min-h-touch-lg py-4 bg-v2-accent-700 hover:bg-v2-accent-800 active:bg-v2-accent-900 text-v2-ink-50 font-v2-heading text-v2-lg font-bold uppercase tracking-widest transition-all duration-v2-quick disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
              disabled={saving || trainingMax === null}
            >
              {saving ? "Saving..." : `Save ${lift.toUpperCase()} TM`}
            </button>

            {(profile?.tm?.[lift] || profile?.oneRm?.[lift]) && (
              <button
                className="w-full py-2 text-v2-ink-500 font-v2-body text-v2-xs font-semibold uppercase tracking-[0.18em] hover:text-v2-danger-400 transition-colors duration-v2-quick"
                onClick={() => setClearConfirmOpen(true)}
                disabled={saving}
              >
                Clear {lift} Max
              </button>
            )}
          </div>
        </div>

        {/* Plate Calculator - Collapsible */}
        <details
          className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1"
          open={plateCalcOpen}
          onToggle={(e) => setPlateCalcOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-4 py-4 cursor-pointer flex items-center justify-between hover:bg-v2-surface-800/60 transition-colors duration-v2-quick list-none">
            <span className="font-v2-heading font-bold uppercase tracking-widest text-v2-ink-50">
              Plate Calculator
            </span>
            <svg
              className={`w-5 h-5 text-v2-ink-500 transition-transform duration-v2-quick ${plateCalcOpen ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>

          <div className="border-t border-v2-surface-800">
            {/* Quick Actions */}
            <div className="flex gap-2 px-4 py-3 bg-v2-surface-950 border-b border-v2-surface-800">
              <button
                type="button"
                className={`flex-1 py-2 font-v2-body text-v2-xs font-bold uppercase tracking-[0.18em] transition-colors duration-v2-quick border ${
                  trainingMax !== null
                    ? "border-v2-surface-600 text-v2-ink-100 hover:border-v2-accent-500 hover:text-v2-accent-300"
                    : "border-v2-surface-800 text-v2-ink-600 cursor-not-allowed"
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
                className={`flex-1 py-2 font-v2-body text-v2-xs font-bold uppercase tracking-[0.18em] transition-colors duration-v2-quick border ${
                  estimated1rm
                    ? "border-v2-surface-600 text-v2-ink-100 hover:border-v2-accent-500 hover:text-v2-accent-300"
                    : "border-v2-surface-800 text-v2-ink-600 cursor-not-allowed"
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
                className="flex-1 py-2 font-v2-body text-v2-xs font-bold uppercase tracking-[0.18em] border border-v2-surface-600 text-v2-ink-400 hover:border-v2-surface-500 hover:text-v2-ink-100 transition-colors duration-v2-quick"
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
                <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-500 uppercase tracking-[0.18em]">
                  Target Weight ({unit})
                </span>
                <input
                  className={numericInputCls}
                  inputMode="decimal"
                  value={targetWeight === "" ? "" : targetWeight}
                  onChange={(e) => handleTargetWeightChange(e.target.value)}
                  placeholder={unit === "lb" ? "225" : "100"}
                />
              </label>

              <div className="flex justify-between font-v2-body text-v2-xs text-v2-ink-500 mt-2 uppercase tracking-wide">
                <span>Bar: <span className="font-v2-mono text-v2-ink-300 tabular-nums">{formatNumber(activeBarWeight)}</span> {unit}</span>
                <span>Target: <span className="font-v2-mono text-v2-ink-300 tabular-nums">{typeof targetWeight === "number" ? `${formatNumber(targetWeight)} ${unit}` : "—"}</span></span>
              </div>
            </div>

            {/* Plate Visual */}
            <div className="bg-v2-surface-950 p-4">
              <PlateVisual
                unit={unit}
                barWeight={activeBarWeight}
                plates={visualPlates}
                targetWeight={targetWeight}
              />

              {platePlan && platePlan.perSide.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-1 font-v2-body text-v2-xs text-v2-ink-400">
                  {platePlan.perSide.map((row, idx) => (
                    <div key={`${row.weight}-${idx}`} className="flex justify-between px-2">
                      <span className="font-v2-mono tabular-nums">{row.count} × {formatNumber(row.weight)}</span>
                      <span className="text-v2-ink-600 font-v2-mono tabular-nums">{formatNumber(row.weight * row.count)}/side</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Summary */}
            <div className={`px-4 py-3 font-v2-body text-v2-sm font-semibold border-t border-l-[3px] ${
              platePlan
                ? platePlan.isPossible
                  ? "bg-v2-success-900/30 text-v2-success-300 border-v2-surface-800 border-l-v2-success-500"
                  : "bg-v2-danger-900/30 text-v2-danger-300 border-v2-surface-800 border-l-v2-danger-500"
                : "bg-v2-surface-950 text-v2-ink-500 border-v2-surface-800 border-l-v2-surface-700"
            }`}>
              {planSummary}
            </div>
          </div>
        </details>

        {/* Back to Lifts Button */}
        <button
          onClick={() => navigate("/")}
          className="w-full min-h-touch py-4 bg-v2-surface-900 hover:bg-v2-surface-800 border border-v2-surface-700 hover:border-v2-accent-600 text-v2-ink-50 font-v2-heading font-bold uppercase tracking-widest transition-all duration-v2-quick flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Lifts
        </button>
      </div>
    </div>
  );
}
