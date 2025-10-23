import React, { useEffect, useState } from "react";
import { ensureAnon, loadProfileRemote, Profile } from "../lib/db";

type Mode = "weekly" | "blank";

export default function Sheets() {
  const [mode, setMode] = useState<Mode>("weekly");
  const [week, setWeek] = useState<1|2|3|4>(1);
  const [p, setP] = useState<Profile | null>(null);

  useEffect(() => {
    (async () => {
      const u = await ensureAnon();
      setP(await loadProfileRemote(u));
    })();
  }, []);

  return (
    <div className="container py-6 space-y-4">
      <h1>Printable / Fillable Sheets</h1>

      <div className="flex items-center gap-3">
        <button className={`btn ${mode==='weekly'?'btn-primary':''}`} onClick={()=>setMode("weekly")}>Week 1–4</button>
        <button className={`btn ${mode==='blank'?'btn-primary':''}`} onClick={()=>setMode("blank")}>Blank Sheet</button>
        <button className="btn" onClick={()=>window.print()}>Print / Save PDF</button>
      </div>

      <div className="card print:shadow-none print:border-0">
        {mode === "weekly" ? <Weekly week={week} setWeek={setWeek} profile={p}/> : <Blank profile={p} />}
      </div>
    </div>
  );
}

function Weekly({ week, setWeek, profile }:{
  week:1|2|3|4; setWeek:(w:1|2|3|4)=>void; profile: Profile | null;
}) {
  const name = profile ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() : "";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="text-sm font-medium">Week</div>
        {[1,2,3,4].map(w=>(
          <button key={w} className={`btn ${week===w?'btn-primary':''}`} onClick={()=>setWeek(w as 1|2|3|4)}>{w}</button>
        ))}
      </div>
      <Header name={name} team={profile?.team||""} />
      <Grid rows={12} />
    </div>
  );
}

function Blank({ profile }:{profile:Profile|null}) {
  const name = profile ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() : "";
  return (
    <div className="space-y-4">
      <Header name={name} team={profile?.team||""} />
      <Grid rows={16} />
    </div>
  );
}

function Header({ name, team }:{name:string; team:string}) {
  return (
    <div className="grid md:grid-cols-4 gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Athlete</label>
        <input className="border rounded-xl px-3 py-2" defaultValue={name} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Team</label>
        <input className="border rounded-xl px-3 py-2" defaultValue={team} placeholder="JH / Varsity" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Date</label>
        <input className="border rounded-xl px-3 py-2" placeholder="MM/DD/YYYY" />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium">Lift</label>
        <input className="border rounded-xl px-3 py-2" placeholder="Bench / Squat / Deadlift / Press" />
      </div>
    </div>
  );
}

function Grid({ rows }:{rows:number}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border rounded-xl overflow-hidden">
        <thead className="bg-gray-50">
          <tr>
            {["Set","Reps","%","Weight","Notes"].map(h => (
              <th key={h} className="p-2 text-left">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({length:rows}).map((_,i)=>(
            <tr key={i} className="border-t">
              <td className="p-2"><input className="border rounded px-2 py-1 w-20" defaultValue={i+1}/></td>
              <td className="p-2"><input className="border rounded px-2 py-1 w-24" /></td>
              <td className="p-2"><input className="border rounded px-2 py-1 w-24" /></td>
              <td className="p-2"><input className="border rounded px-2 py-1 w-28" /></td>
              <td className="p-2"><input className="border rounded px-2 py-1 w-full" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <style>{`@media print { .btn, header, nav { display: none !important } .card { box-shadow:none; border:0 } }`}</style>
    </div>
  );
}
