import React, { useEffect, useMemo, useState } from "react";
import { useDevice } from "../lib/device";
import { roundToPlate } from "../lib/tm";

type Props = {
  week: 1 | 2 | 3;
  amrapReps: number;
  unit: "lb" | "kg";
  tm: number | null;
  est1rm: number | null;
  prevBest: number;
  lastWeight: number;
  lift: "bench" | "squat" | "deadlift";
};

const roundEstimate = (value: number, unit: "lb" | "kg"): number => {
  if (!Number.isFinite(value)) return 0;
  return roundToPlate(value, unit, unit === "lb" ? 5 : 2.5);
};

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

    if (amrapReps <= 0) {
      list.push(
        "Log AMRAP Reps On The Last Work Set To Estimate 1RM And Track PRs."
      );
    }

    if (tm && tm > 0) {
      const target =
        week === 1
          ? "Expect 5-8 Reps On The Plus Set."
          : week === 2
          ? "Expect 3-6 Reps On The Plus Set."
          : "Expect 1-4 Reps On The Plus Set.";
      list.push(target);

      if (amrapReps > 0) {
        if (week === 1 && amrapReps <= 4) {
          list.push(
            "Tough Week 1 Effort. Consider Trimming TM By About 5 Percent Next Cycle."
          );
        }
        if (week === 2 && amrapReps <= 2) {
          list.push(
            "Low Reps In Week 2. Check Sleep And Nutrition; Adjust TM If It Repeats."
          );
        }
        if (week === 3 && amrapReps === 0) {
          list.push("Try To Hit At Least A Clean Single On Week 3 If It Is Safe.");
        }
        if (amrapReps >= 10) {
          list.push("Big Capacity Shown. Eligible For A Small TM Bump Next Cycle.");
        }
      }
    }

    if (est1rm && prevBest > 0) {
      const roundedEst = roundEstimate(est1rm, unit);
      const roundedPrev = roundEstimate(prevBest, unit);
      if (roundedEst > roundedPrev) {
        list.push(
          `New PR On Estimated 1RM: ${roundedEst} ${unit} (Previous ${roundedPrev}). Keep TM Steady Until Next Cycle.`
        );
      } else {
        const delta = roundedPrev - roundedEst;
        list.push(
          `No PR Today (-${delta} ${unit}). Normal Variance - Tighten Technique And Recovery.`
        );
      }
    }

    if (lastWeight > 0) {
      list.push(
        `Last Set Was ${lastWeight} ${unit}. Brace, Breathe, Keep The Bar Path Clean. Stop 1-2 Reps Before Failure.`
      );
    }

    const cue =
      {
        bench: "Bench: Lats Tight, Feet Planted, Consistent Touch. No Bounce.",
        squat: "Squat: Big Air, Knees Over Toes, Drive Hard From The Hole.",
        deadlift: "Deadlift: Take The Slack, Wedge In, Push The Floor Away.",
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
