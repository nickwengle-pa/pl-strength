import React, { useEffect, useMemo, useState } from "react";
import { useDevice } from "../lib/device";

type Props = {
  week: 1 | 2 | 3 | 4;
  amrapReps: number;
  unit: "lb" | "kg";
  tm: number | null;
  est1rm: number | null;
  prevBest: number;
  lastWeight: number;
  lift: "bench" | "squat" | "deadlift" | "press";
};

const round = (value: number) => Math.round(value * 10) / 10;

export default function CoachTips({
  week,
  amrapReps,
  unit,
  tm,
  est1rm,
  prevBest,
  lastWeight,
  lift,
}: Props) {
  const { isMobile } = useDevice();
  const [expanded, setExpanded] = useState(!isMobile);

  useEffect(() => {
    setExpanded(!isMobile);
  }, [isMobile]);

  const tips = useMemo(() => {
    const list: string[] = [];

    if (week === 4) {
      list.push(
        "Deload week: no AMRAP. Keep sets crisp at 40/50/60 percent x 5. Leave 1-2 reps in reserve."
      );
    } else if (amrapReps <= 0) {
      list.push(
        "Log AMRAP reps on the last work set to estimate 1RM and track PRs."
      );
    }

    if (tm && tm > 0 && week !== 4) {
      const target =
        week === 1
          ? "Expect 5-8 reps on the plus set."
          : week === 2
          ? "Expect 3-6 reps on the plus set."
          : "Expect 1-4 reps on the plus set.";
      list.push(target);

      if (amrapReps > 0) {
        if (week === 1 && amrapReps <= 4) {
          list.push(
            "Tough Week 1 effort. Consider trimming TM by about 5 percent next cycle."
          );
        }
        if (week === 2 && amrapReps <= 2) {
          list.push(
            "Low reps in Week 2. Check sleep and nutrition; adjust TM if it repeats."
          );
        }
        if (week === 3 && amrapReps === 0) {
          list.push("Try to hit at least a clean single on Week 3 if it is safe.");
        }
        if (amrapReps >= 10) {
          list.push("Big capacity shown. Eligible for a small TM bump next cycle.");
        }
      }
    }

    if (est1rm && prevBest > 0) {
      if (est1rm > prevBest) {
        list.push(
          `New PR on estimated 1RM: ${round(est1rm)} ${unit} (previous ${round(
            prevBest
          )}). Keep TM steady until next cycle.`
        );
      } else {
        const delta = round(prevBest - est1rm);
        list.push(
          `No PR today (-${delta} ${unit}). Normal variance - tighten technique and recovery.`
        );
      }
    }

    if (lastWeight > 0 && week !== 4) {
      list.push(
        `Last set was ${lastWeight} ${unit}. Brace, breathe, keep the bar path clean. Stop 1-2 reps before failure.`
      );
    }

    const cue =
      {
        bench: "Bench: lats tight, feet planted, consistent touch. No bounce.",
        squat: "Squat: big air, knees over toes, drive hard from the hole.",
        deadlift: "Deadlift: take the slack, wedge in, push the floor away.",
        press: "Press: glutes tight, ribcage down, head through at lockout.",
      }[lift] ?? "";

    if (cue) {
      list.push(cue);
    }

    return list;
  }, [amrapReps, est1rm, lastWeight, lift, prevBest, tm, unit, week]);

  if (tips.length === 0) {
    return null;
  }

  const content = (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {tips.map((tip, idx) => (
        <li key={idx}>{tip}</li>
      ))}
    </ul>
  );

  if (isMobile) {
    return (
      <div className="card space-y-2">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left text-lg font-semibold"
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
        >
          Coach Tips
          <svg
            className={`h-5 w-5 transition-transform ${
              expanded ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.51a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {expanded && content}
      </div>
    );
  }

  return (
    <div className="card space-y-2">
      <h3 className="text-lg font-semibold">Coach Tips</h3>
      {content}
    </div>
  );
}

