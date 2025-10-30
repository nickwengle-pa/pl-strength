import React, { useEffect, useMemo, useState } from "react";
import {
  ensureAnon,
  loadProfileRemote,
  type Profile,
  type Unit,
} from "../lib/db";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import { roundToPlate, weekPercents } from "../lib/tm";

type LiftKey = "squat" | "bench" | "deadlift" | "press";
type Week = 1 | 2 | 3 | 4;

const LIFTS: Array<{ key: LiftKey; label: string }> = [
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench Press" },
  { key: "deadlift", label: "Deadlift" },
  { key: "press", label: "Strict Press" },
];

const WEEK_META: Record<
  Week,
  { title: string; short: string; reps: [string, string, string] }
> = {
  1: { title: "Week One", short: "One", reps: ["5", "5", "5+"] },
  2: { title: "Week Two", short: "Two", reps: ["3", "3", "3+"] },
  3: { title: "Week Three", short: "Three", reps: ["5", "3", "1+"] },
  4: { title: "Deload", short: "Deload", reps: ["5", "5", "5"] },
};

const WEEK_ORDER: Week[] = [1, 2, 3, 4];
const DEFAULT_ONE_RM = 100;

type PlanSet = { reps: string; weight: number };
type PlanLift = {
  key: LiftKey;
  label: string;
  starting1Rm: number;
  weeks: Record<Week, PlanSet[]>;
};
type PlanCycle = {
  cycleNumber: number;
  lifts: PlanLift[];
};

const unitLabel = (unit: Unit): string => (unit === "kg" ? "kg" : "lbs");

const formatWeightValue = (weight: number): string => {
  if (!Number.isFinite(weight) || weight <= 0) return "-";
  if (Math.abs(weight - Math.round(weight)) < 1e-6) {
    return String(Math.round(weight));
  }
  return weight.toFixed(1).replace(/\.0$/, "");
};

const formatSet = (entry: PlanSet | undefined, unit: Unit): string => {
  if (!entry || !Number.isFinite(entry.weight) || entry.weight <= 0) {
    return "-";
  }
  return `${entry.reps} x ${formatWeightValue(entry.weight)} ${unitLabel(unit)}`;
};

const cycleIncrement = (lift: LiftKey, unit: Unit): number => {
  const upperIncrement = unit === "kg" ? 2.5 : 5;
  const lowerIncrement = unit === "kg" ? 5 : 10;
  return lift === "bench" || lift === "press" ? upperIncrement : lowerIncrement;
};

const deriveOneRm = (profile: Profile | null, lift: LiftKey): number => {
  const fromOneRm = profile?.oneRm?.[lift];
  if (typeof fromOneRm === "number" && Number.isFinite(fromOneRm) && fromOneRm > 0) {
    return Math.round(fromOneRm);
  }
  const fromTm = profile?.tm?.[lift];
  if (typeof fromTm === "number" && Number.isFinite(fromTm) && fromTm > 0) {
    return Math.round(fromTm / 0.9);
  }
  return DEFAULT_ONE_RM;
};

const resolveProfile = async (): Promise<Profile | null> => {
  const local = loadProfileLocal();
  try {
    const uid = await ensureAnon();
    const remote = await loadProfileRemote(uid);
    return remote || ((local as Profile | null) ?? null);
  } catch {
    return (local as Profile | null) ?? null;
  }
};

