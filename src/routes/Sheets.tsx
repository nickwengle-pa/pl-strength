import React, { useEffect, useMemo, useState } from "react";
import {
  defaultEquipment,
  ensureAnon,
  fetchTeamProfiles,
  fetchAthleteSessions,
  formatTeamLabel,
  getStoredTeamSelection,
  loadProfileRemote,
  type Profile,
  type SessionRecord,
  type Team,
  type Unit,
} from "../lib/db";
import { loadProfile as loadProfileLocal } from "../lib/storage";
import { roundToPlate, weekPercents } from "../lib/tm";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

type LiftKey = "squat" | "bench" | "deadlift";
type Week = 1 | 2 | 3;

const LIFTS: Array<{ key: LiftKey; label: string }> = [
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench Press" },
  { key: "deadlift", label: "Deadlift" },
];

const WEEK_META: Record<
  Week,
  { title: string; short: string; reps: [string, string, string] }
> = {
  1: { title: "Week One", short: "One", reps: ["5", "5", "5+"] },
  2: { title: "Week Two", short: "Two", reps: ["3", "3", "3+"] },
  3: { title: "Week Three", short: "Three", reps: ["5", "3", "1+"] },
};

const DEFAULT_ONE_RM = 100;

const unitLabel = (unit: Unit): string => (unit === "kg" ? "kg" : "lbs");

const formatWeightValue = (weight: number): string => {
  if (!Number.isFinite(weight) || weight <= 0) return "-";
  if (Math.abs(weight - Math.round(weight)) < 1e-6) {
    return String(Math.round(weight));
  }
  return weight.toFixed(1).replace(/\.0$/, "");
};

const cycleIncrement = (lift: LiftKey, unit: Unit): number => {
  const upperIncrement = unit === "kg" ? 2.5 : 5;
  const lowerIncrement = unit === "kg" ? 5 : 10;
  return lift === "bench" ? upperIncrement : lowerIncrement;
};

const deriveBaseTm = (profile: Profile | null, lift: LiftKey): number => {
  const fromTm = profile?.tm?.[lift];
  if (typeof fromTm === "number" && Number.isFinite(fromTm) && fromTm > 0) {
    return fromTm;
  }
  const fromOneRm = profile?.oneRm?.[lift];
  if (typeof fromOneRm === "number" && Number.isFinite(fromOneRm) && fromOneRm > 0) {
    return fromOneRm * 0.9;
  }
  return DEFAULT_ONE_RM * 0.9;
};

type SheetLiftData = {
  key: LiftKey;
  label: string;
  tm: number;
  sets: Array<{ weight: number; reps: string }>;
};

function calculateSheetData(
  profile: Profile,
  cycle: number,
  week: Week,
  unit: Unit,
  roundStep: number
): SheetLiftData[] {
  const effectiveRoundStep = roundStep > 0 ? roundStep : unit === "kg" ? 2.5 : 5;
  
  return LIFTS.map((lift) => {
    // Calculate TM for this cycle
    // Base TM + (Cycle-1 * Increment)
    const baseTm = deriveBaseTm(profile, lift.key);
    const cycleIndex = Math.max(0, cycle - 1);
    const trainingMax = baseTm + cycleIncrement(lift.key, unit) * cycleIndex;

    const percents = weekPercents(week);
    const reps = WEEK_META[week].reps;
    
    const sets = percents.map((pct, idx) => {
      const raw = trainingMax * pct;
      const rounded = trainingMax > 0 ? roundToPlate(raw, unit, effectiveRoundStep) : 0;
      return { weight: rounded, reps: reps[idx] };
    });

    return {
      key: lift.key,
      label: lift.label,
      tm: Math.round(trainingMax),
      sets,
    };
  });
}

