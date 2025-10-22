import { useEffect, useMemo, useState } from 'react';
import { estimate1RM, warmupPercents, weekPercents, roundToPlate } from '../lib/tm';
import { loadProfile } from '../lib/storage';
import { loadProfileRemote, saveSession, bestEst1RM, recentSessions } from '../lib/db';
import CoachTips from '../components/CoachTips';
import TrendMini from '../components/TrendMini';

type Lift = 'bench'|'squat'|'deadlift'|'press';
type Week = 1|2|3|4;

export default function Session() {
  const [lift, setLift] = useState<Lift>('bench');
  const [week, setWeek] = useState<Week>(1);
  const [unit, setUnit] = useState<'lb'|'kg'>('lb');
  const [tm, setTm] = useState<number | null>(null);
  const [step, setStep] = useState(5);
  const [amrapReps, setAmrapReps] = useState<number>(0);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [est, setEst] = useState<number | null>(null);
  const [prFlag, setPrFlag] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      const remote = await loadProfileRemote();
      const local = loadProfile();
      const p = remote || local;
      if (p) {
        const u = (p.unit || 'lb') as 'lb'|'kg';
        setUnit(u);
        setStep(u==='lb' ? 5 : 2.5);
        const tmForLift = p.tm?.[lift] ?? null;
        setTm(tmForLift ?? null);
      } else {
        setTm(null);
      }
    })();
  }, [lift]);

  const warm = useMemo(() => {
    if (!tm) return [];
    return warmupPercents().map((pct, i)=>({
      pct, weight: roundToPlate(tm*pct, unit, step), reps: i<2?5:3
    }));
  }, [tm, unit, step]);

  const work = useMemo(() => {
    if (!tm) return [];
    const pcts = weekPercents(week);
    const repScheme = week===1?[5,5,5]:week===2?[3,3,3]:week===3?[5,3,1]:[5,5,5];
    return pcts.map((pct, i)=>({
      pct, weight: roundToPlate(tm*pct, unit, step), reps: repScheme[i]
    }));
  }, [tm, unit, step, week]);

  const lastWorkWeight = work[2]?.weight || 0;
  useEffect(() => {
    if (!tm || work.length===0 || amrapReps<=0 || week===4) { setEst(null); return; }
    const last = lastWorkWeight;
    setEst(+estimate1RM(last, amrapReps).toFixed(1));
  }, [amrapReps, work, tm, week, lastWorkWeight]);

  useEffect(() => {
    (async () => {
      const rows = await recentSessions(lift, 12);
      setHistory(rows.reverse());
    })();
  }, [lift]);

  async function save() {
    if (week === 4) {
      alert('Deload week: no AMRAP logging.');
      return;
    }
    if (!tm || work.length===0 || amrapReps<=0) {
      alert('Set a Training Max and enter AMRAP reps.');
      return;
    }
    setSaving(true);
    const last = lastWorkWeight;
    const est1rm = +estimate1RM(last, amrapReps).toFixed(1);
    const best = await bestEst1RM(lift, 20);
    const pr = est1rm > best;

    await saveSession({
      lift, week, unit, tm,
      warmups: warm,
      work: work,
      amrap: { weight: last, reps: amrapReps },
      est1rm,
      note,
      pr
    });

    setSaving(false);
    setPrFlag(pr);
    setEst(est1rm);

    const rows = await recentSessions(lift, 12);
    setHistory(rows.reverse());
    alert(pr ? `Saved. PR! New est 1RM ${est1rm} ${unit}` : `Saved. est 1RM ${est1rm} ${unit}`);
  }

  const estSeries = history.map(h => h.est1rm).filter((x:number)=>typeof x==='number' && !isNaN(x));
  const prevBest = estSeries.length ? Math.max(...estSeries) : 0;

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 space-y-3">
        <div className="card space-y-3">
          <h3 className="text-lg font-semibold">Train — {lift.toUpperCase()}</h3>

          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm">Lift</label>
            <select className="border rounded-xl px-2 py-1" value={lift} onChange={e=>setLift(e.target.value as Lift)}>
              <option value="bench">Bench</option>
              <option value="squat">Squat</option>
              <option value="deadlift">Deadlift</option>
              <option value="press">Press</option>
            </select>

            <label className="text-sm">Week</label>
            <select className="border rounded-xl px-2 py-1" value={week} onChange={e=>setWeek(parseInt(e.target.value) as Week)}>
              <option value={1}>Week 1 (65/75/85)</option>
              <option value={2}>Week 2 (70/80/90)</option>
              <option value={3}>Week 3 (75/85/95)</option>
              <option value={4}>Deload (40/50/60)</option>
            </select>

            <label className="text-sm">Units</label>
            <div className="text-sm">{unit}</div>

            <label className="text-sm">Training Max</label>
            <div className="text-sm">{tm ?? '— set TM in Calculator'}</div>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Warm-ups</div>
            <ul className="list-disc pl-5 text-sm">
              {warm.map((w,i)=>(<li key={i}>{Math.round(w.pct*100)}% → <b>{w.weight} {unit}</b> × {w.reps}</li>))}
              {warm.length===0 && <li className="text-gray-500">No TM set yet.</li>}
            </ul>
          </div>

          <div>
            <div className="text-sm font-medium mb-1">Work sets</div>
            <ul className="list-disc pl-5 text-sm">
              {work.map((w,i)=>{
                const plus = (week!==4 && i===2) ? '+' : '';
                return (<li key={i}>{Math.round(w.pct*100)}% → <b>{w.weight} {unit}</b> × {w.reps}{plus}</li>);
              })}
            </ul>
          </div>

          {week!==4 && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm">Last set AMRAP reps</label>
              <input className="border rounded-xl px-2 py-1" type="number" value={amrapReps} onChange={e=>setAmrapReps(parseInt(e.target.value||'0')||0)} />
              <label className="text-sm">Notes</label>
              <input className="border rounded-xl px-2 py-1" value={note} onChange={e=>setNote(e.target.value)} placeholder="form cues, RPE, etc." />
            </div>
          )}

          <div className="p-3 bg-gray-50 rounded-xl border">
            <div className="text-sm">Estimated 1RM</div>
            <div className="text-2xl font-bold">{est ? `${est} ${unit}` : '—'}</div>
            {prFlag && <div className="text-sm text-green-700">🔥 New PR!</div>}
          </div>

          <button className="btn-primary" onClick={save} disabled={saving || !tm || (week!==4 && amrapReps<=0)}>
            {week===4 ? 'Deload (no save)' : (saving ? 'Saving…' : 'Save session')}
          </button>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold mb-2">Recent Sessions ({lift})</h3>
          <TrendMini values={estSeries} unit={unit} />
          <ul className="text-sm space-y-2 mt-2">
            {history.slice(-5).map((s, i) => (
              <li key={i} className="border-b last:border-0 pb-2">
                <div>
                  {s.est1rm ? `est1RM ${s.est1rm} ${s.unit}` : ''} {s.pr ? '— PR' : ''}
                </div>
                <div className="text-gray-600">
                  AMRAP {s.amrap?.weight}×{s.amrap?.reps} {s.unit} — Week {s.week}
                </div>
              </li>
            ))}
            {history.length===0 && <li className="text-gray-500">No sessions logged yet.</li>}
          </ul>
        </div>
      </div>

      <CoachTips
        week={week}
        amrapReps={amrapReps}
        unit={unit}
        tm={tm}
        est1rm={est}
        prevBest={prevBest}
        lastWeight={lastWorkWeight || 0}
        lift={lift}
      />
    </div>
  );
}
