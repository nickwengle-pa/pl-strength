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

export default function ProfilePage() {
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
      
      // Show onboarding if user has no TM set (first-time user)
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

  if (!p) return null;

  const heightUnit = p.unit === "kg" ? "cm" : "in";
  const createdOn = p.createdAt ? new Date(p.createdAt).toLocaleString() : "Not Available";

  return (
    <div className="container py-6 space-y-4">
      {showOnboarding && (
        <OnboardingWizard onComplete={handleOnboardingComplete} unit={p.unit} />
      )}
      
      <h1>Profile</h1>
      
      <button
        onClick={() => setShowOnboarding(true)}
        className="text-sm text-brand-600 hover:text-brand-700 underline"
      >
        📖 Show Tutorial Again
      </button>
      
      <div className="card space-y-4">
        <div className="text-sm text-gray-600">
          UID: <code>{uid}</code>
        </div>
        <div className="text-sm text-gray-600">
          Created: <span className="font-medium text-gray-900">{createdOn}</span>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First Name</span>
            <input
              className="border rounded-xl px-3 py-2"
              value={p.firstName}
              onChange={e => update({ firstName: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Last Name</span>
            <input
              className="border rounded-xl px-3 py-2"
              value={p.lastName}
              onChange={e => update({ lastName: e.target.value })}
            />
          </label>
        </div>

        <div className="flex items-center gap-6">
          <div>
            <div className="text-sm font-medium mb-1">Units</div>
            <div className="flex items-center gap-3">
              {(["lb", "kg"] as Unit[]).map(u => (
                <label key={u} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="unit"
                    checked={p.unit === u}
                    onChange={() => update({ unit: u })}
                  />
                  {u}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Team</div>
            <select

              className="border rounded-xl px-3 py-2"

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
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Height ({heightUnit})</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.height ?? ""}
                onChange={(e) =>
                  update({ height: parseOptionalNumber(e.target.value) })
                }
                placeholder={heightUnit === "in" ? "e.g., 70" : "e.g., 178"}
              />
            </label>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Weight ({p.unit})</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.weight ?? ""}
                onChange={(e) =>
                  update({ weight: parseOptionalNumber(e.target.value) })
                }
                placeholder={p.unit === "lb" ? "e.g., 180" : "e.g., 82"}
              />
            </label>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Graduation Year</span>
              <input
                className="border rounded-xl px-3 py-2"
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

        {/* Athletic Combine Metrics */}
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3 space-y-3">
          <div className="text-sm font-semibold text-blue-900">Combine Metrics</div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">40-Yard Dash (sec)</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.dash40 ?? ""}
                onChange={(e) => update({ dash40: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 4.52"
              />
            </label>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Bench Press Reps</span>
              <div className="flex gap-2">
                <select
                  className="border rounded-xl px-3 py-2 flex-shrink-0"
                  value={p.benchRepsWeight ?? 185}
                  onChange={(e) => update({ benchRepsWeight: Number(e.target.value) })}
                >
                  <option value={135}>135 lb</option>
                  <option value={185}>185 lb</option>
                  <option value={225}>225 lb</option>
                </select>
                <input
                  className="border rounded-xl px-3 py-2 w-full"
                  inputMode="numeric"
                  value={p.benchReps ?? ""}
                  onChange={(e) => update({ benchReps: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Reps"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Broad Jump</span>
              <div className="flex gap-2 items-center">
                <input
                  className="border rounded-xl px-3 py-2 w-full"
                  inputMode="numeric"
                  value={p.broadJumpFt ?? ""}
                  onChange={(e) => update({ broadJumpFt: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Feet"
                />
                <span className="text-sm text-gray-500 flex-shrink-0">ft</span>
                <input
                  className="border rounded-xl px-3 py-2 w-full"
                  inputMode="numeric"
                  value={p.broadJumpIn ?? ""}
                  onChange={(e) => update({ broadJumpIn: parseOptionalNumber(e.target.value, { integer: true }) })}
                  placeholder="Inches"
                />
                <span className="text-sm text-gray-500 flex-shrink-0">in</span>
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Vertical Jump (inches)</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.verticalJump ?? ""}
                onChange={(e) => update({ verticalJump: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 28.5"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">3-Cone Drill (sec)</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.threeCone ?? ""}
                onChange={(e) => update({ threeCone: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 7.04"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Shuttle Run (sec)</span>
              <input
                className="border rounded-xl px-3 py-2"
                inputMode="decimal"
                value={p.shuttle ?? ""}
                onChange={(e) => update({ shuttle: parseOptionalNumber(e.target.value) })}
                placeholder="e.g., 4.14"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <div className="font-semibold">Sign-In Code</div>
          <div className="mt-1 font-mono text-base text-gray-900">
            {p.accessCode ?? "-"}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Coaches Assign Unique Codes To Each Athlete. Ask A Coach If You Need Yours Reset.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-sm text-gray-600">
              Last Saved: {new Date(lastSaved).toLocaleTimeString()}
            </span>
          )}
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>

      {/* Lift Progress Charts */}
      <AllLiftsProgressCharts unit={p.unit} />
    </div>
  );
}
