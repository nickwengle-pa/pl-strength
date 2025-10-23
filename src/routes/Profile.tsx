import React, { useEffect, useState } from "react";
import { ensureAnon, loadProfileRemote, saveProfile } from "../lib/db";
import type { Profile as ProfileModel, Unit, Team } from "../lib/db";

export default function ProfilePage() {
  const [p, setP] = useState<ProfileModel | null>(null);
  const [uid, setUid] = useState<string>("");

  useEffect(() => {
    (async () => {
      const u = await ensureAnon();
      setUid(u);
      const existing = await loadProfileRemote(u);
      setP(existing || { uid: u, firstName: "", lastName: "", unit: "lb" });
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

        <button className="btn btn-primary" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
