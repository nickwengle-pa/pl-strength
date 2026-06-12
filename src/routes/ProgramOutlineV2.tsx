import React, { useEffect, useState } from "react";
import {
  ensureAnon,
  isCoach,
  isAdmin,
  subscribeToRoleChanges,
  loadProgramOutline,
  saveProgramOutline,
  subscribeProgramOutline,
  loadProfileRemote,
  saveProfile,
  type ProgramOutlineRecord,
  type Profile,
} from "../lib/db";
import { useDevice } from "../lib/device";

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
  url: "https://youtube.com/shorts/O3Dudt2-OQ4?si=B5WIiAZfI0OaBBQF",
  embed: "https://www.youtube.com/embed/O3Dudt2-OQ4",
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

function recordToOutline(record: ProgramOutlineRecord | null | undefined): ProgramOutlineData {
  return normalizeOutline(record ?? DEFAULT_OUTLINE);
}

function outlineToRecord(outline: ProgramOutlineData): ProgramOutlineRecord {
  return {
    turfWarmup: [...outline.turfWarmup],
    hipMobility: { ...outline.hipMobility },
    plyometrics: [...outline.plyometrics],
    plyoDays: [...outline.plyoDays],
    coreWarmup: [...outline.coreWarmup],
    liftWeeks: outline.liftWeeks.map((week) => ({ week: week.week, days: [...week.days] })),
    deadliftAccessory: outline.deadliftAccessory.map((item) => ({ ...item })),
    benchAccessory: outline.benchAccessory.map((item) => ({ ...item })),
    squatAccessory: outline.squatAccessory.map((item) => ({ ...item })),
  };
}

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

function parseUrlLoose(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    try {
      return new URL(`https://${value}`);
    } catch {
      return null;
    }
  }
}

function isYouTubeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  const url = parseUrlLoose(trimmed);
  if (!url) return false;
  const host = url.hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be";
}

function toYouTubeEmbedUrl(source: string): string {
  const trimmed = source.trim();
  if (!trimmed) return "";
  const url = parseUrlLoose(trimmed);
  if (!url) return trimmed;

  const host = url.hostname.replace(/^www\./, "");
  let videoId = "";

  if (host === "youtu.be") {
    videoId = url.pathname.slice(1);
  } else if (host === "youtube.com" || host === "m.youtube.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? "";
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.split("/")[2] ?? "";
    }
  } else {
    return trimmed;
  }

  if (!videoId) return trimmed;
  return `https://www.youtube.com/embed/${videoId}`;
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

// --- V2 Visual primitives -------------------------------------------------

function AccentLabel({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "info" }) {
  const bar = tone === "info" ? "bg-v2-info-600" : "bg-v2-accent-700";
  return (
    <div className="flex items-center gap-2">
      <span className={`h-px w-5 ${bar}`} aria-hidden />
      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-300">
        {children}
      </span>
    </div>
  );
}

