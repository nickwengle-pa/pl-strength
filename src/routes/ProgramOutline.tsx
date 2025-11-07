import React, { useEffect, useMemo, useState } from "react";
import { ensureAnon, isCoach, isAdmin, subscribeToRoleChanges } from "../lib/db";

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

type AccessoryItem = { name: string; prescription: string };

type ProgramOutlineData = {
  turfWarmup: string[];
  hipMobility: {
    note: string;
    url: string;
    embed: string;
  };
  plyometrics: string[];
  plyoDays: string[];
  coreWarmup: string[];
  liftWeeks: Array<{ week: string; days: string[] }>;
  deadliftAccessory: AccessoryItem[];
  benchAccessory: AccessoryItem[];
  squatAccessory: AccessoryItem[];
};

const DEFAULT_OUTLINE: ProgramOutlineData = {
  turfWarmup: [...TURF_WARMUP],
  hipMobility: { ...HIP_MOBILITY },
  plyometrics: [...PLYOMETRICS],
  plyoDays: [...PLYO_DAYS],
  coreWarmup: [...CORE_WARMUP],
  liftWeeks: LIFT_WEEKS.map((week) => ({ week: week.week, days: [...week.days] })),
  deadliftAccessory: DEADLIFT_ACCESSORY.map((item) => ({ ...item })),
  benchAccessory: BENCH_ACCESSORY.map((item) => ({ ...item })),
  squatAccessory: SQUAT_ACCESSORY.map((item) => ({ ...item })),
};

const OUTLINE_STORAGE_KEY = "pl-strength.program-outline";
const OUTLINE_LIBRARY_STORAGE_KEY = "pl-strength.program-outline.library";

type OutlineLibrary = {
  turfWarmup: string[];
  plyometrics: string[];
  plyoDays: string[];
  coreWarmup: string[];
  liftWeekNames: string[];
  liftDays: string[];
  deadliftAccessory: AccessoryItem[];
  benchAccessory: AccessoryItem[];
  squatAccessory: AccessoryItem[];
};

function isMeaningfulString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed.length >= 5) return true;
  if (trimmed.length >= 3 && /\s/.test(trimmed)) return true;
  if (trimmed.length >= 3 && /\d/.test(trimmed)) return true;
  if (/^[A-Z]{2,}$/.test(trimmed)) return true;
  return false;
}

function createUniqueStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  values.forEach((value) => {
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (!isMeaningfulString(trimmed)) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    output.push(trimmed);
  });
  const sorted = output.sort((a, b) => a.localeCompare(b));
  return sorted.filter((entry) => {
    if (entry.length > 3) return true;
    if (/^[A-Z]{2,}$/.test(entry)) return true;
    const lower = entry.toLowerCase();
    return !sorted.some(
      (other) => other.length > entry.length && other.toLowerCase().startsWith(lower)
    );
  });
}

function createUniqueAccessoryList(values: AccessoryItem[]): AccessoryItem[] {
  const map = new Map<string, AccessoryItem>();
  values.forEach((item) => {
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!name) return;
    const prescription =
      typeof item?.prescription === "string" ? item.prescription.trim() : "";
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name, prescription });
      return;
    }
    const existing = map.get(key);
    if (existing && !existing.prescription && prescription) {
      map.set(key, { name, prescription });
    }
  });
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function buildLibraryFromOutline(outline: ProgramOutlineData): OutlineLibrary {
  return {
    turfWarmup: createUniqueStringList(outline.turfWarmup),
    plyometrics: createUniqueStringList(outline.plyometrics),
    plyoDays: createUniqueStringList(outline.plyoDays),
    coreWarmup: createUniqueStringList(outline.coreWarmup),
    liftWeekNames: createUniqueStringList(outline.liftWeeks.map((week) => week.week)),
    liftDays: createUniqueStringList(
      outline.liftWeeks.flatMap((week) => week.days)
    ),
    deadliftAccessory: createUniqueAccessoryList(outline.deadliftAccessory),
    benchAccessory: createUniqueAccessoryList(outline.benchAccessory),
    squatAccessory: createUniqueAccessoryList(outline.squatAccessory),
  };
}

