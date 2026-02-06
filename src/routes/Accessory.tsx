import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  subscribeProgramOutline,
  loadProfileRemote,
  ensureAnon,
  type ProgramOutlineRecord,
  type ProgramOutlineAccessory,
} from "../lib/db";

// Default accessory lifts
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
  // dayOfWeek: 0 = Sunday, 1 = Monday, 2 = Tuesday, etc.
  const dayMap: Record<number, number> = {
    1: 0, // Monday -> first day in week
    2: 1, // Tuesday -> second day in week
    4: 2, // Thursday -> third day in week
  };

  const dayIndex = dayMap[dayOfWeek];
  if (dayIndex === undefined) return null;

  // Get the week data (1-indexed, so subtract 1)
  const weekIndex = ((currentWeek - 1) % liftWeeks.length + liftWeeks.length) % liftWeeks.length;
  const weekData = liftWeeks[weekIndex];
  if (!weekData?.days || !weekData.days[dayIndex]) return null;

  const dayString = weekData.days[dayIndex].toLowerCase();
  
  if (dayString.includes("squat")) return "squat";
  if (dayString.includes("bench")) return "bench";
  if (dayString.includes("deadlift")) return "deadlift";

  return null;
}

function getLiftColor(lift: LiftType): { bg: string; text: string; border: string; light: string } {
  switch (lift) {
    case "squat":
      return { bg: "bg-brand-600", text: "text-brand-800", border: "border-brand-200", light: "bg-brand-50" };
    case "bench":
      return { bg: "bg-blue-600", text: "text-blue-800", border: "border-blue-200", light: "bg-blue-50" };
    case "deadlift":
      return { bg: "bg-purple-600", text: "text-purple-800", border: "border-purple-200", light: "bg-purple-50" };
  }
}

function getLiftEmoji(lift: LiftType): string {
  switch (lift) {
    case "squat": return "🦵";
    case "bench": return "🏋️";
    case "deadlift": return "💪";
  }
}

