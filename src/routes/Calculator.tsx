
import { useEffect, useState } from 'react';
import { estimate1RM, trainingMax, warmupPercents, weekPercents, roundToPlate } from '../lib/tm';
import { loadProfile, saveProfile } from '../lib/storage';
import { saveProfileRemote, loadProfileRemote } from '../lib/db';

type Week = 1|2|3|4;

export default function Calculator() {
  const [lift, setLift] = useState<'bench'|'squat'|'deadlift'|'press'>('bench');
  const [unit, setUnit] = useState<'lb'|'kg'>('lb');
  const [base, setBase] = useState<number>(135);
  const [useRepMax, setUseRepMax] = useState(false);
  const [repWeight, setRepWeight] = useState(135);
  const [reps, setReps] = useState(5);
  const [week, setWeek] = useState<Week>(1);
  const [step, setStep] = useState(5);

  // Load from remote (if available) then local fallback
  useEffect(() => {
    (async () => {
      const remote = await loadProfileRemote();
      const local = loadProfile();
      const p = remote || local;
      if (p) {
        setUnit(p.unit || 'lb');
        setStep((p.unit||'lb')==='lb' ? 5 : 2.5);
        const oneRM = p.tm?.[lift] ? Math.round((p.tm![lift] as number)/0.9) : undefined;
        setBase(oneRM || 135);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lift]);

  const oneRM = useRepMax ? estimate1RM(repWeight, reps) : base;
  const tm = trainingMax(oneRM);

  const warmups = warmupPercents().map(p=> roundToPlate(tm*p, unit, step));
  const work = weekPercents(week).map(p=> roundToPlate(tm*p, unit, step));

  async function saveTM() {
    // persist locally
    const local = loadProfile() || { firstName: 'Athlete', unit, tm: {} as any };
    local.firstName = local.firstName || 'Athlete';
    local.unit = unit;
    local.tm = { ...(local.tm||{}), [lift]: tm };
    saveProfile(local as any);

    // try remote
    await saveProfileRemote(local as any).catch(()=>{});

    alert(`Saved TM for ${lift.toUpperCase()}: ${tm} ${unit}`);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="card">
        <h3 className="text-lg font-semibold mb-2">Training Max Calculator</h3>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Lift</label>
            <select className="border rounded-xl px-2 py-1" value={lift} onChange={e=>setLift(e.target.value as any)}>
              <option value="bench">Bench</option>
              <option value="squat">Squat</option>
              <option value="deadlift">Deadlift</option>
              <option value="press">Press</option>
            </select>

            <label className="text-sm">Units</label>
            <select className="border rounded-xl px-2 py-1" value={unit} onChange={e=>{const u=e.target.value as any; setUnit(u); setStep(u==='lb'?5:2.5);}}>
              <option value="lb">lb</option>
              <option value="kg">kg</option>
            </select>

            <label className="text-sm">Plate rounding step</label>
            <input className="border rounded-xl px-2 py-1" type="number" step="0.5" value={step} onChange={e=>setStep(parseFloat(e.target.value||'0')|| (unit==='lb'?5:2.5))} />
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={useRepMax} onChange={(e)=>setUseRepMax(e.target.checked)} />
              Use rep-max estimator
            </label>
          </div>

          {!useRepMax && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Measured 1RM</label>
              <input className="border rounded-xl px-2 py-1" type="number" value={base} onChange={e=>setBase(parseFloat(e.target.value||'0'))} />
            </div>
          )}

          {useRepMax && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Set weight</label>
              <input className="border rounded-xl px-2 py-1" type="number" value={repWeight} onChange={e=>setRepWeight(parseFloat(e.target.value||'0'))} />
              <label className="text-sm">Reps</label>
              <input className="border rounded-xl px-2 py-1" type="number" value={reps} onChange={e=>setReps(parseInt(e.target.value||'0')||0)} />
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-xl border">
            <div className="text-sm">Estimated 1RM</div>
            <div className="text-2xl font-bold">{oneRM.toFixed(1)} {unit}</div>
            <div className="text-sm mt-2">Training Max (90%): <b>{tm} {unit}</b></div>
          </div>

          <button className="btn-primary" onClick={saveTM}>Save as TM for this lift</button>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold mb-2">Week Table</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-sm">Week</label>
          <select className="border rounded-xl px-2 py-1" value={week} onChange={e=>setWeek(parseInt(e.target.value) as Week)}>
            <option value={1}>Week 1 (65/75/85)</option>
            <option value={2}>Week 2 (70/80/90)</option>
            <option value={3}>Week 3 (75/85/95)</option>
            <option value={4}>Deload (40/50/60)</option>
          </select>
        </div>
        <div className="mt-3">
          <div className="text-sm font-medium mb-1">Warm-ups</div>
          <ul className="list-disc pl-5 text-sm">
            {warmups.map((w,i)=>(<li key={i}>{['40%','50%','60%'][i]} → <b>{w} {unit}</b> × {i<2?5:3}</li>))}
          </ul>
          <div className="text-sm font-medium mt-3 mb-1">Work sets</div>
          <ul className="list-disc pl-5 text-sm">
            {work.map((w,i)=>{
              const pct = (week===1?[65,75,85]:week===2?[70,80,90]:week===3?[75,85,95]:[40,50,60])[i];
              const reps = week===1?5:week===2?([3,3,3][i]):week===3?([5,3,1][i]):5;
              const plus = (week!==4 && i===2) ? '+' : '';
              return (<li key={i}>{pct}% → <b>{w} {unit}</b> × {reps}{plus}</li>);
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