const DEFAULT_LIBRARY: OutlineLibrary = buildLibraryFromOutline(DEFAULT_OUTLINE);

function normalizeStoredStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[])
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter((entry) => entry.trim().length > 0);
}

function normalizeStoredAccessoryArray(value: unknown): AccessoryItem[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((entry) => ({
    name: typeof (entry as any)?.name === "string" ? (entry as any).name : "",
    prescription:
      typeof (entry as any)?.prescription === "string"
        ? (entry as any).prescription
        : "",
  }));
}

function normalizeLibraryCandidate(input: any): OutlineLibrary {
  if (!input || typeof input !== "object") {
    return DEFAULT_LIBRARY;
  }
  return {
    turfWarmup: createUniqueStringList(normalizeStoredStringArray(input.turfWarmup)),
    plyometrics: createUniqueStringList(normalizeStoredStringArray(input.plyometrics)),
    plyoDays: createUniqueStringList(normalizeStoredStringArray(input.plyoDays)),
    coreWarmup: createUniqueStringList(normalizeStoredStringArray(input.coreWarmup)),
    liftWeekNames: createUniqueStringList(
      normalizeStoredStringArray(input.liftWeekNames)
    ),
    liftDays: createUniqueStringList(normalizeStoredStringArray(input.liftDays)),
    deadliftAccessory: createUniqueAccessoryList(
      normalizeStoredAccessoryArray(input.deadliftAccessory)
    ),
    benchAccessory: createUniqueAccessoryList(
      normalizeStoredAccessoryArray(input.benchAccessory)
    ),
    squatAccessory: createUniqueAccessoryList(
      normalizeStoredAccessoryArray(input.squatAccessory)
    ),
  };
}

function mergeLibrary(base: OutlineLibrary, outline: ProgramOutlineData): OutlineLibrary {
  const extracted = buildLibraryFromOutline(outline);
  return {
    turfWarmup: createUniqueStringList([...base.turfWarmup, ...extracted.turfWarmup]),
    plyometrics: createUniqueStringList([...base.plyometrics, ...extracted.plyometrics]),
    plyoDays: createUniqueStringList([...base.plyoDays, ...extracted.plyoDays]),
    coreWarmup: createUniqueStringList([...base.coreWarmup, ...extracted.coreWarmup]),
    liftWeekNames: createUniqueStringList([
      ...base.liftWeekNames,
      ...extracted.liftWeekNames,
    ]),
    liftDays: createUniqueStringList([...base.liftDays, ...extracted.liftDays]),
    deadliftAccessory: createUniqueAccessoryList([
      ...base.deadliftAccessory,
      ...extracted.deadliftAccessory,
    ]),
    benchAccessory: createUniqueAccessoryList([
      ...base.benchAccessory,
      ...extracted.benchAccessory,
    ]),
    squatAccessory: createUniqueAccessoryList([
      ...base.squatAccessory,
      ...extracted.squatAccessory,
    ]),
  };
}

function loadStoredLibrary(): OutlineLibrary {
  if (typeof window === "undefined") {
    return DEFAULT_LIBRARY;
  }
  try {
    const raw = window.localStorage.getItem(OUTLINE_LIBRARY_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_LIBRARY;
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeLibraryCandidate(parsed);
    return mergeLibrary(normalized, DEFAULT_OUTLINE);
  } catch (err) {
    console.warn("Failed to load outline library", err);
    return DEFAULT_LIBRARY;
  }
}

function slugifyId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "outline"
  );
}

type StringListKey = "turfWarmup" | "plyometrics" | "plyoDays" | "coreWarmup";

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const list = (value as unknown[]).map((entry) => (typeof entry === "string" ? entry : ""));
  return list.length ? list : [...fallback];
}

