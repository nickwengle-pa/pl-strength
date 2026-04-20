import React, { useEffect, useState } from "react";
import {
  TEAM_DEFINITIONS,
  defaultEquipment,
  ensureAnon,
  loadProfileRemote,
  saveProfile,
  type Profile as ProfileModel,
  type Unit,
  type Team,
} from "../lib/db";
import OnboardingWizard from "../components/OnboardingWizard";
import { AllLiftsProgressCharts } from "../components/LiftProgressChart";
import { useToast } from "../context/ToastContext";

export default function ProfileV2() {
  const showToast = useToast();
  const [p, setP] = useState<ProfileModel | null>(null);
  const [uid, setUid] = useState<string>("");
  const [showOnboarding, setShowOnboarding] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const u = await ensureAnon();
      setUid(u);
      const existing = await loadProfileRemote(u);
      const profile = existing || {
        uid: u,
        firstName: "",
        lastName: "",
        unit: "lb",
        accessCode: null,
        tm: {},
        oneRm: {},
        equipment: defaultEquipment(),
      };
      setP(profile);

      const hasSkippedOnboarding = localStorage.getItem("pl-onboarding-skipped");
      const hasTM = profile.tm && Object.keys(profile.tm).length > 0;
      if (!hasTM && !hasSkippedOnboarding) {
        setShowOnboarding(true);
      }
    })();
  }, []);

  const update = (patch: Partial<ProfileModel>) =>
    setP(prev => ({ ...(prev as ProfileModel), ...(patch as any) }));

  const parseOptionalNumber = (
    value: string,
    options: { integer?: boolean } = {}
  ): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return undefined;
    return options.integer ? Math.floor(parsed) : parsed;
  };

  const save = async () => {
    if (!p) return;
    try {
      await saveProfile(p, { requireRemote: true });
      setLastSaved(Date.now());
      showToast("Profile saved.", "success");
    } catch (err) {
      console.warn("Failed to save profile", err);
      showToast("Could not sync profile right now. Check connection and try again.", "error");
    }
  };

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem("pl-onboarding-skipped", "true");
  };

  if (!p) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  const heightUnit = p.unit === "kg" ? "cm" : "in";
  const createdOn = p.createdAt ? new Date(p.createdAt).toLocaleString() : "Not Available";

  // Shared dark field styling
  const fieldCls =
    "bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 font-v2-body rounded-v2-sm px-3 py-2 text-v2-base focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick placeholder:text-v2-ink-600";
  const labelCls =
    "font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.18em]";
  const sectionCardCls =
    "bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md shadow-v2-elev-1";

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-12 relative overflow-hidden">
      {/* Atmospheric crimson wash */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.15) 0%, transparent 70%)",
        }}
      />

      {showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} unit={p.unit} />
      )}

      <div className="relative z-10 max-w-3xl mx-auto px-gutter-mobile md:px-6 py-6 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="h-px w-7 bg-v2-accent-700" />
            <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
              Account
            </span>
          </div>
          <div className="flex items-end justify-between gap-3 flex-wrap">
            <h1 className="font-v2-heading text-v2-3xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none">
              Profile
            </h1>
            <button
              onClick={() => setShowOnboarding(true)}
              className="font-v2-body text-v2-xs text-v2-accent-300 hover:text-v2-accent-200 uppercase tracking-[0.18em] font-semibold underline underline-offset-4 decoration-v2-accent-700 hover:decoration-v2-accent-500 transition-colors duration-v2-quick"
            >
              Show Tutorial Again
            </button>
          </div>
        </div>

        {/* Identity card */}
        <div className={`${sectionCardCls} p-4 space-y-4`}>
          <div className="grid gap-2 sm:grid-cols-2 text-v2-xs font-v2-body">
            <div className="text-v2-ink-500 uppercase tracking-[0.18em]">
              <span className="font-semibold">UID</span>
              <div className="mt-1 font-v2-mono text-v2-ink-300 normal-case tracking-normal break-all">
                {uid}
              </div>
            </div>
            <div className="text-v2-ink-500 uppercase tracking-[0.18em]">
              <span className="font-semibold">Created</span>
              <div className="mt-1 font-v2-body text-v2-ink-200 normal-case tracking-normal">
                {createdOn}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>First Name</span>
              <input
                className={fieldCls}
                value={p.firstName}
                onChange={e => update({ firstName: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Last Name</span>
              <input
                className={fieldCls}
                value={p.lastName}
                onChange={e => update({ lastName: e.target.value })}
              />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 pt-2">
            <div>
              <div className={`${labelCls} mb-2`}>Units</div>
              <div className="flex items-center gap-2">
                {(["lb", "kg"] as Unit[]).map(u => {
                  const active = p.unit === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      onClick={() => update({ unit: u })}
                      className={`flex-1 min-h-touch py-2 font-v2-heading font-bold uppercase tracking-widest text-v2-sm border rounded-v2-sm transition-colors duration-v2-quick ${
                        active
                          ? "bg-v2-accent-700 border-v2-accent-600 text-v2-ink-50"
                          : "bg-v2-surface-900 border-v2-surface-700 text-v2-ink-400 hover:border-v2-surface-600 hover:text-v2-ink-100"
                      }`}
                    >
                      {u}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Team</span>
              <select
                className={fieldCls}
                value={p.team || ""}
                onChange={(e) => update({ team: e.target.value as Team })}
              >
                <option value="">Select Team</option>
                {TEAM_DEFINITIONS.map((definition) => (
                  <option key={definition.id} value={definition.id}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* Measurements */}
        <div className={sectionCardCls}>
          <div className="px-4 py-3 border-b border-v2-surface-800">
            <div className="flex items-center gap-2">
              <div className="h-px w-5 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-[0.22em] font-semibold">
                Measurements
              </span>
            </div>
          </div>
          <div className="p-4 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Height ({heightUnit})</span>
              <input
                className={fieldCls}
                inputMode="decimal"
                value={p.height ?? ""}
                onChange={(e) =>
                  update({ height: parseOptionalNumber(e.target.value) })
                }
                placeholder={heightUnit === "in" ? "e.g., 70" : "e.g., 178"}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Weight ({p.unit})</span>
              <input
                className={fieldCls}
                inputMode="decimal"
                value={p.weight ?? ""}
                onChange={(e) =>
                  update({ weight: parseOptionalNumber(e.target.value) })
                }
                placeholder={p.unit === "lb" ? "e.g., 180" : "e.g., 82"}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Graduation Year</span>
              <input
                className={fieldCls}
                inputMode="numeric"
                value={p.graduationYear ?? ""}
                onChange={(e) =>
                  update({ graduationYear: parseOptionalNumber(e.target.value, { integer: true }) })
                }
                placeholder="e.g., 2026"
              />
            </label>
          </div>
        </div>

        {/* Combine Metrics */}
        <div className={sectionCardCls}>
          <div className="px-4 py-3 border-b border-v2-surface-800">
            <div className="flex items-center gap-2">
              <div className="h-px w-5 bg-v2-info-600" />
              <span className="font-v2-body text-v2-xs text-v2-info-300 uppercase tracking-[0.22em] font-semibold">
                Combine Metrics
              </span>
            </div>
          </div>
          <div className="p-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>40-Yard Dash (sec)</span>
              <input
                className={`${fieldCls} font-v2-mono tabular-nums`}
                inputMode="decimal"
                value={p.dash40 ?? ""}
                onChange={(e) => update({ dash40: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 4.52"
              />
            </label>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>Bench Press Reps</span>
              <div className="flex gap-2">
                <select
                  className={`${fieldCls} flex-shrink-0`}
                  value={p.benchRepsWeight ?? 185}
                  onChange={(e) => update({ benchRepsWeight: Number(e.target.value) })}
                >
                  <option value={135}>135 lb</option>
                  <option value={185}>185 lb</option>
                  <option value={225}>225 lb</option>
                </select>
                <input
                  className={`${fieldCls} w-full font-v2-mono tabular-nums`}
                  inputMode="numeric"
                  value={p.benchReps ?? ""}
                  onChange={(e) => update({ benchReps: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Reps"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>Broad Jump</span>
              <div className="flex gap-2 items-center">
                <input
                  className={`${fieldCls} w-full font-v2-mono tabular-nums`}
                  inputMode="numeric"
                  value={p.broadJumpFt ?? ""}
                  onChange={(e) => update({ broadJumpFt: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Feet"
                />
                <span className="text-v2-xs font-v2-body text-v2-ink-500 uppercase tracking-wide flex-shrink-0">ft</span>
                <input
                  className={`${fieldCls} w-full font-v2-mono tabular-nums`}
                  inputMode="numeric"
                  value={p.broadJumpIn ?? ""}
                  onChange={(e) => update({ broadJumpIn: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Inches"
                />
                <span className="text-v2-xs font-v2-body text-v2-ink-500 uppercase tracking-wide flex-shrink-0">in</span>
              </div>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Vertical Jump (inches)</span>
              <input
                className={`${fieldCls} font-v2-mono tabular-nums`}
                inputMode="decimal"
                value={p.verticalJump ?? ""}
                onChange={(e) => update({ verticalJump: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 28.5"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>3-Cone Drill (sec)</span>
              <input
                className={`${fieldCls} font-v2-mono tabular-nums`}
                inputMode="decimal"
                value={p.threeCone ?? ""}
                onChange={(e) => update({ threeCone: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 7.04"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelCls}>Shuttle Run (sec)</span>
              <input
                className={`${fieldCls} font-v2-mono tabular-nums`}
                inputMode="decimal"
                value={p.shuttle ?? ""}
                onChange={(e) => update({ shuttle: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 4.14"
              />
            </label>
          </div>
        </div>

        {/* Sign-In Code */}
        <div className={`${sectionCardCls} p-4`}>
          <div className="flex items-center gap-2 mb-2">
            <div className="h-px w-5 bg-v2-accent-700" />
            <span className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-[0.22em] font-semibold">
              Sign-In Code
            </span>
          </div>
          <div className="font-v2-mono text-v2-2xl font-bold text-v2-ink-50 tabular-nums tracking-[0.3em]">
            {p.accessCode ?? "—"}
          </div>
          <p className="mt-2 font-v2-body text-v2-xs text-v2-ink-500">
            Coaches assign unique codes to each athlete. Ask a coach if you need yours reset.
          </p>
        </div>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          {lastSaved && (
            <span className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wide">
              Last Saved: <span className="font-v2-mono text-v2-ink-200 tabular-nums normal-case">{new Date(lastSaved).toLocaleTimeString()}</span>
            </span>
          )}
          <button
            className="ml-auto min-h-touch-lg px-8 py-3 bg-v2-accent-700 hover:bg-v2-accent-800 active:bg-v2-accent-900 text-v2-ink-50 font-v2-heading text-v2-base font-bold uppercase tracking-widest transition-all duration-v2-quick rounded-v2-sm"
            onClick={save}
          >
            Save
          </button>
        </div>

        {/* Progress Charts */}
        <div className="pt-4">
          <AllLiftsProgressCharts unit={p.unit} />
        </div>
      </div>
    </div>
  );
}
