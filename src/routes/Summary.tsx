import React, { useEffect, useState } from "react";
import {
  defaultEquipment,
  ensureAnon,
  fb,
  loadProfileRemote,
  saveProfile,
  type Profile,
  type Unit,
} from "../lib/db";

type Lift = "bench" | "squat" | "deadlift" | "press";
type Week = 1 | 2 | 3 | 4;

const PCT: Record<Week, Array<[number,string]>> = {
  1: [[0.65,"x5"], [0.75,"x5"], [0.85,"x5+"]],
  2: [[0.70,"x3"], [0.80,"x3"], [0.90,"x3+"]],
  3: [[0.75,"x5"], [0.85,"x3"], [0.95,"x1+"]],
  4: [[0.40,"x5"], [0.50,"x5"], [0.60,"x5"]], // deload
};

function roundWeight(x:number, unit:Unit) {
  // kid-friendly: simple rounding (lbs -> 5s, kg -> 2.5s)
  const step = unit === "lb" ? 5 : 2.5;
  return Math.round(x / step) * step;
}

export default function Summary() {
  const [uid, setUid] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lift, setLift] = useState<Lift>("bench");
  const [week, setWeek] = useState<Week>(1);
  const [tm, setTm] = useState<number | "">( "");

  useEffect(() => {
    (async () => {
      const u = await ensureAnon();
      setUid(u);
      const p = await loadProfileRemote(u);
      setProfile(
        p || {
          uid: u,
          firstName: "",
          lastName: "",
          unit: "lb",
          accessCode: null,
          tm: {},
          oneRm: {},
          equipment: defaultEquipment(),
        }
      );
      const existing = p?.tm?.[lift];
      setTm(existing ?? "");
    })();
  }, []);

  useEffect(() => {
    if (!profile) return;
    const existing = profile?.tm?.[lift];
    setTm(existing ?? "");
  }, [lift]);

  const unit = profile?.unit || "lb";

  const saveTM = async () => {
    if (!profile || tm === "") return;
    const updated: Profile = {
      ...profile,
      tm: { ...(profile.tm || {}), [lift]: Number(tm) }
    };
    await saveProfile(updated);
    setProfile(updated);
  };

  const sets = typeof tm === "number"
    ? PCT[week].map(([p, reps]) => ({
        pct: Math.round(p * 100),
        weight: roundWeight(tm * p, unit),
        reps
      }))
    : [];

  return (
    <div className="container py-6 space-y-6">
      <h1>Quick Summary</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {(["bench","squat","deadlift","press"] as Lift[]).map(k => (
          <button key={k}
            className={`btn ${lift===k ? "btn-primary" : ""}`}
            onClick={() => setLift(k)}>
            {icon(k)} {cap(k)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <div className="btn">Week</div>
        {[1,2,3,4].map(w => (
          <button key={w}
            className={`btn ${week===w ? "btn-primary" : ""}`}
            onClick={() => setWeek(w as Week)}>{w}</button>
        ))}
      </div>

      <div className="card space-y-3">
        <div className="text-lg font-semibold">Training Max</div>
        <div className="flex items-center gap-3">
          <input
            className="border rounded-xl px-3 py-2 w-40"
            type="number" min={0} step="1" value={tm as any}
            onChange={(e)=> setTm(e.target.value==="" ? "" : Number(e.target.value))}
            placeholder={`TM in ${unit}`}
          />
          <button className="btn btn-primary" onClick={saveTM}>Save TM</button>
          <div className="badge">Units: {unit}</div>
        </div>
        <p className="text-sm text-gray-600">
          TM = heavy single you could hit for ~2–3 reps. We’ll do simple math and round plates.
        </p>
      </div>

      {typeof tm === "number" && (
        <div className="grid md:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="mb-2">Warm up ➜ Work sets</h3>
            <ul className="space-y-2">
              {sets.map((s,i) => (
                <li key={i} className="flex items-center justify-between border rounded-xl px-3 py-2">
                  <div className="font-medium">{s.pct}%</div>
                  <div className="text-gray-600">{s.reps}</div>
                  <div className="text-xl font-bold">{s.weight} {unit}</div>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h3 className="mb-2">Coach Tips</h3>
            <ul className="list-disc pl-5 text-sm space-y-1">
              <li>Move fast. Rest 2–3 min on the big sets.</li>
              <li>“+” means stop with 1–2 reps in the tank. No grinders.</li>
              <li>Week 4 is a reset. Easy work → lock in technique.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function cap(s:string){ return s[0].toUpperCase()+s.slice(1); }
function icon(k:Lift){ return {bench:"🧰", squat:"🦵", deadlift:"🧲", press:"🫱"}[k]; }