export default function Accessory() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(1);
  const [liftWeeks, setLiftWeeks] = useState(DEFAULT_LIFT_WEEKS);
  const [squatAccessory, setSquatAccessory] = useState(DEFAULT_SQUAT_ACCESSORY);
  const [benchAccessory, setBenchAccessory] = useState(DEFAULT_BENCH_ACCESSORY);
  const [deadliftAccessory, setDeadliftAccessory] = useState(DEFAULT_DEADLIFT_ACCESSORY);
  const [selectedLift, setSelectedLift] = useState<LiftType | null>(null);
  const [showAllLifts, setShowAllLifts] = useState(false);

  // Load profile to get current week
  useEffect(() => {
    (async () => {
      try {
        await ensureAnon();
        const profile = await loadProfileRemote();
        if (profile?.currentWeek) {
          setCurrentWeek(profile.currentWeek);
        }
      } catch (err) {
        console.debug("Could not load profile", err);
      }
    })();
  }, []);

  // Subscribe to program outline updates
  useEffect(() => {
    const unsubscribe = subscribeProgramOutline((record: ProgramOutlineRecord | null) => {
      if (record) {
        if (record.liftWeeks && record.liftWeeks.length > 0) {
          setLiftWeeks(record.liftWeeks.map(w => ({
            week: w.week || "",
            days: w.days || [],
          })));
        }
        if (record.squatAccessory && record.squatAccessory.length > 0) {
          setSquatAccessory(record.squatAccessory);
        }
        if (record.benchAccessory && record.benchAccessory.length > 0) {
          setBenchAccessory(record.benchAccessory);
        }
        if (record.deadliftAccessory && record.deadliftAccessory.length > 0) {
          setDeadliftAccessory(record.deadliftAccessory);
        }
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  // Detect today's lift
  const todayLift = useMemo(() => {
    const today = new Date();
    const dayOfWeek = today.getDay();
    return detectLiftFromDay(dayOfWeek, currentWeek, liftWeeks);
  }, [currentWeek, liftWeeks]);

  // Set initial selected lift
  useEffect(() => {
    if (!loading && selectedLift === null) {
      setSelectedLift(todayLift || "squat");
    }
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  const activeLift = selectedLift || "squat";
  const colors = getLiftColor(activeLift);
  const accessories = getAccessoryList(activeLift);

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-100 to-white pb-8">
      {/* Header */}
      <div className={`sticky top-0 z-10 ${colors.bg} text-white px-4 py-4 shadow-lg`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 rounded-full hover:bg-white/20 active:bg-white/30 transition-colors"
            aria-label="Go back"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              🎯 Accessory Lifts
            </h1>
            <p className="text-white/80 text-sm">Complete after main lift</p>
          </div>
        </div>
      </div>

      <div className="px-4 py-6 space-y-6 max-w-lg mx-auto">
        {/* Today's Lift Indicator */}
        {todayLift && (
          <div className={`${colors.light} ${colors.border} border-2 rounded-2xl p-4 text-center`}>
            <div className="text-sm text-gray-600 mb-1">Today's Lift</div>
            <div className={`text-2xl font-bold ${colors.text} flex items-center justify-center gap-2`}>
              {getLiftEmoji(todayLift)} {todayLift.charAt(0).toUpperCase() + todayLift.slice(1)} Day
            </div>
            <div className="text-sm text-gray-500 mt-1">Week {currentWeek}</div>
          </div>
        )}

        {/* Lift Selector Pills */}
        <div className="flex gap-2 justify-center">
          {(["squat", "bench", "deadlift"] as LiftType[]).map((lift) => {
            const isActive = activeLift === lift;
            const liftColors = getLiftColor(lift);
            return (
              <button
                key={lift}
                onClick={() => setSelectedLift(lift)}
                className={`px-4 py-2 rounded-full font-semibold text-sm transition-all ${
                  isActive
                    ? `${liftColors.bg} text-white shadow-md`
                    : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                }`}
              >
                {getLiftEmoji(lift)} {lift.charAt(0).toUpperCase() + lift.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Accessory List */}
        <section className="bg-white rounded-2xl shadow-md overflow-hidden">
          <div className={`${colors.light} px-4 py-3 ${colors.border} border-b`}>
            <h2 className={`text-lg font-bold ${colors.text} flex items-center gap-2`}>
              {getLiftEmoji(activeLift)} {activeLift.charAt(0).toUpperCase() + activeLift.slice(1)} Accessories
            </h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {accessories.map((item, index) => (
              <li key={index} className="px-4 py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`flex-shrink-0 w-8 h-8 ${colors.light} ${colors.text} rounded-full flex items-center justify-center text-sm font-bold`}>
                    {index + 1}
                  </span>
                  <span className="text-gray-800 font-medium">{item.name}</span>
                </div>
                <span className={`${colors.light} ${colors.text} px-3 py-1 rounded-full text-sm font-semibold`}>
                  {item.prescription}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Show All Lifts Dropdown */}
        <details 
          className="bg-white rounded-2xl shadow-md overflow-hidden"
          open={showAllLifts}
          onToggle={(e) => setShowAllLifts((e.target as HTMLDetailsElement).open)}
        >
          <summary className="px-4 py-4 cursor-pointer flex items-center justify-between hover:bg-gray-50 transition-colors list-none">
            <span className="font-semibold text-gray-700">📋 View All Accessory Lifts</span>
            <svg 
              className={`w-5 h-5 text-gray-500 transition-transform ${showAllLifts ? "rotate-180" : ""}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          
          <div className="border-t border-gray-100">
            {(["squat", "bench", "deadlift"] as LiftType[]).map((lift) => {
              const liftColors = getLiftColor(lift);
              const liftAccessories = getAccessoryList(lift);
              return (
                <div key={lift} className="border-b border-gray-100 last:border-b-0">
                  <div className={`${liftColors.light} px-4 py-2 ${liftColors.border} border-b`}>
                    <h3 className={`font-bold ${liftColors.text} flex items-center gap-2`}>
                      {getLiftEmoji(lift)} {lift.charAt(0).toUpperCase() + lift.slice(1)}
                    </h3>
                  </div>
                  <ul className="divide-y divide-gray-50">
                    {liftAccessories.map((item, index) => (
                      <li key={index} className="px-4 py-3 flex items-center justify-between">
                        <span className="text-gray-700 text-sm">{item.name}</span>
                        <span className="text-gray-500 text-sm">{item.prescription}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>

        {/* Done Button */}
        <button
          onClick={() => navigate("/")}
          className={`w-full py-4 ${colors.bg} hover:opacity-90 active:opacity-80 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-[0.98]`}
        >
          ✓ Done - Back to Lifts
        </button>
      </div>
    </div>
  );
}
