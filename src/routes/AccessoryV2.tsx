import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeProgramOutline,
  loadProfileRemote,
  ensureAnon,
  type ProgramOutlineRecord,
  type ProgramOutlineAccessory,
} from "../lib/db";

const DEFAULT_SQUAT_ACCESSORY: ProgramOutlineAccessory[] = [
  { name: "Good Mornings", prescription: "5 x 10-20" },
  { name: "Bulgarian Split Squats", prescription: "5 x 10-20" },
  { name: "Spiderman Pushups", prescription: "5 x 15" },
  { name: "Assisted Pullups", prescription: "5 x 10-20" },
];

const DEFAULT_BENCH_ACCESSORY: ProgramOutlineAccessory[] = [
  { name: "Military", prescription: "5 x 10-20" },
  { name: "Skull Crushers", prescription: "5 x 10-20" },
  { name: "Lat Pulldown", prescription: "5 x 10-20" },
  { name: "Assisted Pullups", prescription: "5 x 10-20" },
];

const DEFAULT_DEADLIFT_ACCESSORY: ProgramOutlineAccessory[] = [
  { name: "Norwegian Curls", prescription: "5 x 10-20" },
  { name: "Goblet Squat", prescription: "5 x 10-20" },
  { name: "Hanging Leg Raise", prescription: "5 x 20" },
  { name: "Alternating Lunge", prescription: "5 x 20" },
];

const DEFAULT_LIFT_WEEKS = [
  { week: "Week 1", days: ["Monday - Squat", "Tuesday - Bench", "Thursday - Deadlift"] },
  { week: "Week 2", days: ["Monday - Squat", "Tuesday - Bench", "Thursday - Bench"] },
  { week: "Week 3", days: ["Monday - Bench", "Tuesday - Squat", "Thursday - Deadlift"] },
];

type LiftType = "squat" | "bench" | "deadlift";

function detectLiftFromDay(
  dayOfWeek: number,
  currentWeek: number,
  liftWeeks: Array<{ week?: string; days?: string[] }>
): LiftType | null {
  const dayMap: Record<number, number> = { 1: 0, 2: 1, 4: 2 };
  const dayIndex = dayMap[dayOfWeek];
  if (dayIndex === undefined) return null;
  const weekIndex = ((currentWeek - 1) % liftWeeks.length + liftWeeks.length) % liftWeeks.length;
  const weekData = liftWeeks[weekIndex];
  if (!weekData?.days || !weekData.days[dayIndex]) return null;
  const dayString = weekData.days[dayIndex].toLowerCase();
  if (dayString.includes("squat")) return "squat";
  if (dayString.includes("bench")) return "bench";
  if (dayString.includes("deadlift")) return "deadlift";
  return null;
}

// v2 token mapping: squat=accent (Dragon red), bench=info (blue), deadlift=warn (amber/gold)
function getLiftTokens(lift: LiftType) {
  switch (lift) {
    case "squat":
      return {
        chipBg: "bg-v2-accent-700",
        chipBorder: "border-v2-accent-600",
        text: "text-v2-accent-300",
        borderStrong: "border-v2-accent-600",
        wash: "bg-v2-accent-900/30",
        rule: "bg-v2-accent-600",
      };
    case "bench":
      return {
        chipBg: "bg-v2-info-600",
        chipBorder: "border-v2-info-500",
        text: "text-v2-info-300",
        borderStrong: "border-v2-info-500",
        wash: "bg-v2-info-900/30",
        rule: "bg-v2-info-500",
      };
    case "deadlift":
      return {
        chipBg: "bg-v2-warn-600",
        chipBorder: "border-v2-warn-500",
        text: "text-v2-warn-300",
        borderStrong: "border-v2-warn-500",
        wash: "bg-v2-warn-900/30",
        rule: "bg-v2-warn-500",
      };
  }
}

