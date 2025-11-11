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

export default function ProfilePage() {
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

  const save = async () => {
    if (!p) return;
    await saveProfile(p);
    setLastSaved(Date.now());
    alert("Saved.");
  };
  
  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    localStorage.setItem("pl-onboarding-skipped", "true");
  };

  if (!p) return null;

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

        <div className="grid md:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">First name</span>
            <input
              className="border rounded-xl px-3 py-2"
              value={p.firstName}
              onChange={e => update({ firstName: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Last name</span>
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

              <option value="">Select team</option>

              {TEAM_DEFINITIONS.map((definition) => (

                <option key={definition.id} value={definition.id}>

                  {definition.label}

                </option>

              ))}

            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          <div className="font-semibold">Sign-in code</div>
          <div className="mt-1 font-mono text-base text-gray-900">
            {p.accessCode ?? "-"}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Coaches assign unique codes to each athlete. Ask a coach if you need yours reset.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-sm text-gray-600">
              Last saved: {new Date(lastSaved).toLocaleTimeString()}
            </span>
          )}
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
