import React, { useEffect, useMemo, useState } from "react";
import { ensureAnon, isCoach } from "../lib/db";

const MAX_CYCLES = 5;

const TURF_WARMUP = [
  "Jog in place 3-4 minutes",
  "Jumping jacks 1 minute",
  "Kickbacks",
  "Walking knee tucks",
  "Frankensteins",
  "Alternating side squats",
  "Inchworms",
  "Hip flexor (static)",
];

const HIP_MOBILITY = {
  note: "Follow along with the video for 3 sets of 8 per movement.",
  url: "https://www.youtube.com/shorts/03Duel2-OQ4",
  embed: "https://www.youtube.com/embed/03Duel2-OQ4",
};

const PLYOMETRICS = [
  "2 foot pogo jumps",
  "1 foot pogo jumps",
  "Ski jumps (land with little time on ground as possible)",
  "Jumps (no more than 20 per session)",
];

const PLYO_DAYS = [
  "Monday - Broad jumps",
  "Tuesday - Box jumps",
  "Thursday - 1/2 broad 1/2 box",
];

const CORE_WARMUP = ["1 x 5 @ 40%", "1 x 5 @ 60%", "1 x 3 @ 80%"];

const LIFT_WEEKS = [
  {
    week: "Week 1",
    days: ["Monday - Squat", "Tuesday - Bench", "Thursday - Deadlift"],
  },
  {
    week: "Week 2",
    days: ["Monday - Squat", "Tuesday - Bench", "Thursday - Bench"],
  },
  {
    week: "Week 3",
    days: ["Monday - Bench", "Tuesday - Squat", "Thursday - Deadlift"],
  },
  {
    week: "Week 4",
    days: ["Monday - Squat", "Tuesday - Bench", "Thursday - Bench"],
  },
];

const DEADLIFT_ACCESSORY = [
  { name: "Norwegian Curls", prescription: "5 x 10-20" },
  { name: "Goblet Squat", prescription: "5 x 10-20" },
  { name: "Hanging Leg Raise", prescription: "5 x 20" },
  { name: "Alternating Lunge", prescription: "5 x 20" },
];

const BENCH_ACCESSORY = [
  { name: "Military", prescription: "5 x 10-20" },
  { name: "Skull Crushers", prescription: "5 x 10-20" },
  { name: "Lat Pulldown", prescription: "5 x 10-20" },
  { name: "Assisted Pullups", prescription: "5 x 10-20" },
];

const SQUAT_ACCESSORY = [
  { name: "Good Mornings", prescription: "5 x 10-20" },
  { name: "Bulgarian Split Squats", prescription: "5 x 10-20" },
  { name: "Spiderman Pushups", prescription: "5 x 15" },
  { name: "Assisted Pullups", prescription: "5 x 10-20" },
];