export default function AccessoryV2() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [liftWeeks, setLiftWeeks] = useState(DEFAULT_LIFT_WEEKS);
  const [squatAccessory, setSquatAccessory] = useState(DEFAULT_SQUAT_ACCESSORY);
  const [benchAccessory, setBenchAccessory] = useState(DEFAULT_BENCH_ACCESSORY);
  const [deadliftAccessory, setDeadliftAccessory] = useState(DEFAULT_DEADLIFT_ACCESSORY);
  const [selectedLift, setSelectedLift] = useState<LiftType | null>(null);
  const [showAllLifts, setShowAllLifts] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        await ensureAnon();
        const profile = await loadProfileRemote();
        if (profile?.currentWeek) setCurrentWeek(profile.currentWeek);
      } catch (err) {
        console.debug("Could not load profile", err);
      }
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeProgramOutline((record: ProgramOutlineRecord | null) => {
      if (record) {
        if (record.liftWeeks && record.liftWeeks.length > 0) {
          setLiftWeeks(record.liftWeeks.map(w => ({
            week: w.week || "",
            days: w.days || [],
          })));
        }
        if (record.squatAccessory && record.squatAccessory.length > 0) setSquatAccessory(record.squatAccessory);
        if (record.benchAccessory && record.benchAccessory.length > 0) setBenchAccessory(record.benchAccessory);
        if (record.deadliftAccessory && record.deadliftAccessory.length > 0) setDeadliftAccessory(record.deadliftAccessory);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const todayLift = useMemo(() => {
    const today = new Date();
    return detectLiftFromDay(today.getDay(), currentWeek, liftWeeks);
  }, [currentWeek, liftWeeks]);

  useEffect(() => {
    if (!loading && selectedLift === null) setSelectedLift(todayLift || "squat");
  }, [loading, todayLift, selectedLift]);

  const getAccessoryList = (lift: LiftType): ProgramOutlineAccessory[] => {
    switch (lift) {
      case "squat": return squatAccessory;
      case "bench": return benchAccessory;
      case "deadlift": return deadliftAccessory;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  const activeLift = selectedLift || "squat";
  const tokens = getLiftTokens(activeLift);
  const accessories = getAccessoryList(activeLift);

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-8 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.18) 0%, transparent 70%)",
        }}
      />

      {/* Header */}
      <div className="relative z-10 bg-v2-surface-900/60 backdrop-blur-sm border-b border-v2-surface-800 px-4 py-4">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center justify-center w-11 h-11 rounded-v2-md border border-v2-surface-700 text-v2-ink-300 hover:border-v2-accent-600 hover:text-v2-accent-300 transition-colors duration-v2-quick"
            aria-label="Go back"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                Secondary Work
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-2xl font-bold uppercase tracking-tight leading-none mt-1">
              Accessory Lifts
            </h1>
            <p className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-wide mt-1">
              Complete after main lift
            </p>
          </div>
        </div>
      </div>

      <div className="relative z-10 px-4 py-5 space-y-4 max-w-lg mx-auto">
        {todayLift && (
          <div className={`${tokens.wash} border border-v2-surface-800 border-l-[3px] ${tokens.borderStrong} px-4 py-3 rounded-v2-sm`}>
            <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] font-semibold">
              Today's Lift
            </div>
            <div className={`font-v2-heading text-v2-2xl font-bold ${tokens.text} uppercase tracking-tight leading-tight mt-1`}>
              {todayLift} Day
            </div>
            <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-wide mt-0.5">
              Week <span className="font-v2-mono tabular-nums text-v2-ink-300">{currentWeek}</span>
            </div>
          </div>
        )}

        {/* Lift Selector */}
        <div className="grid grid-cols-3 gap-1">
          {(["squat", "bench", "deadlift"] as LiftType[]).map((lift) => {
            const isActive = activeLift === lift;
            const liftTokens = getLiftTokens(lift);
            return (
              <button
                key={lift}
                onClick={() => setSelectedLift(lift)}
                className={`py-3 font-v2-heading font-bold uppercase tracking-widest text-v2-sm border transition-all duration-v2-quick ${
                  isActive
                    ? `${liftTokens.chipBg} ${liftTokens.chipBorder} text-v2-ink-50 shadow-v2-elev-1`
                    : "bg-v2-surface-900 border-v2-surface-700 text-v2-ink-400 hover:border-v2-surface-600 hover:text-v2-ink-100"
                }`}
              >
                {lift}
              </button>
            );
          })}
        </div>

        {/* Accessory List */}
        <section className={`bg-v2-surface-900 border border-v2-surface-800 border-l-[3px] ${tokens.borderStrong} rounded-v2-md overflow-hidden shadow-v2-elev-1`}>
          <div className="px-4 py-3 border-b border-v2-surface-800 flex items-center gap-2">
            <div className={`h-px w-5 ${tokens.rule}`} />
            <h2 className={`font-v2-heading text-v2-base font-bold ${tokens.text} uppercase tracking-widest`}>
              {activeLift} Accessories
            </h2>
          </div>
          <ul className="divide-y divide-v2-surface-800">
            {accessories.map((item, index) => (
              <li key={index} className="px-4 py-3 flex items-center justify-between bg-v2-surface-900">
                <div className="flex items-center gap-3">
                  <span className={`flex-shrink-0 w-8 h-8 ${tokens.chipBg} text-v2-ink-50 font-v2-mono text-v2-sm font-bold flex items-center justify-center tabular-nums`}>
                    {index + 1}
                  </span>
                  <span className="font-v2-body text-v2-base font-semibold text-v2-ink-100">{item.name}</span>
                </div>
                <span className={`border ${tokens.borderStrong} ${tokens.text} px-3 py-1 font-v2-mono text-v2-xs font-bold tabular-nums rounded-v2-sm`}>
                  {item.prescription}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Show All Lifts */}
        <details
          className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1"
          open={showAllLifts}
          onToggle={(e) => setShowAllLifts((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-4 py-4 cursor-pointer flex items-center justify-between hover:bg-v2-surface-800/60 transition-colors duration-v2-quick list-none">
            <span className="font-v2-heading font-bold uppercase tracking-widest text-v2-ink-100">
              View All Accessories
            </span>
            <svg
              className={`w-5 h-5 text-v2-ink-500 transition-transform duration-v2-quick ${showAllLifts ? "rotate-180" : ""}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="border-t border-v2-surface-800">
            {(["squat", "bench", "deadlift"] as LiftType[]).map((lift) => {
              const liftTokens = getLiftTokens(lift);
              const liftAccessories = getAccessoryList(lift);
              return (
                <div key={lift} className="border-b border-v2-surface-800 last:border-b-0">
                  <div className={`${liftTokens.wash} px-4 py-2 border-b border-v2-surface-800 flex items-center gap-2`}>
                    <div className={`h-px w-4 ${liftTokens.rule}`} />
                    <h3 className={`font-v2-heading text-v2-sm font-bold ${liftTokens.text} uppercase tracking-widest`}>
                      {lift}
                    </h3>
                  </div>
                  <ul className="divide-y divide-v2-surface-800">
                    {liftAccessories.map((item, index) => (
                      <li key={index} className="px-4 py-2.5 flex items-center justify-between bg-v2-surface-950">
                        <span className="font-v2-body text-v2-sm text-v2-ink-200">{item.name}</span>
                        <span className="font-v2-mono text-v2-xs text-v2-ink-400 font-semibold tabular-nums">
                          {item.prescription}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>

        <button
          onClick={() => navigate("/")}
          className="w-full min-h-touch py-4 bg-v2-surface-900 hover:bg-v2-surface-800 border border-v2-surface-700 hover:border-v2-accent-600 text-v2-ink-50 font-v2-heading font-bold uppercase tracking-widest transition-all duration-v2-quick flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Back to Lifts
        </button>
      </div>
    </div>
  );
}
