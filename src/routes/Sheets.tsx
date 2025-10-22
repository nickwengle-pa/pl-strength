import React, { useEffect, useState } from 'react';
import { loadProfile, saveProfile } from '../lib/storage';
import { loadProfileRemote } from '../lib/db';
import { buildPlan, savePlan, PlanRow } from '../lib/plan';

type Lift = 'bench'|'squat'|'deadlift'|'press';
type Week = 1|2|3|4;

export default function Sheets() {
  const [lift, setLift] = useState<Lift>('bench');
  const [week, setWeek] = useState<Week>(1);
  const [unit, setUnit] = useState<'lb'|'kg'>('lb');
  const [tm, setTm] = useState<number | ''>('');
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const remote = await loadProfileRemote();
      const local = loadProfile();
      const p = remote || local;
      if (p) {
        const u = (p.unit || 'lb') as 'lb'|'kg';
        setUnit(u);
        const val = p.tm?.[lift];
        if (typeof val === 'number') setTm(val);
      }
    })();
  }, [lift]);

  useEffect(() => {
    if (typeof tm === 'number' && tm > 0) setRows(buildPlan(lift, week, unit, tm));
    else setRows([]);
  }, [lift, week, unit, tm]);

  const canPrint = rows.length > 0;

  async function onSavePlan() {
    if (!canPrint || typeof tm !== 'number') return;
    setSaving(true);
    await savePlan({ lift, week, unit, tm, rows });
    setSaving(false);
    alert('Plan saved to your account.');
  }

  function onPrint() { window.print(); }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <h3 className="text-lg font-semibold">Printable / Fillable Sheets</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <label className="text-sm">Lift</label>
          <select className="border rounded-xl px-2 py-1" value={lift} onChange={e=>setLift(e.target.value as Lift)}>
            <option value="bench">Bench</option>
            <option value="squat">Squat</option>
            <option value="deadlift">Deadlift</option>
            <option value="press">Press</option>
          </select>

          <label className="text-sm">Week</label>
          <select className="border rounded-xl px-2 py-1" value={week} onChange={e=>setWeek(parseInt(e.target.value) as Week)}>
            <option value={1}>Week 1</option>
            <option value={2}>Week 2</option>
            <option value={3}>Week 3</option>
            <option value={4}>Deload</option>
          </select>

          <label className="text-sm">Units</label>
          <div className="text-sm">{unit}</div>

          <label className="text-sm">Training Max</label>
          <input className="border rounded-xl px-2 py-1" type="number" value={tm} onChange={e=>setTm(parseFloat(e.target.value)||'')} placeholder="e.g., 225" />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm print:w-full border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">% of TM</th>
                <th className="text-left p-2">Weight ({unit})</th>
                <th className="text-left p-2">Target Reps</th>
                <th className="text-left p-2">Actual Reps</th>
                <th className="text-left p-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i)=> (
                <tr key={i} className="border-t">
                  <td className="p-2">{r.kind}</td>
                  <td className="p-2">{Math.round(r.pct*100)}%</td>
                  <td className="p-2 font-semibold">{r.weight}</td>
                  <td className="p-2">{r.targetReps}{(week!==4 && r.kind==='work' && i===rows.length-1)?'+':''}</td>
                  <td className="p-2"><input className="border rounded px-2 py-1 w-24" placeholder="—" /></td>
                  <td className="p-2"><input className="border rounded px-2 py-1 w-full" placeholder="form cues, RPE…" /></td>
                </tr>
              ))}
              {rows.length===0 && (
                <tr><td className="p-2 text-gray-500" colSpan={6}>Enter a Training Max to generate your sheet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex gap-2">
          <button className="btn-secondary" onClick={onPrint} disabled={!canPrint}>Print / Save as PDF</button>
          <button className="btn-primary" onClick={onSavePlan} disabled={!canPrint || saving}>{saving?'Saving…':'Save to My Account'}</button>
        </div>
      </div>

      <div className="card print:hidden">
        <h4 className="font-semibold mb-1 text-sm">Fillable behavior</h4>
        <div className="text-sm">These inputs render on your printed PDF. Click “Save to My Account” to persist data online.</div>
      </div>
    </div>
  );
}