export default function ProgramOutline() {
  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState(false);
  const [cycleCount, setCycleCount] = useState(3);
  const [selectedCycle, setSelectedCycle] = useState(1);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureAnon();
        const coachFlag = await isCoach();
        if (!active) return;
        setCoach(coachFlag);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load coach status", err);
        setCoach(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedCycle > cycleCount) {
      setSelectedCycle(cycleCount || 1);
    }
  }, [cycleCount, selectedCycle]);

  const cycleButtons = useMemo(
    () => Array.from({ length: Math.max(1, cycleCount) }, (_, i) => i + 1),
    [cycleCount]
  );

  if (loading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading outline…</div>
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="container py-6">
        <div className="card space-y-2 text-sm text-gray-600">
          <h1 className="text-lg font-semibold text-gray-800">Coach Access Required</h1>
          <p>
            The program outline is available to coaches only. Sign in with a coach account or contact an admin for
            access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Program Outline</h1>
          <p className="mt-1 text-sm text-gray-600">
            Snapshot for each training cycle. Update the cycle count to match your plan, then review the outline per
            cycle below.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Cycles</span>
          <select
            className="field w-24"
            value={cycleCount}
            onChange={(event) => setCycleCount(Number(event.target.value) || 1)}
          >
            {Array.from({ length: MAX_CYCLES }, (_, i) => i + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-700">Cycle</span>
        {cycleButtons.map((value) => (
          <button
            key={value}
            type="button"
            className={`btn btn-sm ${selectedCycle === value ? "btn-primary" : ""}`}
            onClick={() => setSelectedCycle(value)}
          >
            Cycle {value}
          </button>
        ))}
      </div>

      <OutlineCycle cycleNumber={selectedCycle} />
    </div>
  );
}

type OutlineProps = {
  cycleNumber: number;
};

function OutlineCycle({ cycleNumber }: OutlineProps) {
  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">Cycle {cycleNumber}</h2>
            <p className="text-sm text-gray-600">
              Use this outline for team briefing and daily planning. Adjust notes to match the specific roster and
              facilities.
            </p>
          </div>
        </header>

        <Section title="Warmup (Turf)" items={TURF_WARMUP} />

        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Hip Mobility Series (Turf)</h3>
            <p>{HIP_MOBILITY.note}</p>
          </div>
          <div className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-black pt-[56.25%]">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={HIP_MOBILITY.embed}
              title="Hip mobility series"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
            />
          </div>
          <a
            href={HIP_MOBILITY.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-600 hover:text-brand-700"
          >
            Watch on YouTube
          </a>
        </div>

        <Section title="Plyometrics (Turf)" items={PLYOMETRICS} footerItems={PLYO_DAYS} footerLabel="Weekly emphasis" />

        <Section title="Warmup (All core lifts)" items={CORE_WARMUP} />

        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Lift (Weightroom)</h3>
            <p className="text-sm text-gray-600">
              Align these training days with the 5/3/1 percentages for the selected cycle.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border border-gray-200 text-left text-sm text-gray-700">
              <thead>
                <tr className="bg-gray-50">
                  {LIFT_WEEKS.map((week) => (
                    <th key={week.week} className="border border-gray-200 px-3 py-2 font-semibold">
                      {week.week}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[0, 1, 2].map((row) => (
                  <tr key={row} className={row % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                    {LIFT_WEEKS.map((week) => (
                      <td key={`${week.week}-${row}`} className="border border-gray-200 px-3 py-2">
                        {week.days[row] ?? "-"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            See Core Breakdown Sheet for set and percent breakdowns.
          </div>
        </div>

        <AccessorySection title="Deadlift Accessory Lifts" rows={DEADLIFT_ACCESSORY} />
        <AccessorySection title="Bench Accessory Lifts" rows={BENCH_ACCESSORY} />
        <AccessorySection title="Squat Accessory Lifts" rows={SQUAT_ACCESSORY} />

        <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
          Reference the Exercises tab for sample technique videos.
        </div>
      </div>
    </div>
  );
}

type SectionProps = {
  title: string;
  items: string[];
  footerLabel?: string;
  footerItems?: string[];
};

function Section({ title, items, footerLabel, footerItems }: SectionProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-2">
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      <ul className="list-disc pl-6 space-y-1">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {footerItems && footerItems.length > 0 && (
        <div className="pt-2 text-xs text-gray-600">
          {footerLabel && <div className="font-semibold">{footerLabel}</div>}
          <ul className="list-disc pl-6 space-y-1">
            {footerItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

type AccessorySectionProps = {
  title: string;
  rows: { name: string; prescription: string }[];
};

function AccessorySection({ title, rows }: AccessorySectionProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 text-sm text-gray-700">
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-[280px] border border-gray-200 text-left">
          <thead>
            <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <th className="border border-gray-200 px-3 py-2">Exercise</th>
              <th className="border border-gray-200 px-3 py-2">Prescription</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name} className="odd:bg-white even:bg-gray-50">
                <td className="border border-gray-200 px-3 py-2 font-medium">{row.name}</td>
                <td className="border border-gray-200 px-3 py-2">{row.prescription}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