function normalizeAccessoryList(value: unknown, fallback: AccessoryItem[]): AccessoryItem[] {
  if (!Array.isArray(value)) {
    return fallback.map((item) => ({ ...item }));
  }
  const list = (value as unknown[]).map((entry) => ({
    name: typeof (entry as any)?.name === "string" ? (entry as any).name : "",
    prescription:
      typeof (entry as any)?.prescription === "string" ? (entry as any).prescription : "",
  }));
  return list.length ? list : fallback.map((item) => ({ ...item }));
}

function normalizeLiftWeeks(value: unknown): ProgramOutlineData["liftWeeks"] {
  const fallback = DEFAULT_OUTLINE.liftWeeks;
  if (!Array.isArray(value)) {
    return fallback.map((week) => ({ week: week.week, days: [...week.days] }));
  }
  const weeks = (value as unknown[]).map((entry, index) => {
    const raw = entry as any;
    const fallbackWeek = fallback[index] ?? {
      week: `Week ${index + 1}`,
      days: ["", "", ""],
    };
    const weekName = typeof raw?.week === "string" ? raw.week : fallbackWeek.week;
    const days = normalizeStringArray(raw?.days, fallbackWeek.days);
    while (days.length < fallbackWeek.days.length) {
      days.push("");
    }
    return { week: weekName, days };
  });
  return weeks.length ? weeks : fallback.map((week) => ({ week: week.week, days: [...week.days] }));
}

function normalizeOutline(input: any): ProgramOutlineData {
  const source = input ?? {};
  return {
    turfWarmup: normalizeStringArray(source.turfWarmup, DEFAULT_OUTLINE.turfWarmup),
    hipMobility: {
      note: typeof source?.hipMobility?.note === "string" ? source.hipMobility.note : DEFAULT_OUTLINE.hipMobility.note,
      url: typeof source?.hipMobility?.url === "string" ? source.hipMobility.url : DEFAULT_OUTLINE.hipMobility.url,
      embed:
        typeof source?.hipMobility?.embed === "string"
          ? source.hipMobility.embed
          : DEFAULT_OUTLINE.hipMobility.embed,
    },
    plyometrics: normalizeStringArray(source.plyometrics, DEFAULT_OUTLINE.plyometrics),
    plyoDays: normalizeStringArray(source.plyoDays, DEFAULT_OUTLINE.plyoDays),
    coreWarmup: normalizeStringArray(source.coreWarmup, DEFAULT_OUTLINE.coreWarmup),
    liftWeeks: normalizeLiftWeeks(source.liftWeeks),
    deadliftAccessory: normalizeAccessoryList(source.deadliftAccessory, DEFAULT_OUTLINE.deadliftAccessory),
    benchAccessory: normalizeAccessoryList(source.benchAccessory, DEFAULT_OUTLINE.benchAccessory),
    squatAccessory: normalizeAccessoryList(source.squatAccessory, DEFAULT_OUTLINE.squatAccessory),
  };
}

function loadStoredOutline(): ProgramOutlineData {
  if (typeof window === "undefined") {
    return normalizeOutline(DEFAULT_OUTLINE);
  }
  try {
    const raw = window.localStorage.getItem(OUTLINE_STORAGE_KEY);
    if (!raw) {
      return normalizeOutline(DEFAULT_OUTLINE);
    }
    const parsed = JSON.parse(raw);
    return normalizeOutline(parsed);
  } catch (err) {
    console.warn("Failed to read stored outline", err);
    return normalizeOutline(DEFAULT_OUTLINE);
  }
}

