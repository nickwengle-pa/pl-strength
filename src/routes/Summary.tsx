import React from 'react';

export default function Summary() {
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Quick Summary</h3>
      <div className="text-sm space-y-2">
        <div><b>Training Max (TM):</b> Use ~90% of your true 1RM as the baseline for all calculations.</div>
        <div><b>Weekly Waves:</b></div>
        <ul className="list-disc pl-5">
          <li>Week 1: 65% ×5, 75% ×5, 85% ×5+</li>
          <li>Week 2: 70% ×3, 80% ×3, 90% ×3+</li>
          <li>Week 3: 75% ×5, 85% ×3, 95% ×1+</li>
          <li>Week 4 (Deload): 40/50/60% ×5 (no AMRAP)</li>
        </ul>
        <div><b>Warm-ups:</b> 40% ×5, 50% ×5, 60% ×3 before work sets.</div>
        <div><b>AMRAP:</b> On the last work set (weeks 1–3), leave 1–2 reps in reserve. No AMRAP on deload week.</div>
        <div><b>Progression:</b> After a cycle, bump TM small: upper +5 lb / +2.5 kg; lower +10 lb / +5 kg.</div>
        <div><b>Assistance:</b> Keep it simple (push/pull/core). Main lift quality beats junk volume.</div>
        <div><b>1RM Estimate:</b> est1RM ≈ weight × reps × 0.0333 + weight.</div>
      </div>
    </div>
  );
}
