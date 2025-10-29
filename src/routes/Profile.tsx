import React, { useEffect, useState } from "react";
import {
  defaultEquipment,
  ensureAnon,
  loadProfileRemote,
  saveProfile,
  type Profile as ProfileModel,
  type Unit,
  type Team,
} from "../lib/db";

export default function ProfilePage() {
  const [p, setP] = useState<ProfileModel | null>(null);
  const [uid, setUid] = useState<string>("");

  useEffect(() => {
    (async () => {
      const u = await ensureAnon();
      setUid(u);
      const existing = await loadProfileRemote(u);
      setP(
        existing || {
          uid: u,
          firstName: "",
          lastName: "",
          unit: "lb",
          accessCode: null,
          tm: {},
          equipment: defaultEquipment(),
        }
      );
    })();
  }, []);

  const update = (patch: Partial<ProfileModel>) =>
    setP(prev => ({ ...(prev as ProfileModel), ...(patch as any) }));

  const save = async () => {
    if (!p) return;
    await saveProfile(p);
    alert("Saved.");
  };

  if (!p) return null;

  return (
    <div className="container py-6 space-y-4">
      <h1>Profile</h1>
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
              onChange={e => update({ team: e.target.value as Team })}
            >
              <option value="">—</option>
              <option value="JH">JH</option>
              <option value="Varsity">Varsity</option>
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

        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