export default function ProgramOutline() {
  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [cycleCount, setCycleCount] = useState(3);
  const [selectedCycle, setSelectedCycle] = useState(1);
  const [outline, setOutline] = useState<ProgramOutlineData>(() => loadStoredOutline());
  const [library, setLibrary] = useState<OutlineLibrary>(() =>
    mergeLibrary(loadStoredLibrary(), loadStoredOutline())
  );

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureAnon();
        const [coachFlag, adminFlag] = await Promise.all([isCoach(), isAdmin()]);
        if (!active) return;
        setCoach(coachFlag || adminFlag);
        setAdmin(adminFlag);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load coach/admin status", err);
        setCoach(false);
        setAdmin(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      const adminFlag = roles.includes("admin");
      setAdmin(adminFlag);
      setCoach(adminFlag || roles.includes("coach"));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (selectedCycle > cycleCount) {
      setSelectedCycle(cycleCount || 1);
    }
  }, [cycleCount, selectedCycle]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(outline));
    } catch (err) {
      console.warn("Failed to persist program outline", err);
    }
  }, [outline]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OUTLINE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    } catch (err) {
      console.warn("Failed to persist outline library", err);
    }
  }, [library]);

  const cycleButtons = useMemo(
    () => Array.from({ length: Math.max(1, cycleCount) }, (_, i) => i + 1),
    [cycleCount]
  );

  if (loading) {
    return (
      <div className="container py-6">
        <div className="card text-sm text-gray-600">Loading outline...</div>
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

  const updateOutline = (partial: Partial<ProgramOutlineData>) => {
    setOutline((prev) => {
      const next = normalizeOutline({ ...prev, ...partial });
      setLibrary((current) => mergeLibrary(current, next));
      return next;
    });
  };

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
          {admin && (
            <button
              type="button"
              className={`btn btn-sm ${editMode ? "btn-secondary" : ""}`}
              onClick={() => setEditMode((prev) => !prev)}
            >
              {editMode ? "Done editing" : "Edit outline"}
            </button>
          )}

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

      {admin && editMode && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
          Editing mode is on. Changes save automatically in this browser for all coaches.
        </div>
      )}

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

      <OutlineCycle
        cycleNumber={selectedCycle}
        data={outline}
        editable={admin && editMode}
        onUpdate={updateOutline}
        library={library}
      />
    </div>
  );
}

type OutlineCycleProps = {
  cycleNumber: number;
  data: ProgramOutlineData;
  editable: boolean;
  onUpdate: (update: Partial<ProgramOutlineData>) => void;
  library: OutlineLibrary;
};