function SingleSheet({
  profile,
  cycle,
  week,
  unit,
  roundStep,
}: {
  profile: Profile;
  cycle: number;
  week: Week;
  unit: Unit;
  roundStep: number;
}) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);

  useEffect(() => {
    if (!profile?.uid) return;
    fetchAthleteSessions(profile.uid, 20).then(setSessions);
  }, [profile.uid]);

  const data = useMemo(
    () => calculateSheetData(profile, cycle, week, unit, roundStep),
    [profile, cycle, week, unit, roundStep]
  );

  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Athlete";
  const team = profile.team ? formatTeamLabel(profile.team) : "";

  return (
    <div className="sheet-page bg-white p-6 text-black print:p-0 print:w-full">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b-2 border-black pb-4">
        <div className="w-1/3">
          <h1 className="text-2xl font-bold uppercase tracking-tight">PL Strength</h1>
          <div className="text-sm font-medium uppercase tracking-wider text-gray-600">
            Cycle {cycle} &middot; {WEEK_META[week].title}
          </div>
        </div>

        <div className="w-1/3 flex justify-center">
          <img src="/assets/dragon.png" alt="Logo" className="h-16 w-16 object-contain grayscale" />
        </div>

        <div className="w-1/3 text-right">
          <div className="text-xl font-bold">{name}</div>
          <div className="text-sm text-gray-600">{team}</div>
          <div className="mt-1 text-xs text-gray-500">Date: ____________________</div>
        </div>
      </div>

      {/* Main Lifts Table */}
      <div className="mb-8">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-gray-500">
          Main Lifts
        </h2>
        <table className="w-full border-collapse border border-black text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-2 text-left font-bold uppercase">Lift</th>
              <th className="border border-black p-2 text-center font-bold uppercase w-16">TM</th>
              <th className="border border-black p-2 text-center font-bold uppercase">Set 1</th>
              <th className="border border-black p-2 text-center font-bold uppercase">Set 2</th>
              <th className="border border-black p-2 text-center font-bold uppercase">Set 3</th>
              <th className="border border-black p-2 text-center font-bold uppercase w-24">Actual</th>
              <th className="border border-black p-2 text-left font-bold uppercase">Notes</th>
            </tr>
          </thead>
          <tbody>
            {data.map((lift) => {
              const session = sessions.find(
                (s) => s.cycle === cycle && s.week === week && s.lift === lift.key
              );
              const actualReps = session?.work?.[session.work.length - 1]?.actualReps;
              const note = session?.note;

              return (
                <tr key={lift.key}>
                  <td className="border border-black p-3 font-bold">{lift.label}</td>
                  <td className="border border-black p-3 text-center text-gray-600">
                    {lift.tm}
                  </td>
                  {lift.sets.map((set, idx) => (
                    <td key={idx} className="border border-black p-3 text-center">
                      <div className="font-bold text-lg">{formatWeightValue(set.weight)}</div>
                      <div className="text-xs text-gray-500">x {set.reps}</div>
                    </td>
                  ))}
                  <td className="border border-black p-3 text-center font-bold text-lg">
                    {actualReps ?? ""}
                  </td>
                  <td className="border border-black p-3 text-sm">
                    {note ?? ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Accessories / Notes */}
      <div className="grid grid-cols-2 gap-6">
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            Accessories
          </h2>
          <div className="h-48 rounded border border-black p-2">
            {/* Lines for writing */}
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-gray-300 h-8"></div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-gray-500">
            Coach Notes
          </h2>
          <div className="h-48 rounded border border-black p-2">
             {/* Lines for writing */}
             {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border-b border-gray-300 h-8"></div>
            ))}
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center text-[10px] text-gray-400 uppercase tracking-widest">
        Generated by PL Strength
      </div>
    </div>
  );
}

export default function Sheets() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());
  const [selectedCycle, setSelectedCycle] = useState<number>(1);
  const [selectedWeek, setSelectedWeek] = useState<Week>(1);
  const [roundStep, setRoundStep] = useState<number>(5);
  const [batchMode, setBatchMode] = useState(false);
  const [roster, setRoster] = useState<Profile[]>([]);
  const [loadingRoster, setLoadingRoster] = useState(false);

  const { activeAthlete, isCoach } = useActiveAthlete();
  const targetUid = isCoach && activeAthlete ? activeAthlete.uid : undefined;

  // Load single profile
  useEffect(() => {
    (async () => {
      if (batchMode) return; // Don't load single profile in batch mode
      
      let resolved: Profile | null = null;
      if (targetUid) {
        resolved = await loadProfileRemote(targetUid);
      } else {
        const local = loadProfileLocal();
        const uid = await ensureAnon();
        const remote = await loadProfileRemote(uid);
        resolved = remote ?? (local as Profile | null);
      }
      
      if (resolved) {
        setProfile(resolved);
      } else if (targetUid && activeAthlete) {
        // Fallback for active athlete without full profile doc
        setProfile({
          uid: targetUid,
          firstName: activeAthlete.firstName ?? "",
          lastName: activeAthlete.lastName ?? "",
          unit: (activeAthlete.unit as Unit) || "lb",
          team: (activeAthlete.team as any) ?? undefined,
          tm: {},
          oneRm: {},
          accessCode: null,
          equipment: defaultEquipment(),
        });
      }
    })();
  }, [targetUid, activeAthlete, batchMode]);

  // Load roster for batch mode
  useEffect(() => {
    if (!batchMode || !teamSelection) {
      setRoster([]);
      return;
    }
    
    (async () => {
      setLoadingRoster(true);
      try {
        const profiles = await fetchTeamProfiles(teamSelection, { excludeRoles: ["coach"] });
        // Sort by name
        profiles.sort((a, b) => {
          const nameA = (a.lastName + a.firstName).toLowerCase();
          const nameB = (b.lastName + b.firstName).toLowerCase();
          return nameA.localeCompare(nameB);
        });
        setRoster(profiles);
      } catch (err) {
        console.error("Failed to load roster", err);
      } finally {
        setLoadingRoster(false);
      }
    })();
  }, [batchMode, teamSelection]);

  // Sync unit/rounding
  useEffect(() => {
    const unit = profile?.unit ?? "lb";
    const defaultStep = unit === "kg" ? 2.5 : 5;
    setRoundStep(defaultStep);
  }, [profile?.unit]);

  const unit = (profile?.unit ?? "lb") as Unit;

  return (
    <div className="container py-6">
      <div className="flex items-center justify-between mb-6 no-print">
        <h1 className="text-2xl font-semibold">Printable Sheets</h1>
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print Sheets
        </button>
      </div>

      {/* Controls */}
      <div className="card mb-8 space-y-4 no-print bg-gray-50 border-gray-200">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {isCoach && (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Mode</span>
              <div className="flex items-center gap-2 mt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={!batchMode}
                    onChange={() => setBatchMode(false)}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm">Single Athlete</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={batchMode}
                    onChange={() => setBatchMode(true)}
                    className="text-brand-600 focus:ring-brand-500"
                  />
                  <span className="text-sm">Batch (Team)</span>
                </label>
              </div>
            </label>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Cycle</span>
            <select
              className="field bg-white"
              value={selectedCycle}
              onChange={(e) => setSelectedCycle(Number(e.target.value))}
            >
              {[1, 2, 3].map((c) => (
                <option key={c} value={c}>
                  Cycle {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Week</span>
            <select
              className="field bg-white"
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value) as Week)}
            >
              {Object.entries(WEEK_META).map(([w, meta]) => (
                <option key={w} value={w}>
                  {meta.title}
                </option>
              ))}
            </select>
          </label>
          

        </div>
        
        {batchMode && (
           <div className="text-sm text-gray-600">
              Generating sheets for <strong>{roster.length}</strong> athletes in <strong>{formatTeamLabel(teamSelection)}</strong>.
              {loadingRoster && " Loading..."}
           </div>
        )}
      </div>

      {/* Content Area */}
      <div className="print-area">
        {batchMode ? (
          <div>
            {roster.map((p) => (
              <div key={p.uid} className="print:break-after-page mb-8 print:mb-0 border-b-4 border-gray-200 print:border-0 pb-8 print:pb-0">
                <SingleSheet
                  profile={p}
                  cycle={selectedCycle}
                  week={selectedWeek}
                  unit={p.unit}
                  roundStep={roundStep}
                />
              </div>
            ))}
            {roster.length === 0 && !loadingRoster && (
               <div className="text-center py-12 text-gray-500">
                  No athletes found for this team.
               </div>
            )}
          </div>
        ) : (
          profile ? (
            <SingleSheet
              profile={profile}
              cycle={selectedCycle}
              week={selectedWeek}
              unit={unit}
              roundStep={roundStep}
            />
          ) : (
            <div className="text-center py-12 text-gray-500">
               Loading profile...
            </div>
          )
        )}
      </div>
      
      <style>
        {`
          @media print {
            @page { margin: 0.5cm; }
            body { background: white; }
            .no-print { display: none !important; }
            .container { max-width: none; padding: 0; }
            .print\\:break-after-page { break-after: page; page-break-after: always; }
          }
        `}
      </style>
    </div>
  );
}