function SectionCard({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md shadow-v2-elev-1 ${className}`}
    >
      {children}
    </section>
  );
}

function IconSimple({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
      <line x1="12" y1="18" x2="12" y2="18" />
    </svg>
  );
}

function IconFull({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}

function IconChevronDown({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// --- Main component ------------------------------------------------------

export default function ProgramOutlineV2() {
  const [loading, setLoading] = useState(true);
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [outline, setOutline] = useState<ProgramOutlineData>(() => loadStoredOutline());
  const [library, setLibrary] = useState<OutlineLibrary>(() =>
    mergeLibrary(loadStoredLibrary(), loadStoredOutline())
  );
  const [viewMode, setViewMode] = useState<"simple" | "full">("simple");
  const [profile, setProfile] = useState<Profile | null>(null);
  const pendingRemoteRef = React.useRef<ProgramOutlineData | null>(null);
  const editModeRef = React.useRef(editMode);

  const device = useDevice();
  const isMobileDevice = device.isMobile || (device.isTouch && !device.isDesktop);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureAnon();
        const [outlineRecord, coachFlag, adminFlag, loadedProfile] = await Promise.all([
          loadProgramOutline(),
          isCoach(),
          isAdmin(),
          loadProfileRemote(),
        ]);
        if (!active) return;
        const nextOutline = recordToOutline(outlineRecord);
        setOutline(nextOutline);
        setLibrary((current) => mergeLibrary(current, nextOutline));
        setCoach(coachFlag || adminFlag);
        setAdmin(adminFlag);
        if (loadedProfile) {
          setProfile(loadedProfile);
          // Use outlineViewMode from profile if set, otherwise default to simple for mobile
          if (loadedProfile.outlineViewMode) {
            setViewMode(loadedProfile.outlineViewMode);
          }
        }
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
    const unsubscribe = subscribeProgramOutline((record) => {
      const nextOutline = recordToOutline(record);
      if (editModeRef.current) {
        pendingRemoteRef.current = nextOutline;
        return;
      }
      setOutline(nextOutline);
      setLibrary((current) => mergeLibrary(current, nextOutline));
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(OUTLINE_LIBRARY_STORAGE_KEY, JSON.stringify(library));
    } catch (err) {
      console.warn("Failed to persist outline library", err);
    }
  }, [library]);

  // Update library only when exiting edit mode (not on every keystroke)
  const prevEditMode = React.useRef(editMode);
  useEffect(() => {
    editModeRef.current = editMode;
      if (prevEditMode.current && !editMode) {
        setLibrary((current) => mergeLibrary(current, outline));
        if (admin) {
          void saveProgramOutline(outlineToRecord(outline), { requireRemote: true }).catch((err) => {
            console.warn("Failed to sync program outline", err);
          });
        }
        if (pendingRemoteRef.current) {
        const next = pendingRemoteRef.current;
        pendingRemoteRef.current = null;
        setOutline(next);
        setLibrary((current) => mergeLibrary(current, next));
      }
    }
    prevEditMode.current = editMode;
  }, [editMode, outline, admin]);

  if (loading) {
    return (
      <div className="min-h-screen bg-v2-surface-950 px-4 py-6">
        <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md px-4 py-3 text-sm text-v2-ink-300 font-v2-body">
          Loading outline...
        </div>
      </div>
    );
  }

  const updateOutline = (partial: Partial<ProgramOutlineData>) => {
    setOutline((prev) => {
      const next = normalizeOutline({ ...prev, ...partial });
      if (admin && editMode) {
        void saveProgramOutline(outlineToRecord(next), { requireRemote: true }).catch((err) => {
          console.warn("Failed to sync program outline", err);
        });
      }
      // Library is now updated only when exiting edit mode, not on every keystroke
      return next;
    });
  };

  const toggleViewMode = async () => {
    const newMode: "simple" | "full" = viewMode === "simple" ? "full" : "simple";
    setViewMode(newMode);
    // Save to profile
    if (profile) {
      const updated: Profile = { ...profile, outlineViewMode: newMode };
      setProfile(updated);
      try {
        await saveProfile(updated, { requireRemote: true });
      } catch (err) {
        console.warn("Failed to save view mode preference", err);
      }
    }
  };

  // Determine today's lift based on day of week
  const getTodayInfo = () => {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const today = days[new Date().getDay()];

    // Look through liftWeeks to find today's lift
    // Default to week 1 pattern, but this could be enhanced to track actual week
    const weekData = outline.liftWeeks[0]; // Week 1 pattern
    const todayLift = weekData?.days.find(d => d.toLowerCase().includes(today.toLowerCase()));

    // Find plyo for today
    const todayPlyo = outline.plyoDays.find(p => p.toLowerCase().includes(today.toLowerCase()));

    // Determine which accessory set to show
    let accessories: AccessoryItem[] = [];
    let liftType = "";
    if (todayLift) {
      const liftLower = todayLift.toLowerCase();
      if (liftLower.includes("squat")) {
        accessories = outline.squatAccessory;
        liftType = "Squat";
      } else if (liftLower.includes("bench")) {
        accessories = outline.benchAccessory;
        liftType = "Bench";
      } else if (liftLower.includes("deadlift")) {
        accessories = outline.deadliftAccessory;
        liftType = "Deadlift";
      }
    }

    return { today, todayLift, todayPlyo, accessories, liftType };
  };

  const { today, todayLift, todayPlyo, accessories, liftType } = getTodayInfo();

  // Get YouTube URL for hip mobility
  const hipMobilityUrl = outline.hipMobility.url.trim() || outline.hipMobility.embed.trim();

  const useSimpleMobile = isMobileDevice && viewMode === "simple";

  return (
    <div
      className={
        useSimpleMobile
          ? "min-h-screen bg-v2-surface-950 pb-10 font-v2-body text-v2-ink-50"
          : "min-h-screen bg-v2-surface-950 font-v2-body text-v2-ink-50"
      }
    >
      {/* Header with toggle */}
      <header
        className={
          useSimpleMobile
            ? "bg-v2-surface-900 border-b border-v2-surface-800 px-4 py-4"
            : "border-b border-v2-surface-800 bg-v2-surface-900/80 px-4 md:px-8 py-5"
        }
      >
        {useSimpleMobile ? (
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-1.5">
              <AccentLabel>Program</AccentLabel>
              <h1 className="font-v2-heading text-2xl uppercase tracking-tight text-v2-ink-50">
                Daily Lifts
              </h1>
            </div>
            <div className="inline-flex items-center rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 p-0.5">
              <button
                className="p-2 rounded-v2-sm bg-v2-accent-700 text-v2-ink-50 min-h-touch transition-colors duration-v2-quick"
                title="Simple View"
              >
                <IconSimple />
              </button>
              <button
                onClick={() => toggleViewMode()}
                className="p-2 rounded-v2-sm text-v2-ink-500 hover:text-v2-ink-50 min-h-touch transition-colors duration-v2-quick"
                title="Full View"
              >
                <IconFull />
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <AccentLabel>Program</AccentLabel>
              <h1 className="font-v2-heading text-3xl md:text-4xl uppercase tracking-tight text-v2-ink-50">
                Daily Lifts
              </h1>
              <p className="text-sm text-v2-ink-300 max-w-xl">
                Reference this outline for warmups, plyos, and accessories during daily planning.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* View Mode Toggle */}
              <div className="inline-flex items-center rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 p-0.5">
                <button
                  onClick={() => viewMode !== "simple" && toggleViewMode()}
                  className={`p-2 rounded-v2-sm min-h-touch transition-colors duration-v2-quick ${
                    viewMode === "simple"
                      ? "bg-v2-accent-700 text-v2-ink-50"
                      : "text-v2-ink-500 hover:text-v2-ink-50"
                  }`}
                  title="Simple View"
                >
                  <IconSimple />
                </button>
                <button
                  onClick={() => viewMode !== "full" && toggleViewMode()}
                  className={`p-2 rounded-v2-sm min-h-touch transition-colors duration-v2-quick ${
                    viewMode === "full"
                      ? "bg-v2-accent-700 text-v2-ink-50"
                      : "text-v2-ink-500 hover:text-v2-ink-50"
                  }`}
                  title="Full View"
                >
                  <IconFull />
                </button>
              </div>

              {admin && viewMode === "full" && (
                <button
                  type="button"
                  className={`min-h-touch px-4 rounded-v2-sm font-v2-heading uppercase tracking-[0.15em] text-xs transition-colors duration-v2-quick ${
                    editMode
                      ? "bg-v2-surface-800 border border-v2-info-600 text-v2-info-600 hover:bg-v2-surface-700"
                      : "bg-v2-info-600 text-v2-ink-50 hover:brightness-110"
                  }`}
                  onClick={() => setEditMode((prev) => !prev)}
                >
                  {editMode ? "Done Editing" : "Edit Outline"}
                </button>
              )}
              {!admin && viewMode === "full" && (
                <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500 border border-v2-surface-700 bg-v2-surface-800 px-3 py-1 rounded-v2-sm">
                  View Only
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      <main className={useSimpleMobile ? "px-4 pt-4 space-y-3" : "mx-auto max-w-6xl px-4 md:px-8 py-6 space-y-6"}>
        {admin && editMode && viewMode === "full" && (
          <div className="rounded-v2-md border border-v2-info-600/60 bg-v2-info-600/10 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="h-px w-5 bg-v2-info-600" aria-hidden />
              <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-info-600">
                Editing Mode Active
              </span>
            </div>
            <p className="mt-2 text-xs text-v2-ink-300">
              Changes sync automatically across coach accounts.
            </p>
          </div>
        )}

        {/* Mobile Simple View */}
        {useSimpleMobile ? (
          <>
            {/* Today's Focus Card */}
            {todayLift ? (
              <SectionCard className="relative overflow-hidden">
                <span className="absolute inset-y-0 left-0 w-1 bg-v2-accent-700" aria-hidden />
                <div className="p-5 pl-6">
                  <AccentLabel>{today}</AccentLabel>
                  <div className="mt-3 font-v2-heading text-4xl uppercase tracking-tight text-v2-ink-50">
                    {liftType}
                  </div>
                  <div className="mt-1 text-sm text-v2-ink-300 font-v2-body">
                    {todayLift}
                  </div>
                </div>
              </SectionCard>
            ) : (
              <SectionCard>
                <div className="p-5 text-center">
                  <AccentLabel>{today}</AccentLabel>
                  <div className="mt-3 font-v2-heading text-xl uppercase tracking-tight text-v2-ink-50">
                    No Lift Scheduled
                  </div>
                  <div className="mt-1 text-xs text-v2-ink-500 uppercase tracking-wider">
                    Rest or make-up day
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Today's Accessories */}
            {accessories.length > 0 && (
              <SectionCard>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <AccentLabel>{liftType} Accessories</AccentLabel>
                  </div>
                  <div className="space-y-2">
                    {accessories.map((acc, i) => (
                      <div
                        key={i}
                        className="flex items-center justify-between bg-v2-surface-800 border border-v2-surface-700 rounded-v2-sm px-3 py-3 min-h-touch"
                      >
                        <span className="text-sm font-semibold text-v2-ink-50">{acc.name}</span>
                        <span className="font-v2-mono tabular-nums text-xs text-v2-ink-300 border border-v2-surface-700 rounded-v2-sm px-2 py-1">
                          {acc.prescription}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </SectionCard>
            )}

            {/* Weekly Schedule - Tap to expand */}
            <SectionCard>
              <details className="group">
                <summary className="p-4 cursor-pointer flex items-center gap-3 list-none min-h-touch">
                  <div className="flex-1 space-y-1">
                    <AccentLabel>Weekly Schedule</AccentLabel>
                    <div className="font-v2-heading text-base uppercase tracking-tight text-v2-ink-50">
                      All Weeks
                    </div>
                  </div>
                  <IconChevronDown className="w-5 h-5 text-v2-ink-500 transition-transform duration-v2-quick group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-4 space-y-3 border-t border-v2-surface-800 pt-3">
                  {outline.liftWeeks.map((week, i) => (
                    <div key={i} className="bg-v2-surface-800 border border-v2-surface-700 rounded-v2-sm p-3">
                      <div className="font-v2-heading text-sm uppercase tracking-tight text-v2-ink-50">
                        {week.week}
                      </div>
                      <div className="text-xs text-v2-ink-300 mt-1 leading-relaxed">
                        {week.days.filter(d => d.trim()).join(" -> ")}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </SectionCard>

            {/* All Accessories - Tap to expand */}
            <SectionCard>
              <details className="group">
                <summary className="p-4 cursor-pointer flex items-center gap-3 list-none min-h-touch">
                  <div className="flex-1 space-y-1">
                    <AccentLabel>All Accessories</AccentLabel>
                    <div className="font-v2-heading text-base uppercase tracking-tight text-v2-ink-50">
                      Full List By Lift
                    </div>
                  </div>
                  <IconChevronDown className="w-5 h-5 text-v2-ink-500 transition-transform duration-v2-quick group-open:rotate-180" />
                </summary>
                <div className="px-4 pb-4 space-y-5 border-t border-v2-surface-800 pt-4">
                  {[
                    { title: "Squat", items: outline.squatAccessory },
                    { title: "Bench", items: outline.benchAccessory },
                    { title: "Deadlift", items: outline.deadliftAccessory },
                  ].map((group) => (
                    <div key={group.title} className="space-y-2">
                      <AccentLabel>{group.title}</AccentLabel>
                      <div className="space-y-1">
                        {group.items.map((acc, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between text-sm py-2 border-b border-v2-surface-800 last:border-b-0"
                          >
                            <span className="text-v2-ink-50">{acc.name}</span>
                            <span className="font-v2-mono tabular-nums text-xs text-v2-ink-300">
                              {acc.prescription}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </SectionCard>
          </>
        ) : (
          /* Desktop/Full View */
          <OutlinePanel
            data={outline}
            editable={admin && editMode}
            onUpdate={updateOutline}
            library={library}
          />
        )}
      </main>
    </div>
  );
}

type OutlinePanelProps = {
  data: ProgramOutlineData;
  editable: boolean;
  onUpdate: (update: Partial<ProgramOutlineData>) => void;
  library: OutlineLibrary;
};

function OutlinePanel({ data, editable, onUpdate, library }: OutlinePanelProps) {
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
  const hipMobilityUrl = data.hipMobility.url.trim();
  const hipMobilityEmbedSource = isYouTubeUrl(hipMobilityUrl)
    ? hipMobilityUrl
    : data.hipMobility.embed.trim() || hipMobilityUrl;
  const hipMobilityEmbed = toYouTubeEmbedUrl(hipMobilityEmbedSource);

  const fieldCls =
    "w-full bg-v2-surface-950 border border-v2-surface-700 rounded-v2-sm px-3 py-2 text-sm text-v2-ink-50 placeholder:text-v2-ink-500 focus:outline-none focus:border-v2-info-600 transition-colors duration-v2-quick";
  const smallBtnCls =
    "min-h-touch px-3 rounded-v2-sm font-v2-heading uppercase tracking-[0.15em] text-v2-xs bg-v2-surface-800 border border-v2-surface-700 text-v2-ink-50 hover:border-v2-info-600 transition-colors duration-v2-quick";
  const primaryBtnCls =
    "min-h-touch px-3 rounded-v2-sm font-v2-heading uppercase tracking-[0.15em] text-v2-xs bg-v2-info-600 text-v2-ink-50 hover:brightness-110 transition-colors duration-v2-quick";

  return (
    <div className="space-y-6">
      <SectionCard>
        <div className="p-5 space-y-5">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <AccentLabel>Lift Outline</AccentLabel>
              <h2 className="font-v2-heading text-2xl uppercase tracking-tight text-v2-ink-50">
                Team Briefing
              </h2>
              <p className="text-sm text-v2-ink-300 max-w-2xl">
                Use this outline for team briefing and daily planning. Adjust notes to match the specific roster and facilities.
              </p>
            </div>
          </header>

          <nav className="flex flex-wrap justify-center gap-2">
            {[
              { label: "Turf", target: "section-turf" },
              { label: "Mobility Video", target: "section-mobility" },
              { label: "Lifts & Accessory", target: "section-lifts" },
            ].map((btn) => (
              <button
                key={btn.target}
                type="button"
                onClick={() =>
                  document
                    .getElementById(btn.target)
                    ?.scrollIntoView({ behavior: "smooth", block: "center" })
                }
                className="px-4 py-2 font-v2-heading uppercase tracking-[0.15em] text-v2-xs rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 text-v2-ink-300 hover:text-v2-ink-50 hover:border-v2-accent-700 transition-colors duration-v2-quick"
              >
                {btn.label}
              </button>
            ))}
          </nav>

          <SectionCard id="section-turf" className="bg-v2-surface-800">
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <AccentLabel>Turf Block</AccentLabel>
                <h3 className="font-v2-heading text-xl uppercase tracking-tight text-v2-ink-50">
                  Warmup, Mobility & Plyometrics
                </h3>
                <p className="text-sm text-v2-ink-300">
                  Keep turf prep, mobility, and plyo planning in one place for faster session setup.
                </p>
              </div>

              <Section
                title="Warmup (Turf)"
                items={data.turfWarmup}
                editable={editable}
                options={library.turfWarmup}
                onItemsChange={updateStringList("turfWarmup")}
              />

              <Section
                title="Plyometrics (Turf)"
                items={data.plyometrics}
                footerLabel="Weekly Emphasis"
                footerItems={data.plyoDays}
                editable={editable}
                options={library.plyometrics}
                footerOptions={library.plyoDays}
                onItemsChange={updateStringList("plyometrics")}
                onFooterItemsChange={updateStringList("plyoDays")}
              />

              <SectionCard id="section-mobility" className="bg-v2-surface-900">
                <div className="p-4 space-y-3 text-sm text-v2-ink-300">
                  <div className="space-y-2">
                    <AccentLabel>Mobility Video</AccentLabel>
                    <h3 className="font-v2-heading text-lg uppercase tracking-tight text-v2-ink-50">
                      Hip Mobility Series (Turf)
                    </h3>
                    {editable ? (
                      <textarea
                        className={fieldCls}
                        rows={3}
                        value={data.hipMobility.note}
                        onChange={(event) => updateHipMobility({ note: event.target.value })}
                      />
                    ) : (
                      <p className="text-v2-ink-300">{data.hipMobility.note}</p>
                    )}
                  </div>
                  {hipMobilityEmbed && (
                    <div className="max-w-sm">
                      <div className="relative w-full overflow-hidden rounded-v2-sm border border-v2-surface-700 bg-black pt-[56.25%]">
                        <iframe
                          className="absolute inset-0 h-full w-full"
                          src={hipMobilityEmbed}
                          title="Hip mobility series"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          loading="lazy"
                        />
                      </div>
                    </div>
                  )}
                  {editable ? (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1 font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500">
                        Video URL
                        <input
                          className={fieldCls}
                          value={data.hipMobility.url}
                          onChange={(event) => updateHipMobility({ url: event.target.value })}
                          placeholder="https://..."
                        />
                      </label>
                      <label className="flex flex-col gap-1 font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500">
                        Embed URL
                        <input
                          className={fieldCls}
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
                        className="inline-flex items-center gap-2 font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-accent-700 hover:brightness-125 transition"
                      >
                        <span className="h-px w-4 bg-v2-accent-700" aria-hidden />
                        Watch On YouTube
                      </a>
                    )
                  )}
                </div>
              </SectionCard>
            </div>
          </SectionCard>

          <SectionCard id="section-lifts" className="bg-v2-surface-800">
            <div className="p-5 space-y-4">
              <div className="space-y-2">
                <AccentLabel>Weightroom</AccentLabel>
                <h3 className="font-v2-heading text-xl uppercase tracking-tight text-v2-ink-50">
                  Main & Accessory Lifts
                </h3>
                <p className="text-sm text-v2-ink-300">
                  Keep weekly main lift structure and accessory programming together in one weightroom block.
                </p>
              </div>

              <SectionCard className="bg-v2-surface-900">
                <div className="p-4 space-y-3">
                  <div className="space-y-2">
                    <h4 className="font-v2-heading text-lg uppercase tracking-tight text-v2-ink-50">
                      Lift (Weightroom)
                    </h4>
                    <p className="text-sm text-v2-ink-300">
                      Align these training days with the 5/3/1 percentages for the current week.
                    </p>
                    <div className="text-sm text-v2-ink-500 mt-1 flex flex-wrap items-center gap-2">
                      <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-300">
                        Warmup:
                      </span>{" "}
                      {editable ? (
                        <input
                          className={`${fieldCls} inline-block w-auto flex-1 min-w-[12rem]`}
                          value={data.coreWarmup.join(", ")}
                          onChange={(event) => {
                            const items = event.target.value.split(",").map((s) => s.trim());
                            onUpdate({ coreWarmup: items });
                          }}
                          placeholder="e.g. 1 x 5 @ 40%, 1 x 5 @ 60%, 1 x 3 @ 80%"
                        />
                      ) : (
                        <span className="font-v2-mono tabular-nums text-v2-ink-300">
                          {data.coreWarmup.filter((s) => s.trim()).join("  /  ")}
                        </span>
                      )}
                    </div>
                  </div>

                  {editable ? (
                    <div className="space-y-4">
                      {data.liftWeeks.map((week, weekIndex) => {
                        const weekListId = `lift-week-${weekIndex}`;
                        return (
                          <div
                            key={weekIndex}
                            className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 p-4 space-y-2"
                          >
                            <label className="flex flex-col gap-1 font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500">
                              Week Name
                              <input
                                className={fieldCls}
                                value={week.week}
                                list={library.liftWeekNames.length ? weekListId : undefined}
                                onChange={(event) => updateLiftWeekName(weekIndex, event.target.value)}
                                placeholder={
                                  library.liftWeekNames.length
                                    ? "Select or type a saved week name"
                                    : "Week Name"
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
                              const dayListId = `lift-day-${weekIndex}-${dayIndex}`;
                              return (
                                <div key={dayIndex} className="flex items-center gap-2">
                                  <span className="w-20 font-v2-heading text-v2-xs uppercase tracking-[0.15em] text-v2-ink-500">
                                    Day {dayIndex + 1}
                                  </span>
                                  <input
                                    className={`${fieldCls} flex-1`}
                                    value={week.days[dayIndex] ?? ""}
                                    list={library.liftDays.length ? dayListId : undefined}
                                    onChange={(event) =>
                                      updateLiftWeekDay(weekIndex, dayIndex, event.target.value)
                                    }
                                    placeholder={
                                      library.liftDays.length
                                        ? "Select or type a saved training focus"
                                        : "Lift Focus"
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
                        <details className="rounded-v2-sm border border-dashed border-v2-surface-700 bg-v2-surface-900 p-3 text-xs text-v2-ink-300">
                          <summary className="cursor-pointer font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-50">
                            Browse Saved Week Layouts
                          </summary>
                          <div className="mt-2 space-y-3">
                            {library.liftWeekNames.length > 0 && (
                              <div>
                                <AccentLabel tone="info">Week Names</AccentLabel>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {library.liftWeekNames.map((option) => (
                                    <span
                                      key={`week-chip-${option}`}
                                      className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-2 py-0.5 text-xs text-v2-ink-300"
                                    >
                                      {option}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {library.liftDays.length > 0 && (
                              <div>
                                <AccentLabel tone="info">Day Templates</AccentLabel>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {library.liftDays.map((option) => (
                                    <span
                                      key={`day-chip-${option}`}
                                      className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-800 px-2 py-0.5 text-xs text-v2-ink-300"
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
                      <table className="min-w-full border border-v2-surface-700 text-left text-sm text-v2-ink-300">
                        <thead>
                          <tr className="bg-v2-surface-800">
                            {data.liftWeeks.map((week) => (
                              <th
                                key={week.week}
                                className="border border-v2-surface-700 px-3 py-2 font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-50"
                              >
                                {week.week}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({ length: dayRows }, (_, row) => (
                            <tr key={row} className={row % 2 === 0 ? "bg-v2-surface-900" : "bg-v2-surface-800/50"}>
                              {data.liftWeeks.map((week) => {
                                const value = week.days[row]?.trim();
                                return (
                                  <td key={`${week.week}-${row}`} className="border border-v2-surface-700 px-3 py-2">
                                    {value ? value : <span className="text-v2-ink-500">-</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="rounded-v2-sm border border-dashed border-v2-surface-700 bg-v2-surface-950 px-3 py-2 text-xs text-v2-ink-300">
                    See core breakdown sheet for set and percent breakdowns.
                  </div>
                </div>
              </SectionCard>

              <div className="grid gap-4 xl:grid-cols-3">
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
              </div>

              <div className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-3 py-2 text-xs text-v2-ink-300">
                Reference the Exercises tab for sample technique videos.
              </div>
            </div>
          </SectionCard>
        </div>
      </SectionCard>
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

  const fieldCls =
    "w-full bg-v2-surface-950 border border-v2-surface-700 rounded-v2-sm px-3 py-2 text-sm text-v2-ink-50 placeholder:text-v2-ink-500 focus:outline-none focus:border-v2-info-600 transition-colors duration-v2-quick";
  const smallBtnCls =
    "min-h-touch px-3 rounded-v2-sm font-v2-heading uppercase tracking-[0.15em] text-v2-xs bg-v2-surface-800 border border-v2-surface-700 text-v2-ink-50 hover:border-v2-info-600 transition-colors duration-v2-quick";

  return (
    <div className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 p-4 text-sm text-v2-ink-300 space-y-3">
      <div className="space-y-1">
        <AccentLabel>{title}</AccentLabel>
      </div>
      {editable ? (
        <div className="space-y-3">
          {items.map((item, index) => {
            const datalistId = `${baseId}-item-${index}`;
            return (
              <div key={index} className="flex items-center gap-2">
                <input
                  className={`${fieldCls} flex-1`}
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
                  className={smallBtnCls}
                  onClick={() => removeItem(index)}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={smallBtnCls} onClick={addItem}>
              Add Item
            </button>
            {showOptionSuggestions ? (
              <span className="text-xs text-v2-ink-500">
                Start typing to pick from saved items or add a new one.
              </span>
            ) : null}
          </div>
          {showOptionSuggestions ? (
            <details className="rounded-v2-sm border border-dashed border-v2-surface-700 bg-v2-surface-800 p-3 text-xs text-v2-ink-300">
              <summary className="cursor-pointer font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-50">
                Browse Saved Items
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {optionList.map((option) => (
                  <span
                    key={`${baseId}-chip-${option}`}
                    className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-2 py-0.5"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <ul className="space-y-1">
          {displayItems.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex items-start gap-2 text-sm text-v2-ink-50"
            >
              <span className="mt-2 h-px w-3 shrink-0 bg-v2-accent-700" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
      {displayFooter && displayFooter.length > 0 && (
        <div className="pt-2 text-xs text-v2-ink-300 space-y-2 border-t border-v2-surface-800">
          {footerLabel && (
            <div className="pt-2">
              <AccentLabel>{footerLabel}</AccentLabel>
            </div>
          )}
          {editable ? (
            <div className="space-y-3">
              {(footerItems ?? []).map((item, index) => {
                const footerId = `${baseId}-footer-${index}`;
                return (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      className={`${fieldCls} flex-1`}
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
                      className={smallBtnCls}
                      onClick={() => removeFooter(index)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={smallBtnCls} onClick={addFooter}>
                  Add Item
                </button>
                {showFooterSuggestions ? (
                  <span className="text-xs text-v2-ink-500">
                    Pick from saved emphasis points or add a new one.
                  </span>
                ) : null}
              </div>
              {showFooterSuggestions ? (
                <details className="rounded-v2-sm border border-dashed border-v2-surface-700 bg-v2-surface-800 p-3 text-xs text-v2-ink-300">
                  <summary className="cursor-pointer font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-50">
                    Browse Saved Items
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {footerList.map((option) => (
                      <span
                        key={`${baseId}-footer-chip-${option}`}
                        className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-2 py-0.5"
                      >
                        {option}
                      </span>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <ul className="space-y-1">
              {displayFooter.map((item, index) => (
                <li
                  key={`${item}-${index}`}
                  className="flex items-start gap-2 text-v2-ink-50"
                >
                  <span className="mt-2 h-px w-3 shrink-0 bg-v2-accent-700" aria-hidden />
                  <span>{item}</span>
                </li>
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

  const fieldCls =
    "w-full bg-v2-surface-950 border border-v2-surface-700 rounded-v2-sm px-3 py-2 text-sm text-v2-ink-50 placeholder:text-v2-ink-500 focus:outline-none focus:border-v2-info-600 transition-colors duration-v2-quick";
  const smallBtnCls =
    "min-h-touch px-3 rounded-v2-sm font-v2-heading uppercase tracking-[0.15em] text-v2-xs bg-v2-surface-800 border border-v2-surface-700 text-v2-ink-50 hover:border-v2-info-600 transition-colors duration-v2-quick";

  return (
    <div className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 p-4 space-y-3 text-sm text-v2-ink-300">
      <div className="space-y-1">
        <AccentLabel>{title}</AccentLabel>
      </div>
      {editable ? (
        <div className="space-y-3">
          {rows.map((row, index) => {
            const nameListId = `${baseId}-name-${index}`;
            const prescriptionListId = `${baseId}-prescription-${index}`;
            return (
              <div key={index} className="grid gap-2 md:grid-cols-[2fr_2fr_auto]">
                <div className="flex flex-col gap-1">
                  <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500">
                    Exercise
                  </span>
                  <input
                    className={fieldCls}
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
                  <span className="font-v2-heading text-v2-xs uppercase tracking-[0.2em] text-v2-ink-500">
                    Prescription
                  </span>
                  <input
                    className={fieldCls}
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
                    className={smallBtnCls}
                    onClick={() => removeRow(index)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={smallBtnCls} onClick={addRow}>
              Add Lift
            </button>
            {showNameSuggestions ? (
              <span className="text-xs text-v2-ink-500">
                Start typing to reuse a saved lift or add a brand-new one.
              </span>
            ) : null}
          </div>
          {showNameSuggestions ? (
            <details className="rounded-v2-sm border border-dashed border-v2-surface-700 bg-v2-surface-800 p-3 text-xs text-v2-ink-300">
              <summary className="cursor-pointer font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-50">
                Browse Saved Lifts
              </summary>
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {optionList.map((option) => (
                    <span
                      key={`${baseId}-lift-chip-${option.name}`}
                      className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-2 py-0.5"
                    >
                      {option.name}
                      {option.prescription ? (
                        <span className="ml-1 font-v2-mono tabular-nums text-v2-ink-500">
                          - {option.prescription}
                        </span>
                      ) : ""}
                    </span>
                  ))}
                </div>
                {showPrescriptionSuggestions ? (
                  <div>
                    <div className="mt-2">
                      <AccentLabel tone="info">Saved Prescriptions</AccentLabel>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {prescriptionList.map((item) => (
                        <span
                          key={`${baseId}-prescription-chip-${item}`}
                          className="rounded-v2-sm border border-v2-surface-700 bg-v2-surface-900 px-2 py-0.5 font-v2-mono tabular-nums"
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
          <table className="min-w-[280px] border border-v2-surface-700 text-left">
            <thead>
              <tr className="bg-v2-surface-800">
                <th className="border border-v2-surface-700 px-3 py-2 font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-300">
                  Exercise
                </th>
                <th className="border border-v2-surface-700 px-3 py-2 font-v2-heading uppercase tracking-[0.15em] text-v2-xs text-v2-ink-300">
                  Prescription
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr
                  key={`${row.name}-${row.prescription}`}
                  className="odd:bg-v2-surface-900 even:bg-v2-surface-800/50"
                >
                  <td className="border border-v2-surface-700 px-3 py-2 font-medium text-v2-ink-50">
                    {row.name}
                  </td>
                  <td className="border border-v2-surface-700 px-3 py-2 font-v2-mono tabular-nums text-v2-ink-300">
                    {row.prescription}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