function OutlineCycle({ cycleNumber, data, editable, onUpdate, library }: OutlineCycleProps) {
  const updateStringList = (key: StringListKey) => (items: string[]) => {
    onUpdate({ [key]: [...items] } as Partial<ProgramOutlineData>);
  };

  const updateHipMobility = (partial: Partial<ProgramOutlineData["hipMobility"]>) => {
    onUpdate({ hipMobility: { ...data.hipMobility, ...partial } });
  };

  const cloneWeeks = () => data.liftWeeks.map((week) => ({ week: week.week, days: [...week.days] }));

  const updateLiftWeekName = (weekIndex: number, value: string) => {
    const next = cloneWeeks();
    if (!next[weekIndex]) return;
    next[weekIndex].week = value;
    onUpdate({ liftWeeks: next });
  };

  const updateLiftWeekDay = (weekIndex: number, dayIndex: number, value: string) => {
    const next = cloneWeeks();
    if (!next[weekIndex]) return;
    const days = next[weekIndex].days;
    while (days.length <= dayIndex) {
      days.push("");
    }
    days[dayIndex] = value;
    onUpdate({ liftWeeks: next });
  };

  const updateAccessory = (
    key: "deadliftAccessory" | "benchAccessory" | "squatAccessory"
  ) => (rows: AccessoryItem[]) => {
    onUpdate({ [key]: rows.map((row) => ({ ...row })) } as Partial<ProgramOutlineData>);
  };

  const dayRows = Math.max(3, ...data.liftWeeks.map((week) => week.days.length));

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

        <Section
          title="Warmup (Turf)"
          items={data.turfWarmup}
          editable={editable}
          options={library.turfWarmup}
          onItemsChange={updateStringList("turfWarmup")}
        />

        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-3">
          <div className="space-y-2">
            <h3 className="text-lg font-semibold text-gray-800">Hip Mobility Series (Turf)</h3>
            {editable ? (
              <textarea
                className="field w-full"
                rows={3}
                value={data.hipMobility.note}
                onChange={(event) => updateHipMobility({ note: event.target.value })}
              />
            ) : (
              <p>{data.hipMobility.note}</p>
            )}
          </div>
          {data.hipMobility.embed.trim() && (
            <div className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-black pt-[56.25%]">
              <iframe
                className="absolute inset-0 h-full w-full"
                src={data.hipMobility.embed}
                title="Hip mobility series"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                loading="lazy"
              />
            </div>
          )}
          {editable ? (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                Video URL
                <input
                  className="field"
                  value={data.hipMobility.url}
                  onChange={(event) => updateHipMobility({ url: event.target.value })}
                  placeholder="https://..."
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                Embed URL
                <input
                  className="field"
                  value={data.hipMobility.embed}
                  onChange={(event) => updateHipMobility({ embed: event.target.value })}
                  placeholder="https://..."
                />
              </label>
            </div>
          ) : (
            data.hipMobility.url.trim() && (
              <a
                href={data.hipMobility.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:text-brand-700"
              >
                Watch on YouTube
              </a>
            )
          )}
        </div>

        <Section
          title="Plyometrics (Turf)"
          items={data.plyometrics}
          footerLabel="Weekly emphasis"
          footerItems={data.plyoDays}
          editable={editable}
          options={library.plyometrics}
          footerOptions={library.plyoDays}
          onItemsChange={updateStringList("plyometrics")}
          onFooterItemsChange={updateStringList("plyoDays")}
        />

        <Section
          title="Warmup (All core lifts)"
          items={data.coreWarmup}
          editable={editable}
          options={library.coreWarmup}
          onItemsChange={updateStringList("coreWarmup")}
        />

        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Lift (Weightroom)</h3>
            <p className="text-sm text-gray-600">
              Align these training days with the 5/3/1 percentages for the selected cycle.
            </p>
          </div>
          {editable ? (
            <div className="space-y-4">
              {data.liftWeeks.map((week, weekIndex) => {
                const weekListId = `lift-week-${cycleNumber}-${weekIndex}`;
                return (
                  <div
                    key={weekIndex}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-2"
                  >
                    <label className="flex flex-col gap-1 text-xs font-semibold text-gray-600">
                      Week name
                      <input
                        className="field"
                        value={week.week}
                        list={library.liftWeekNames.length ? weekListId : undefined}
                        onChange={(event) => updateLiftWeekName(weekIndex, event.target.value)}
                        placeholder={
                          library.liftWeekNames.length
                            ? "Select or type a saved week name"
                            : "Week name"
                        }
                      />
                      {library.liftWeekNames.length ? (
                        <datalist id={weekListId}>
                          {library.liftWeekNames.map((option) => (
                            <option key={`${weekListId}-${option}`} value={option} />
                          ))}
                        </datalist>
                      ) : null}
                    </label>
                    {Array.from({ length: dayRows }, (_, dayIndex) => {
                      const dayListId = `lift-day-${cycleNumber}-${weekIndex}-${dayIndex}`;
                      return (
                        <div key={dayIndex} className="flex items-center gap-2">
                          <span className="w-20 text-xs text-gray-500">Day {dayIndex + 1}</span>
                          <input
                            className="field flex-1"
                            value={week.days[dayIndex] ?? ""}
                            list={library.liftDays.length ? dayListId : undefined}
                            onChange={(event) =>
                              updateLiftWeekDay(weekIndex, dayIndex, event.target.value)
                            }
                            placeholder={
                              library.liftDays.length
                                ? "Select or type a saved training focus"
                                : "Lift focus"
                            }
                          />
                          {library.liftDays.length ? (
                            <datalist id={dayListId}>
                              {library.liftDays.map((option) => (
                                <option key={`${dayListId}-${option}`} value={option} />
                              ))}
                            </datalist>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {(library.liftWeekNames.length > 0 || library.liftDays.length > 0) && (
                <details className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3 text-xs text-gray-600">
                  <summary className="cursor-pointer font-semibold text-gray-700">
                    Browse saved week layouts
                  </summary>
                  <div className="mt-2 space-y-3">
                    {library.liftWeekNames.length > 0 && (
                      <div>
                        <div className="font-semibold text-gray-700">Week names</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {library.liftWeekNames.map((option) => (
                            <span
                              key={`week-chip-${option}`}
                              className="rounded-full border border-gray-200 bg-white px-2 py-0.5"
                            >
                              {option}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {library.liftDays.length > 0 && (
                      <div>
                        <div className="font-semibold text-gray-700">Day templates</div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {library.liftDays.map((option) => (
                            <span
                              key={`day-chip-${option}`}
                              className="rounded-full border border-gray-200 bg-white px-2 py-0.5"
                            >
                              {option}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border border-gray-200 text-left text-sm text-gray-700">
                <thead>
                  <tr className="bg-gray-50">
                    {data.liftWeeks.map((week) => (
                      <th key={week.week} className="border border-gray-200 px-3 py-2 font-semibold">
                        {week.week}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: dayRows }, (_, row) => (
                    <tr key={row} className={row % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                      {data.liftWeeks.map((week) => {
                        const value = week.days[row]?.trim();
                        return (
                          <td key={`${week.week}-${row}`} className="border border-gray-200 px-3 py-2">
                            {value ? value : "-"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-600">
            See Core Breakdown Sheet for set and percent breakdowns.
          </div>
        </div>

        <AccessorySection
          title="Deadlift Accessory Lifts"
          rows={data.deadliftAccessory}
          editable={editable}
          options={library.deadliftAccessory}
          onRowsChange={updateAccessory("deadliftAccessory")}
        />
        <AccessorySection
          title="Bench Accessory Lifts"
          rows={data.benchAccessory}
          editable={editable}
          options={library.benchAccessory}
          onRowsChange={updateAccessory("benchAccessory")}
        />
        <AccessorySection
          title="Squat Accessory Lifts"
          rows={data.squatAccessory}
          editable={editable}
          options={library.squatAccessory}
          onRowsChange={updateAccessory("squatAccessory")}
        />

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
  editable?: boolean;
  options?: string[];
  footerOptions?: string[];
  onItemsChange?: (items: string[]) => void;
  onFooterItemsChange?: (items: string[]) => void;
};

function Section({
  title,
  items,
  footerLabel,
  footerItems,
  editable = false,
  options,
  footerOptions,
  onItemsChange,
  onFooterItemsChange,
}: SectionProps) {
  const displayItems = editable ? items : items.filter((item) => item.trim().length > 0);
  const displayFooter = editable
    ? footerItems ?? []
    : (footerItems ?? []).filter((item) => item.trim().length > 0);

  const addItem = () => onItemsChange?.([...items, ""]);
  const updateItem = (index: number, value: string) => {
    if (!onItemsChange) return;
    const next = [...items];
    next[index] = value;
    onItemsChange(next);
  };
  const removeItem = (index: number) => {
    if (!onItemsChange) return;
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const addFooter = () => onFooterItemsChange?.([...(footerItems ?? []), ""]);
  const updateFooter = (index: number, value: string) => {
    if (!onFooterItemsChange || !footerItems) return;
    const next = [...footerItems];
    next[index] = value;
    onFooterItemsChange(next);
  };
  const removeFooter = (index: number) => {
    if (!onFooterItemsChange || !footerItems) return;
    onFooterItemsChange(footerItems.filter((_, i) => i !== index));
  };

  const baseId = slugifyId(title);
  const optionList = options ?? [];
  const footerList = footerOptions ?? [];
  const showOptionSuggestions = editable && optionList.length > 0;
  const showFooterSuggestions = editable && footerList.length > 0;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-2">
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      {editable ? (
        <div className="space-y-3">
          {items.map((item, index) => {
            const datalistId = `${baseId}-item-${index}`;
            return (
              <div key={index} className="flex items-center gap-2">
                <input
                  className="field flex-1"
                  value={item}
                  list={showOptionSuggestions ? datalistId : undefined}
                  onChange={(event) => updateItem(index, event.target.value)}
                  placeholder={showOptionSuggestions ? "Select or type a saved item" : undefined}
                />
                {showOptionSuggestions ? (
                  <datalist id={datalistId}>
                    {optionList.map((option) => (
                      <option key={`${datalistId}-${option}`} value={option} />
                    ))}
                  </datalist>
                ) : null}
                <button
                  type="button"
                  className="btn btn-sm text-xs"
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm text-xs" onClick={addItem}>
              Add item
            </button>
            {showOptionSuggestions ? (
              <span className="text-xs text-gray-500">
                Start typing to pick from saved items or add a new one.
              </span>
            ) : null}
          </div>
          {showOptionSuggestions ? (
            <details className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3 text-xs text-gray-600">
              <summary className="cursor-pointer font-semibold text-gray-700">
                Browse saved items
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {optionList.map((option) => (
                  <span
                    key={`${baseId}-chip-${option}`}
                    className="rounded-full border border-rose-200 bg-white px-2 py-0.5"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <ul className="list-disc pl-6 space-y-1">
          {displayItems.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ul>
      )}
      {displayFooter && displayFooter.length > 0 && (
        <div className="pt-2 text-xs text-gray-600 space-y-2">
          {footerLabel && <div className="font-semibold">{footerLabel}</div>}
          {editable ? (
            <div className="space-y-3">
              {(footerItems ?? []).map((item, index) => {
                const footerId = `${baseId}-footer-${index}`;
                return (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      className="field flex-1"
                      value={item}
                      list={showFooterSuggestions ? footerId : undefined}
                      onChange={(event) => updateFooter(index, event.target.value)}
                      placeholder={showFooterSuggestions ? "Select or type a saved item" : undefined}
                    />
                    {showFooterSuggestions ? (
                      <datalist id={footerId}>
                        {footerList.map((option) => (
                          <option key={`${footerId}-${option}`} value={option} />
                        ))}
                      </datalist>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm text-xs"
                      onClick={() => removeFooter(index)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-sm text-xs" onClick={addFooter}>
                  Add item
                </button>
                {showFooterSuggestions ? (
                  <span className="text-xs text-gray-500">
                    Pick from saved emphasis points or add a new one.
                  </span>
                ) : null}
              </div>
              {showFooterSuggestions ? (
                <details className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3 text-xs text-gray-600">
                  <summary className="cursor-pointer font-semibold text-gray-700">
                    Browse saved items
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {footerList.map((option) => (
                      <span
                        key={`${baseId}-footer-chip-${option}`}
                        className="rounded-full border border-rose-200 bg-white px-2 py-0.5"
                      >
                        {option}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <ul className="list-disc pl-6 space-y-1">
              {displayFooter.map((item, index) => (
                <li key={`${item}-${index}`}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

type AccessorySectionProps = {
  title: string;
  rows: AccessoryItem[];
  editable?: boolean;
  onRowsChange?: (rows: AccessoryItem[]) => void;
  options?: AccessoryItem[];
};

function AccessorySection({
  title,
  rows,
  editable = false,
  onRowsChange,
  options,
}: AccessorySectionProps) {
  const optionList = options ?? [];
  const prescriptionList = createUniqueStringList(
    optionList.map((item) => item.prescription)
  );
  const showNameSuggestions = editable && optionList.length > 0;
  const showPrescriptionSuggestions = editable && prescriptionList.length > 0;
  const baseId = slugifyId(title);
  const displayRows = editable
    ? rows
    : rows.filter((row) => row.name.trim().length > 0 || row.prescription.trim().length > 0);

  const addRow = () => onRowsChange?.([...rows, { name: "", prescription: "" }]);
  const updateRow = (index: number, key: keyof AccessoryItem, value: string) => {
    if (!onRowsChange) return;
    const next = rows.map((row, rowIndex) => {
      if (rowIndex !== index) return { ...row };
      const previous = rows[rowIndex] ?? { name: "", prescription: "" };
      const updated: AccessoryItem = { ...row, [key]: value };
      if (key === "name") {
        const trimmed = value.trim();
        if (trimmed && optionList.length > 0) {
          const match = optionList.find(
            (opt) => opt.name.trim().toLowerCase() === trimmed.toLowerCase()
          );
          if (match && match.prescription.trim()) {
            const existingPrescription = previous.prescription?.trim() ?? "";
            if (!updated.prescription.trim() || updated.prescription === existingPrescription) {
              updated.prescription = match.prescription;
            }
          }
        }
      }
      if (key === "prescription") {
        updated.prescription = value;
      }
      return updated;
    });
    onRowsChange(next);
  };
  const removeRow = (index: number) => {
    if (!onRowsChange) return;
    onRowsChange(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3 text-sm text-gray-700">
      <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
      {editable ? (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const nameListId = `${baseId}-name-${index}`;
            const prescriptionListId = `${baseId}-prescription-${index}`;
            return (
              <div key={index} className="grid gap-2 md:grid-cols-[2fr_2fr_auto]">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500">Exercise</span>
                  <input
                    className="field"
                    value={row.name}
                    list={showNameSuggestions ? nameListId : undefined}
                    onChange={(event) => updateRow(index, "name", event.target.value)}
                    placeholder={
                      showNameSuggestions ? "Select or type a saved lift" : "Enter lift name"
                    }
                  />
                  {showNameSuggestions ? (
                    <datalist id={nameListId}>
                      {optionList.map((option) => (
                        <option key={`${nameListId}-${option.name}`} value={option.name} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-gray-500">Prescription</span>
                  <input
                    className="field"
                    value={row.prescription}
                    list={showPrescriptionSuggestions ? prescriptionListId : undefined}
                    onChange={(event) => updateRow(index, "prescription", event.target.value)}
                    placeholder={
                      showPrescriptionSuggestions
                        ? "Select or type a saved prescription"
                        : "Sets x reps"
                    }
                  />
                  {showPrescriptionSuggestions ? (
                    <datalist id={prescriptionListId}>
                      {prescriptionList.map((option) => (
                        <option key={`${prescriptionListId}-${option}`} value={option} />
                      ))}
                    </datalist>
                  ) : null}
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    className="btn btn-sm text-xs"
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-sm text-xs" onClick={addRow}>
              Add lift
            </button>
            {showNameSuggestions ? (
              <span className="text-xs text-gray-500">
                Start typing to reuse a saved lift or add a brand-new one.
              </span>
            ) : null}
          </div>
          {showNameSuggestions ? (
            <details className="rounded-xl border border-dashed border-gray-200 bg-gray-50/70 p-3 text-xs text-gray-600">
              <summary className="cursor-pointer font-semibold text-gray-700">
                Browse saved lifts
              </summary>
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {optionList.map((option) => (
                    <span
                      key={`${baseId}-lift-chip-${option.name}`}
                      className="rounded-full border border-rose-200 bg-white px-2 py-0.5"
                    >
                      {option.name}
                      {option.prescription ? ` · ${option.prescription}` : ""}
                    </span>
                  ))}
                </div>
                {showPrescriptionSuggestions ? (
                  <div>
                    <div className="mt-2 font-semibold text-gray-700">Saved prescriptions</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {prescriptionList.map((item) => (
                        <span
                          key={`${baseId}-prescription-chip-${item}`}
                          className="rounded-full border border-gray-200 bg-white px-2 py-0.5"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[280px] border border-gray-200 text-left">
            <thead>
              <tr className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <th className="border border-gray-200 px-3 py-2">Exercise</th>
                <th className="border border-gray-200 px-3 py-2">Prescription</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={`${row.name}-${row.prescription}`} className="odd:bg-white even:bg-gray-50">
                  <td className="border border-gray-200 px-3 py-2 font-medium">{row.name}</td>
                  <td className="border border-gray-200 px-3 py-2">{row.prescription}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
