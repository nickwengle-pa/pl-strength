import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { fb } from "../lib/db";
import { loadProfile, saveProfile } from "../lib/storage";

type Lift = "bench" | "squat" | "deadlift" | "press";
type Unit = "lb" | "kg";

export default function Calculator() {
  const [unit, setUnit] = useState<Unit>("lb");
  const [tm, setTm] = useState<Record<Lift, number | "">>({
    bench: "", squat: "", deadlift: "", press: ""
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const local = loadProfile();
        if (local?.unit) setUnit(local.unit);
        if (local?.tm) {
          setTm({
            bench: local.tm.bench ?? "",
            squat: local.tm.squat ?? "",
            deadlift: local.tm.deadlift ?? "",
            press: local.tm.press ?? ""
          });
        }
      } catch {}
      try {
        const uid = fb.auth.currentUser?.uid;
        if (!uid) return;
        const snap = await getDoc(doc(fb.db, "athletes", uid, "profile", "meta"));
        if (snap.exists()) {
          const p = snap.data() as any;
          if (p.unit) setUnit(p.unit);
          if (p.tm) {
            setTm({
              bench: p.tm.bench ?? "",
              squat: p.tm.squat ?? "",
              deadlift: p.tm.deadlift ?? "",
              press: p.tm.press ?? ""
            });
          }
        }
      } catch {}
    })();
  }, []);

  function onChange(lift: Lift, val: string) {
    const num = parseFloat(val);
    setTm(prev => ({ ...prev, [lift]: isFinite(num) ? num : "" }));
  }

  async function onSave() {
    const uid = fb.auth.currentUser?.uid;
    if (!uid) return alert("Not signed in.");
    setSaving(true);
    const payload = {
      unit,
      tm: {
        bench: typeof tm.bench === "number" ? tm.bench : 0,
        squat: typeof tm.squat === "number" ? tm.squat : 0,
        deadlift: typeof tm.deadlift === "number" ? tm.deadlift : 0,
        press: typeof tm.press === "number" ? tm.press : 0
      }
    };
    try { saveProfile(payload as any); } catch {}
    await setDoc(doc(fb.db, "athletes", uid, "profile", "meta"), payload, { merge: true });
    setSaving(false);
    alert("Training Max saved.");
  }

  function pctOf(val: number | "", pct: number) {
    if (typeof val !== "number" || !isFinite(val)) return "";
    return Math.round(val * pct);
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-lg font-semibold">Calculator — Training Max</h3>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <label className="text-sm">Units</label>
        <select className="border rounded-xl px-2 py-1" value={unit} onChange={e => setUnit(e.target.value as Unit)}>
          <option value="lb">lb</option>
          <option value="kg">kg</option>
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">Lift</th>
              <th className="p-2 text-left">TM ({unit})</th>
              <th className="p-2 text-left">65%</th>
              <th className="p-2 text-left">75%</th>
              <th className="p-2 text-left">85%</th>
              <th className="p-2 text-left">90%</th>
              <th className="p-2 text-left">95%</th>
            </tr>
          </thead>
          <tbody>
            {(["bench", "squat", "deadlift", "press"] as Lift[]).map(l => (
              <tr key={l} className="border-t">
                <td className="p-2 capitalize">{l}</td>
                <td className="p-2">
                  <input
                    className="border rounded px-2 py-1 w-28"
                    value={tm[l] as any}
                    onChange={e => onChange(l, e.target.value)}
                    placeholder="e.g., 200"
                  />
                </td>
                <td className="p-2">{pctOf(tm[l], 0.65)}</td>
                <td className="p-2">{pctOf(tm[l], 0.75)}</td>
                <td className="p-2">{pctOf(tm[l], 0.85)}</td>
                <td className="p-2">{pctOf(tm[l], 0.90)}</td>
                <td className="p-2">{pctOf(tm[l], 0.95)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button className="btn-primary" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save Training Max"}
      </button>
    </div>
  );
}
