import React from 'react';

type Props = {
  week: 1|2|3|4;
  amrapReps: number;
  unit: 'lb'|'kg';
  tm: number | null;
  est1rm: number | null;
  prevBest: number;
  lastWeight: number;
  lift: 'bench'|'squat'|'deadlift'|'press';
};

const round = (x:number)=> Math.round(x*10)/10;

export default function CoachTips({ week, amrapReps, unit, tm, est1rm, prevBest, lastWeight, lift }: Props) {
  const tips: string[] = [];

  if (week === 4) {
    tips.push("Deload week: no AMRAP. Keep sets crisp at 40/50/60% × 5. Leave 1–2 reps in reserve.");
  } else {
    if (amrapReps <= 0) tips.push("Log AMRAP reps on the last work set to estimate 1RM and track PRs.");
  }

  if (tm && tm > 0 && week !== 4) {
    const target = week === 1 ? "Expect 5–8 reps on the + set." : week === 2 ? "Expect 3–6 reps on the + set." : "Expect 1–4 reps on the + set.";
    tips.push(target);

    if (amrapReps > 0) {
      if (week === 1 && amrapReps <= 4) tips.push("Grindy for Week 1. Consider trimming TM by ~5% next cycle.");
      if (week === 2 && amrapReps <= 2) tips.push("Low reps on Week 2. Check sleep/nutrition; adjust TM if repeat.");
      if (week === 3 && amrapReps === 0) tips.push("Try to hit at least a clean single on Week 3 if safe.");
      if (amrapReps >= 10) tips.push("Big capacity—eligible for a small TM bump next cycle.");
    }
  }

  if (est1rm && prevBest > 0) {
    if (est1rm > prevBest) {
      tips.push(`New PR on est 1RM: ${round(est1rm)} ${unit} (prev ${round(prevBest)}). Keep TM steady until next cycle.`);
    } else {
      const delta = round(prevBest - (est1rm||0));
      tips.push(`No PR today (−${delta} ${unit}). Normal variance—tighten technique and recovery.`);
    }
  }

  if (lastWeight > 0 && week !== 4) tips.push(`Last set was ${lastWeight} ${unit}. Brace, breathe, consistent bar path. Stop 1–2 reps before failure.`);

  const cue = {
    bench: "Bench: lats tight, feet planted, consistent touch—no bounce.",
    squat: "Squat: big air, knees over toes, drive from the hole.",
    deadlift: "Deadlift: take the slack, wedge and push the floor.",
    press: "Press: glutes tight, ribcage down, head through at lockout."
  }[lift];
  tips.push(cue);

  return (
    <div className="card space-y-2">
      <h3 className="text-lg font-semibold">Coach Tips</h3>
      <ul className="list-disc pl-5 text-sm space-y-1">
        {tips.map((t, i)=>(<li key={i}>{t}</li>))}
      </ul>
    </div>
  );
}