export default function Sheets() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [cycleCount, setCycleCount] = useState<number>(3);
  const [selectedCycle, setSelectedCycle] = useState<number>(1);
  const [selectedWeek, setSelectedWeek] = useState<Week>(1);
  const [roundStep, setRoundStep] = useState<number>(5);
  const [roundStepText, setRoundStepText] = useState<string>("5");
  const [showFullTable, setShowFullTable] = useState<boolean>(true);

  const unit: Unit = (profile?.unit ?? "lb") as Unit;
  const effectiveRoundStep = roundStep > 0 ? roundStep : unit === "kg" ? 2.5 : 5;

  useEffect(() => {
    (async () => {
      const resolved = await resolveProfile();
      setProfile(resolved);
    })();
  }, []);

  useEffect(() => {
    const defaultStep = unit === "kg" ? 2.5 : 5;
    setRoundStep(defaultStep);
    setRoundStepText(String(defaultStep));
  }, [unit]);

  useEffect(() => {
    if (selectedCycle > cycleCount) {
      setSelectedCycle(cycleCount || 1);
    }
  }, [cycleCount, selectedCycle]);

  const planData = useMemo<PlanCycle[]>(() => {
    const count = Math.max(1, cycleCount);
    return Array.from({ length: count }, (_, idx) => {
      const cycleNumber = idx + 1;
      const lifts = LIFTS.map((lift) => {
        const baseOneRm = deriveOneRm(profile, lift.key);
        const starting1Rm = baseOneRm + cycleIncrement(lift.key, unit) * idx;
        const trainingMax = starting1Rm * 0.9;
        const weeks = WEEK_ORDER.reduce((acc, week) => {
          const percents = weekPercents(week);
          const reps = WEEK_META[week].reps;
          acc[week] = percents.map((pct, setIdx) => {
            const raw = trainingMax * pct;
            const rounded =
              trainingMax > 0 ? roundToPlate(raw, unit, effectiveRoundStep) : 0;
            return { reps: reps[setIdx], weight: rounded };
          });
          return acc;
        }, {} as Record<Week, PlanSet[]>);
        return {
          key: lift.key,
          label: lift.label,
          starting1Rm: Math.round(starting1Rm),
          weeks,
        };
      });
      return { cycleNumber, lifts };
    });
  }, [cycleCount, effectiveRoundStep, profile, unit]);

  const focused = useMemo(() => {
    const cycle =
      planData.find((entry) => entry.cycleNumber === selectedCycle) ?? planData[0];
    if (!cycle) return null;
    return {
      cycleNumber: cycle.cycleNumber,
      week: selectedWeek,
      lifts: cycle.lifts.map((lift) => ({
        key: lift.key,
        label: lift.label,
        starting1Rm: lift.starting1Rm,
        sets: lift.weeks[selectedWeek] ?? [],
      })),
    };
  }, [planData, selectedCycle, selectedWeek]);

  const incrementSummary =
    unit === "kg"
      ? { upper: 2.5, lower: 5 }
      : { upper: 5, lower: 10 };

  const name =
    profile ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim() : "";
  const team = profile?.team ?? "";

  const handleRoundStepBlur = () => {
    const parsed = Number(roundStepText);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      const fallback = unit === "kg" ? 2.5 : 5;
      setRoundStep(fallback);
      setRoundStepText(String(fallback));
      return;
    }
    setRoundStep(parsed);
  };

  const cycleOptions = useMemo(
    () => Array.from({ length: Math.max(1, cycleCount) }, (_, idx) => idx + 1),
    [cycleCount]
  );

  return (
    <div className="container py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Printable Training Sheets</h1>
        <button className="btn btn-primary no-print" onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="card plan-card print:shadow-none print:border">
        <div className="grid gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Athlete</span>
            <input
              className="field"
              defaultValue={name}
              placeholder="First Last"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Team</span>
            <input
              className="field"
              defaultValue={team || ""}
              placeholder="Team / Group"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Date</span>
            <input className="field" type="date" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Notes</span>
            <input className="field" placeholder="Focus, cues, etc." />
          </label>
        </div>
      </div>

      <div className="card space-y-4 no-print">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>How many cycles?</span>
            <select
              className="field"
              value={cycleCount}
              onChange={(e) => setCycleCount(Number(e.target.value) || 1)}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm font-medium">
            <span>Rounding step ({unitLabel(unit)})</span>
            <input
              className="field"
              value={roundStepText}
              onChange={(e) => setRoundStepText(e.target.value)}
              onBlur={handleRoundStepBlur}
              type="number"
              min="0.5"
              step="0.5"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Select cycle</span>
          {cycleOptions.map((value) => (
            <button
              key={value}
              className={`btn btn-sm ${selectedCycle === value ? "btn-primary" : ""}`}
              onClick={() => setSelectedCycle(value)}
            >
              Cycle {value}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Select week</span>
          {WEEK_ORDER.map((value) => (
            <button
              key={value}
              className={`btn btn-sm ${selectedWeek === value ? "btn-primary" : ""}`}
              onClick={() => setSelectedWeek(value)}
            >
              {WEEK_META[value].title}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={showFullTable}
            onChange={(e) => setShowFullTable(e.target.checked)}
          />
          Show full program table
        </label>
      </div>

      {focused && (
        <div className="card plan-card print:shadow-none print:border print:break-inside-avoid">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-lg font-semibold">
              Cycle {focused.cycleNumber} &middot; {WEEK_META[focused.week].title}
            </div>
            <div className="text-sm text-gray-500">
              Weights in {unitLabel(unit)} (rounded to{" "}
              {formatWeightValue(effectiveRoundStep)})
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {focused.lifts.map((lift) => (
              <div
                key={lift.key}
                className="rounded-xl border border-gray-200 bg-white p-3"
              >
                <div className="text-base font-semibold">{lift.label}</div>
                <div className="text-[11px] text-gray-500 leading-tight">
                  Starting 1RM: {formatWeightValue(lift.starting1Rm)} {unitLabel(unit)}
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {lift.sets.map((set, idx) => (
                    <li
                      key={idx}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-2 py-1 text-xs"
                    >
                      <span className="text-[11px] uppercase text-gray-500">
                        Set {idx + 1}
                      </span>
                      <span className="font-semibold whitespace-nowrap">{formatSet(set, unit)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {showFullTable &&
        planData.map((cycle) => (
          <section
            key={cycle.cycleNumber}
            className="space-y-3 print:break-inside-avoid plan-card"
          >
            <h2 className="text-xl font-semibold">Cycle {cycle.cycleNumber}</h2>
            <div className="overflow-x-auto">
              <table className="w-full border border-gray-300 text-xs plan-table">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="border border-gray-200 p-2 text-left text-xs uppercase tracking-wide whitespace-nowrap">
                      Week
                    </th>
                    {cycle.lifts.map((lift) => (
                      <th
                        key={lift.key}
                        className="border border-gray-200 p-2 text-left text-xs font-semibold whitespace-nowrap"
                        colSpan={3}
                      >
                        <div className="font-semibold leading-tight">{lift.label}</div>
                        <div className="text-[11px] text-gray-500 leading-tight">
                          Starting 1RM: {formatWeightValue(lift.starting1Rm)}{" "}
                          {unitLabel(unit)}
                        </div>
                      </th>
                    ))}
                    <th className="border border-gray-200 p-2 text-left text-xs uppercase tracking-wide whitespace-nowrap">
                      Date
                    </th>
                  </tr>
                  <tr className="bg-gray-100">
                    {[
                      <th
                        key="week-label"
                        className="border border-gray-200 p-2 text-left text-[11px] uppercase tracking-wide whitespace-nowrap"
                      >
                        Week
                      </th>,
                      ...cycle.lifts.flatMap((lift) =>
                        ["Set One", "Set Two", "Set Three"].map((title, idx) => (
                          <th
                            key={`${lift.key}-${idx}`}
                            className="border border-gray-200 p-2 text-left text-[11px] uppercase tracking-wide whitespace-nowrap"
                          >
                            {title}
                          </th>
                        ))
                      ),
                      <th
                        key="date-label"
                        className="border border-gray-200 p-2 text-left text-[11px] uppercase tracking-wide whitespace-nowrap"
                      >
                        Date
                      </th>,
                    ]}
                  </tr>
                </thead>
                <tbody>
                  {WEEK_ORDER.map((week) => {
                    const isSelected =
                      cycle.cycleNumber === selectedCycle && week === selectedWeek;
                    return (
                      <tr
                        key={week}
                        className={isSelected ? "bg-indigo-50" : "bg-white"}
                      >
                        <td className="border border-gray-200 p-2 text-xs font-semibold whitespace-nowrap">
                          {WEEK_META[week].short}
                        </td>
                        {cycle.lifts.flatMap((lift) =>
                          (lift.weeks[week] ?? []).map((set, idx) => (
                            <td
                              key={`${cycle.cycleNumber}-${lift.key}-${week}-${idx}`}
                              className="border border-gray-200 p-2 text-xs whitespace-nowrap"
                            >
                              {formatSet(set, unit)}
                            </td>
                          ))
                        )}
                        <td className="border border-gray-200 p-2 align-top">
                          <input className="field w-full text-xs" type="date" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))}

      <div className="flex flex-wrap gap-6 text-xs text-gray-600">
        <div>
          <span className="font-semibold">Units:</span> {unitLabel(unit)}
        </div>
        <div>
          <span className="font-semibold">Round to:</span>{" "}
          {formatWeightValue(effectiveRoundStep)} {unitLabel(unit)}
        </div>
        <div>
          <span className="font-semibold">Cycle increases:</span>{" "}
          {`+${incrementSummary.lower} ${unitLabel(unit)} (squat/deadlift), +${incrementSummary.upper} ${unitLabel(unit)} (bench/press)`}
        </div>
      </div>

      <style>
        {`
        .no-print {
          --tw-shadow: none;
        }
        .field {
          border: 1px solid rgba(107,114,128,0.4);
          border-radius: 0.75rem;
          padding: 0.5rem 0.75rem;
        }
        @media print {
          .no-print {
            display: none !important;
          }
          .plan-card {
            box-shadow: none !important;
            border-color: #111827 !important;
          }
          .plan-table th,
          .plan-table td {
            border-color: #111827 !important;
          }
          input.field {
            border: 1px solid #111827 !important;
          }
          section.plan-card {
            page-break-inside: avoid;
          }
        }
      `}
      </style>
    </div>
  );
}
