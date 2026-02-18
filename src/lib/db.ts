import {
  AuthError,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  type UserCredential,
} from "firebase/auth";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  deleteDoc,
  updateDoc,
  where,
  writeBatch,
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Timestamp,
} from "firebase/firestore";
import { getSecondaryAuth, tryInitFirebase, type FirebaseHandles } from "./firebase";
import { saveProfile as saveProfileLocal } from "./storage";

const LOCAL_UID = "local";
const AUTH_DELETE_QUEUE_COLLECTION = "authDeleteQueue";

type FirebaseExports = {
  readonly app?: FirebaseHandles["app"];
  readonly auth?: FirebaseHandles["auth"];
  readonly db?: FirebaseHandles["db"];
  readonly storage?: FirebaseHandles["storage"];
};

let handlesCache: FirebaseHandles | null = null;

const resolveHandles = (): FirebaseHandles | null => {
  if (!handlesCache) {
    handlesCache = tryInitFirebase();
  }
  return handlesCache;
};

export const fb = {} as FirebaseExports;
Object.defineProperties(fb, {
  app: { enumerable: true, get: () => resolveHandles()?.app },
  auth: { enumerable: true, get: () => resolveHandles()?.auth },
  db: { enumerable: true, get: () => resolveHandles()?.db },
  storage: { enumerable: true, get: () => resolveHandles()?.storage },
});

export const hasFirebase = (): boolean => !!resolveHandles();

// ---- Profile model ----
export type Unit = "lb" | "kg";
export type Sport = "football" | "basketball";
export type Program = "boys" | "girls" | "coed";
export type Level = "varsity" | "juniorHigh";

export type Team =
  | "football-varsity"
  | "football-junior-high"
  | "girls-basketball-varsity"
  | "girls-basketball-junior-high"
  | "boys-basketball-varsity"
  | "boys-basketball-junior-high";

export type TeamDefinition = {
  id: Team;
  label: string;
  shortLabel: string;
  sport: Sport;
  program: Program;
  level: Level;
  legacy?: string[];
};

export const TEAM_DEFINITIONS: TeamDefinition[] = [
  {
    id: "football-varsity",
    label: "Football - Varsity",
    shortLabel: "Football Varsity",
    sport: "football",
    program: "coed",
    level: "varsity",
    legacy: ["varsity", "football varsity", "fb varsity"],
  },
  {
    id: "football-junior-high",
    label: "Football - Junior High",
    shortLabel: "Football JH",
    sport: "football",
    program: "coed",
    level: "juniorHigh",
    legacy: ["jh", "junior high", "football jh"],
  },
  {
    id: "girls-basketball-varsity",
    label: "Girls Basketball - Varsity",
    shortLabel: "Girls BB Varsity",
    sport: "basketball",
    program: "girls",
    level: "varsity",
    legacy: ["girls basketball varsity", "girls bball varsity"],
  },
  {
    id: "girls-basketball-junior-high",
    label: "Girls Basketball - Junior High",
    shortLabel: "Girls BB JH",
    sport: "basketball",
    program: "girls",
    level: "juniorHigh",
    legacy: ["girls basketball junior high", "girls bball jh"],
  },
  {
    id: "boys-basketball-varsity",
    label: "Boys Basketball - Varsity",
    shortLabel: "Boys BB Varsity",
    sport: "basketball",
    program: "boys",
    level: "varsity",
    legacy: ["boys basketball varsity", "boys bball varsity"],
  },
  {
    id: "boys-basketball-junior-high",
    label: "Boys Basketball - Junior High",
    shortLabel: "Boys BB JH",
    sport: "basketball",
    program: "boys",
    level: "juniorHigh",
    legacy: ["boys basketball junior high", "boys bball jh"],
  },
];

const TEAM_LOOKUP: Record<string, Team> = TEAM_DEFINITIONS.reduce(
  (acc, definition) => {
    acc[definition.id.toLowerCase()] = definition.id;
    definition.legacy?.forEach((alias) => {
      acc[alias.toLowerCase()] = definition.id;
    });
    return acc;
  },
  {} as Record<string, Team>
);

export function normalizeTeam(value: unknown): Team | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  return TEAM_LOOKUP[key];
}

export function getTeamDefinition(team?: Team | string | null): TeamDefinition | undefined {
  if (!team) return undefined;
  const key = typeof team === "string" ? normalizeTeam(team) : team;
  if (!key) return undefined;
  return TEAM_DEFINITIONS.find((definition) => definition.id === key);
}

export function formatTeamLabel(team?: Team | string | null, fallback = "Not Set"): string {
  if (!team) return fallback;
  const definition = getTeamDefinition(team);
  if (definition) {
    return definition.label;
  }
  if (typeof team === "string" && team.trim()) {
    return team;
  }
  return fallback;
}

export function getTeamGroup(team?: Team | string | null): TeamDefinition[] {
  const definition = getTeamDefinition(team);
  if (!definition) {
    return TEAM_DEFINITIONS.filter(
      (candidate) => candidate.sport === "football" && candidate.program === "coed"
    );
  }
  return TEAM_DEFINITIONS.filter(
    (candidate) =>
      candidate.sport === definition.sport && candidate.program === definition.program
  );
}

export function getTeamGroupIds(team?: Team | string | null): Team[] {
  const group = getTeamGroup(team);
  return (group.length ? group : TEAM_DEFINITIONS).map((definition) => definition.id);
}

const DEFAULT_TEAM_SCOPE: Team[] = getTeamGroupIds("football-varsity");

export function getStoredTeamSelection(): Team | "" {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem("pl-strength-team");
    const normalized = normalizeTeam(stored ?? undefined);
    return normalized ?? "";
  } catch {
    return "";
  }
}

export function setStoredTeamSelection(team: Team | ""): void {
  if (typeof window === "undefined") return;
  if (team) {
    window.localStorage.setItem("pl-strength-team", team);
  } else {
    window.localStorage.removeItem("pl-strength-team");
  }
  window.dispatchEvent(
    new CustomEvent<Team | null>("pl-team-change", { detail: team || null })
  );
}

export function resolveTeamScopes(team?: Team | string | null): Team[] {
  const scopes = getTeamGroupIds(team);
  return scopes.length ? scopes : DEFAULT_TEAM_SCOPE;
}

const TEAM_SCOPES_STORAGE_KEY = "pl-strength-team-scopes";

const PROGRAM_OUTLINE_STORAGE_KEY = "pl-strength.program-outline";
const PROGRAM_OUTLINE_COLLECTION = "config";
const PROGRAM_OUTLINE_DOC_ID = "programOutline";
const EXERCISE_LIBRARY_STORAGE_KEY = "pl-strength.exercises";
const EXERCISE_LIBRARY_DOC_ID = "exerciseLibrary";

const programOutlineRef = (database: Firestore) =>
  doc(database, PROGRAM_OUTLINE_COLLECTION, PROGRAM_OUTLINE_DOC_ID);
const exerciseLibraryRef = (database: Firestore) =>
  doc(database, PROGRAM_OUTLINE_COLLECTION, EXERCISE_LIBRARY_DOC_ID);

export type ProgramOutlineAccessory = {
  name?: string;
  prescription?: string;
};

export type ProgramOutlineRecord = {
  turfWarmup?: string[];
  hipMobility?: {
    note?: string;
    url?: string;
    embed?: string;
  };
  plyometrics?: string[];
  plyoDays?: string[];
  coreWarmup?: string[];
  liftWeeks?: Array<{
    week?: string;
    days?: string[];
  }>;
  deadliftAccessory?: ProgramOutlineAccessory[];
  benchAccessory?: ProgramOutlineAccessory[];
  squatAccessory?: ProgramOutlineAccessory[];
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
};

export type ExerciseLibraryItem = {
  name: string;
  url: string;
};

export type ExerciseLibraryStatus = {
  items: ExerciseLibraryItem[];
  updatedAtMs: number | null;
};

type ExerciseLibraryRecord = {
  items?: ExerciseLibraryItem[];
  updatedAt?: Timestamp;
  createdAt?: Timestamp;
};

const normalizeExerciseLibraryItems = (value: unknown): ExerciseLibraryItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const normalized: ExerciseLibraryItem[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const name =
      typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name.trim()
        : "";
    const url =
      typeof (entry as { url?: unknown }).url === "string"
        ? (entry as { url: string }).url.trim()
        : "";
    if (!name || !url) return;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({ name, url });
  });
  return normalized;
};

const readExerciseLibraryFromStorage = (): ExerciseLibraryItem[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EXERCISE_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeExerciseLibraryItems(parsed);
    }
    if (parsed && typeof parsed === "object") {
      const items = (parsed as { items?: unknown }).items;
      return normalizeExerciseLibraryItems(items);
    }
  } catch (err) {
    console.warn("Failed to read exercise library from storage", err);
  }
  return [];
};

const writeExerciseLibraryToStorage = (items: ExerciseLibraryItem[]): void => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      EXERCISE_LIBRARY_STORAGE_KEY,
      JSON.stringify(normalizeExerciseLibraryItems(items))
    );
  } catch (err) {
    console.warn("Failed to persist exercise library locally", err);
  }
};

const getTimestampMillis = (value: unknown): number | null => {
  if (!value || typeof value !== "object") return null;
  if ("toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  const seconds = (value as { seconds?: unknown }).seconds;
  const nanoseconds = (value as { nanoseconds?: unknown }).nanoseconds;
  if (typeof seconds === "number") {
    const nanos = typeof nanoseconds === "number" ? nanoseconds : 0;
    return Math.floor(seconds * 1000 + nanos / 1_000_000);
  }
  return null;
};

const readProgramOutlineFromStorage = (): ProgramOutlineRecord | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROGRAM_OUTLINE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as ProgramOutlineRecord;
    }
  } catch (err) {
    console.warn("Failed to read program outline from storage", err);
  }
  return null;
};

const writeProgramOutlineToStorage = (outline: ProgramOutlineRecord | null): void => {
  if (typeof window === "undefined") return;
  try {
    if (!outline) {
      window.localStorage.removeItem(PROGRAM_OUTLINE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PROGRAM_OUTLINE_STORAGE_KEY, JSON.stringify(outline));
    }
  } catch (err) {
    console.warn("Failed to persist program outline locally", err);
  }
};

export async function loadProgramOutline(): Promise<ProgramOutlineRecord | null> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    return readProgramOutlineFromStorage();
  }
  try {
    const snapshot = await getDoc(programOutlineRef(database));
    if (!snapshot.exists()) {
      return readProgramOutlineFromStorage();
    }
    const data = snapshot.data() as ProgramOutlineRecord;
    writeProgramOutlineToStorage(data);
    return data;
  } catch (err) {
    console.warn("Failed to load program outline", err);
    return readProgramOutlineFromStorage();
  }
}

export async function saveProgramOutline(
  outline: ProgramOutlineRecord,
  options?: { requireRemote?: boolean }
): Promise<void> {
  const requireRemote = options?.requireRemote === true;
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    if (requireRemote) {
      throw new Error("Firebase is not available to sync the program outline right now.");
    }
    writeProgramOutlineToStorage(outline);
    return;
  }
  try {
    const payload: Record<string, unknown> = {
      ...outline,
      updatedAt: serverTimestamp(),
    };
    if (!outline?.createdAt) {
      payload.createdAt = serverTimestamp();
    }
    await setDoc(programOutlineRef(database), payload, { merge: true });
    writeProgramOutlineToStorage(outline);
  } catch (err) {
    console.warn("Failed to save program outline", err);
    if (requireRemote) {
      throw err instanceof Error
        ? err
        : new Error("Failed to save program outline to Firebase.");
    }
    writeProgramOutlineToStorage(outline);
  }
}

export function subscribeProgramOutline(
  listener: (outline: ProgramOutlineRecord | null) => void
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    const initial = readProgramOutlineFromStorage();
    listener(initial);
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handler = (event: StorageEvent) => {
      if (event.key === PROGRAM_OUTLINE_STORAGE_KEY) {
        listener(readProgramOutlineFromStorage());
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }

  try {
    return onSnapshot(
      programOutlineRef(database),
      (snapshot) => {
        if (!snapshot.exists()) {
          listener(null);
          return;
        }
        const data = snapshot.data() as ProgramOutlineRecord;
        writeProgramOutlineToStorage(data);
        listener(data);
      },
      (error) => {
        console.warn("Program outline subscription error", error);
        listener(readProgramOutlineFromStorage());
      }
    );
  } catch (err) {
    console.warn("Failed to subscribe to program outline", err);
    listener(readProgramOutlineFromStorage());
    return () => undefined;
  }
}

export async function loadExerciseLibrary(
  fallback: ExerciseLibraryItem[] = []
): Promise<ExerciseLibraryItem[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  const fallbackList = normalizeExerciseLibraryItems(fallback);
  if (!database) {
    const local = readExerciseLibraryFromStorage();
    return local.length ? local : fallbackList;
  }
  try {
    const snapshot = await getDoc(exerciseLibraryRef(database));
    if (!snapshot.exists()) {
      const local = readExerciseLibraryFromStorage();
      return local.length ? local : fallbackList;
    }
    const data = snapshot.data() as ExerciseLibraryRecord;
    if (Array.isArray(data?.items)) {
      const items = normalizeExerciseLibraryItems(data.items);
      writeExerciseLibraryToStorage(items);
      return items;
    }
    const local = readExerciseLibraryFromStorage();
    return local.length ? local : fallbackList;
  } catch (err) {
    console.warn("Failed to load exercise library", err);
    const local = readExerciseLibraryFromStorage();
    return local.length ? local : fallbackList;
  }
}

export async function saveExerciseLibrary(
  items: ExerciseLibraryItem[],
  options?: { requireRemote?: boolean }
): Promise<void> {
  const requireRemote = options?.requireRemote === true;
  const normalized = normalizeExerciseLibraryItems(items);

  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    if (requireRemote) {
      throw new Error("Firebase is not available to sync the exercise library right now.");
    }
    writeExerciseLibraryToStorage(normalized);
    return;
  }

  try {
    const ref = exerciseLibraryRef(database);
    const existing = await getDoc(ref);
    const payload: Record<string, unknown> = {
      items: normalized,
      updatedAt: serverTimestamp(),
    };
    if (!existing.exists()) {
      payload.createdAt = serverTimestamp();
    }
    await setDoc(ref, payload, { merge: true });
    writeExerciseLibraryToStorage(normalized);
  } catch (err) {
    console.warn("Failed to save exercise library", err);
    if (requireRemote) {
      throw err instanceof Error
        ? err
        : new Error("Failed to save exercise library to Firebase.");
    }
    writeExerciseLibraryToStorage(normalized);
  }
}

export function subscribeExerciseLibrary(
  listener: (items: ExerciseLibraryItem[]) => void,
  fallback: ExerciseLibraryItem[] = []
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  const fallbackList = normalizeExerciseLibraryItems(fallback);
  const withFallback = (items: ExerciseLibraryItem[]): ExerciseLibraryItem[] =>
    items.length ? items : fallbackList;

  if (!database) {
    listener(withFallback(readExerciseLibraryFromStorage()));
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handler = (event: StorageEvent) => {
      if (event.key === EXERCISE_LIBRARY_STORAGE_KEY) {
        listener(withFallback(readExerciseLibraryFromStorage()));
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }

  try {
    return onSnapshot(
      exerciseLibraryRef(database),
      (snapshot) => {
        if (!snapshot.exists()) {
          listener(withFallback(readExerciseLibraryFromStorage()));
          return;
        }
        const data = snapshot.data() as ExerciseLibraryRecord;
        if (Array.isArray(data?.items)) {
          const items = normalizeExerciseLibraryItems(data.items);
          writeExerciseLibraryToStorage(items);
          listener(items);
          return;
        }
        listener(withFallback(readExerciseLibraryFromStorage()));
      },
      (error) => {
        console.warn("Exercise library subscription error", error);
        listener(withFallback(readExerciseLibraryFromStorage()));
      }
    );
  } catch (err) {
    console.warn("Failed to subscribe to exercise library", err);
    listener(withFallback(readExerciseLibraryFromStorage()));
    return () => undefined;
  }
}

export function subscribeExerciseLibraryStatus(
  listener: (status: ExerciseLibraryStatus) => void,
  fallback: ExerciseLibraryItem[] = []
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  const fallbackList = normalizeExerciseLibraryItems(fallback);
  const withFallback = (items: ExerciseLibraryItem[]): ExerciseLibraryItem[] =>
    items.length ? items : fallbackList;

  if (!database) {
    listener({
      items: withFallback(readExerciseLibraryFromStorage()),
      updatedAtMs: null,
    });
    if (typeof window === "undefined") {
      return () => undefined;
    }
    const handler = (event: StorageEvent) => {
      if (event.key === EXERCISE_LIBRARY_STORAGE_KEY) {
        listener({
          items: withFallback(readExerciseLibraryFromStorage()),
          updatedAtMs: null,
        });
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("storage", handler);
    };
  }

  try {
    return onSnapshot(
      exerciseLibraryRef(database),
      (snapshot) => {
        if (!snapshot.exists()) {
          listener({
            items: withFallback(readExerciseLibraryFromStorage()),
            updatedAtMs: null,
          });
          return;
        }
        const data = snapshot.data() as ExerciseLibraryRecord;
        const updatedAtMs =
          getTimestampMillis(data?.updatedAt) ?? getTimestampMillis(data?.createdAt);

        if (Array.isArray(data?.items)) {
          const items = normalizeExerciseLibraryItems(data.items);
          writeExerciseLibraryToStorage(items);
          listener({ items, updatedAtMs });
          return;
        }

        listener({
          items: withFallback(readExerciseLibraryFromStorage()),
          updatedAtMs,
        });
      },
      (error) => {
        console.warn("Exercise library status subscription error", error);
        listener({
          items: withFallback(readExerciseLibraryFromStorage()),
          updatedAtMs: null,
        });
      }
    );
  } catch (err) {
    console.warn("Failed to subscribe to exercise library status", err);
    listener({
      items: withFallback(readExerciseLibraryFromStorage()),
      updatedAtMs: null,
    });
    return () => undefined;
  }
}

export function getStoredTeamScopes(): Team[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TEAM_SCOPES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => normalizeTeam(value) ?? null)
      .filter((value): value is Team => Boolean(value));
  } catch {
    return [];
  }
}

export function setStoredTeamScopes(scopes: Team[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAM_SCOPES_STORAGE_KEY, JSON.stringify(scopes));
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(
    new CustomEvent<Team[]>("pl-team-scopes-change", { detail: scopes })
  );
}

export async function fetchCoachTeamScopes(uid?: string | null): Promise<Team[]> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const resolvedUid = uid ?? auth?.currentUser?.uid ?? null;
  if (!database || !resolvedUid) return [];
  try {
    const snap = await getDoc(roleRef(database, resolvedUid));
    if (!snap.exists()) return [];
    const data = snap.data() as any;
    if (!Array.isArray(data?.teamScopes)) return [];
    return data.teamScopes
      .map((value: unknown) => normalizeTeam(value) ?? null)
      .filter((value: Team | null): value is Team => Boolean(value));
  } catch {
    return [];
  }
}

type AccessCodeHistory = {
  roles: string[];
  teamScopes: Team[];
  teamAnchor: string | null;
  lastUsed: Timestamp;
};

export type RolesDocument = {
  roles?: string[];
  teamScopes?: Team[];
  teamAnchor?: string | null;
  accessHistory?: Record<string, AccessCodeHistory>;
};

export async function updateCoachTeamScope(team: Team | "", accessCode?: string): Promise<void> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return;
  
  const normalized = team ? normalizeTeam(team) : null;
  const ref = roleRef(database, uid);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? (snap.data() as RolesDocument) : null;
  const currentScopes = sanitizeTeamScopeArray(existing?.teamScopes);

  let nextScopes = currentScopes;
  if (normalized && !nextScopes.includes(normalized)) {
    nextScopes = [...nextScopes, normalized];
  }
  if (!nextScopes.length && normalized) {
    nextScopes = [normalized];
  }
  // If still no scopes, set defaults
  if (!nextScopes.length) {
    nextScopes = ["football-varsity", "football-junior-high"];
  }

  const teamAnchor = normalized ?? existing?.teamAnchor ?? null;
  const payload: Record<string, unknown> = {
    teamAnchor,
    updatedAt: serverTimestamp(),
  };

  // Always include teamScopes since we now have defaults
  payload.teamScopes = nextScopes;

  if (accessCode) {
    const currentRoles = await fetchRoles();
    const accessHistory = existing?.accessHistory || {};
    payload.accessHistory = {
      ...accessHistory,
      [accessCode]: {
        roles: currentRoles,
        teamScopes: normalized ? [normalized] : nextScopes,
        teamAnchor: normalized,
        lastUsed: serverTimestamp()
      }
    };
  }

  await setDoc(ref, payload, { merge: true });
}
export type BarOption = {
  id: string;
  label: string;
  weight: number;
};

export type EquipmentSettings = {
  plates: Record<Unit, number[]>;
  bars: Record<Unit, BarOption[]>;
  activeBarId: Record<Unit, string | null>;
};

export type LiftMap = {
  bench?: number;
  squat?: number;
  deadlift?: number;
};

export type LiftKey = keyof LiftMap;

export type LiftWeekMap = Partial<Record<LiftKey, 1 | 2 | 3>>;
export type LiftCycleMap = Partial<Record<LiftKey, number>>;

export type TeamTrainingState = {
  tm?: LiftMap;
  oneRm?: LiftMap;
  liftWeeks?: LiftWeekMap;
  liftCycles?: LiftCycleMap;
  currentWeek?: 1 | 2 | 3;
  currentCycle?: number;
};

export type Profile = {
  uid: string;
  firstName: string;
  lastName: string;
  unit: Unit;
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string | null;
  height?: number;
  weight?: number;
  graduationYear?: number;
  team?: Team;
  teamScopes?: Team[];
  teamAnchor?: Team;
  teamData?: Partial<Record<Team, TeamTrainingState>>;
  liftWeeks?: LiftWeekMap;
  liftCycles?: LiftCycleMap;
  tm?: LiftMap;
  oneRm?: LiftMap;
  accessCode?: string | null;
  equipment?: EquipmentSettings;
  currentWeek?: 1 | 2 | 3;
  currentCycle?: number;
  sessionMode?: "simple" | "full";
  outlineViewMode?: "simple" | "full";
};

const DEFAULT_PLATES: Record<Unit, number[]> = {
  lb: [45, 35, 25, 10, 5, 2.5, 1.25],
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5],
};

const DEFAULT_BAR_OPTIONS: Record<Unit, BarOption[]> = {
  lb: [
    { id: "bar-lb-standard-45", label: "Standard (45 lb)", weight: 45 },
    { id: "bar-lb-short-35", label: "Short (35 lb)", weight: 35 },
    { id: "bar-lb-ez-20", label: "EZ Bar (20 lb)", weight: 20 },
  ],
  kg: [
    { id: "bar-kg-standard-20", label: "Standard (20 kg)", weight: 20 },
    { id: "bar-kg-trainer-15", label: "Trainer (15 kg)", weight: 15 },
    { id: "bar-kg-technique-10", label: "Technique (10 kg)", weight: 10 },
  ],
};

const DEFAULT_ACTIVE_BAR: Record<Unit, string | null> = {
  lb: DEFAULT_BAR_OPTIONS.lb[0]?.id ?? null,
  kg: DEFAULT_BAR_OPTIONS.kg[0]?.id ?? null,
};

const cloneDefaultEquipment = (): EquipmentSettings => ({
  plates: {
    lb: [...DEFAULT_PLATES.lb],
    kg: [...DEFAULT_PLATES.kg],
  },
  bars: {
    lb: DEFAULT_BAR_OPTIONS.lb.map((bar) => ({ ...bar })),
    kg: DEFAULT_BAR_OPTIONS.kg.map((bar) => ({ ...bar })),
  },
  activeBarId: { ...DEFAULT_ACTIVE_BAR },
});

const cleanLabel = (value: string): string => {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed.slice(0, 80) : "";
};

const makeBarId = (unit: Unit, weight: number, label: string): string => {
  const base = cleanLabel(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const slug = base || "bar";
  return `bar-${unit}-${String(weight).replace(/\D+/g, "")}-${slug}`;
};

const normalizePlateList = (list: number[] | undefined, unit: Unit): number[] => {
  if (!Array.isArray(list)) {
    return [...DEFAULT_PLATES[unit]];
  }
  const source = list;
  const unique = Array.from(
    new Set(
      source
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Number(value.toFixed(3)))
    )
  );
  if (!unique.length) return [];
  unique.sort((a, b) => b - a);
  return unique;
};

const normalizeBarOptions = (bars: BarOption[] | undefined, unit: Unit): BarOption[] => {
  const source = Array.isArray(bars) ? bars : [];
  const acc = new Map<string, BarOption>();
  source.forEach((item) => {
    const weight = Number(item?.weight);
    if (!Number.isFinite(weight) || weight <= 0) return;
    const label = cleanLabel(item?.label ?? "") || `${weight} ${unit} bar`;
    const id =
      typeof item?.id === "string" && item.id.trim()
        ? item.id
        : makeBarId(unit, weight, label);
    acc.set(id, {
      id,
      label,
      weight: Number(weight.toFixed(2)),
    });
  });
  if (!acc.size) {
    if (Array.isArray(bars)) return [];
    return DEFAULT_BAR_OPTIONS[unit].map((bar) => ({ ...bar }));
  }
  return Array.from(acc.values()).sort((a, b) => b.weight - a.weight);
};

export const defaultEquipment = (): EquipmentSettings => cloneDefaultEquipment();

export const normalizeEquipment = (
  input?: EquipmentSettings | null
): EquipmentSettings => {
  const base = cloneDefaultEquipment();
  if (!input) return base;

  const result: EquipmentSettings = {
    plates: {
      lb: normalizePlateList(input.plates?.lb, "lb"),
      kg: normalizePlateList(input.plates?.kg, "kg"),
    },
    bars: {
      lb: normalizeBarOptions(input.bars?.lb, "lb"),
      kg: normalizeBarOptions(input.bars?.kg, "kg"),
    },
    activeBarId: { ...base.activeBarId },
  };

  (["lb", "kg"] as Unit[]).forEach((unit) => {
    const preferred = input.activeBarId?.[unit];
    const hasPreferred = preferred
      ? result.bars[unit].some((bar) => bar.id === preferred)
      : false;
    result.activeBarId[unit] = hasPreferred
      ? preferred!
      : result.bars[unit][0]?.id ?? null;
  });

  return result;
};

const normalizeWeek = (value: unknown): 1 | 2 | 3 | undefined => {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  return undefined;
};

const normalizeCycle = (value: unknown): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const rounded = Math.floor(parsed);
  return rounded >= 1 ? rounded : undefined;
};

const normalizeScalar = (
  value: unknown,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (typeof options.min === "number" && normalized < options.min) return undefined;
  if (typeof options.max === "number" && normalized > options.max) return undefined;
  return normalized;
};

const normalizeHeight = (value: unknown): number | undefined =>
  normalizeScalar(value, { min: 1, max: 999 });

const normalizeWeight = (value: unknown): number | undefined =>
  normalizeScalar(value, { min: 1, max: 2000 });

const normalizeGraduationYear = (value: unknown): number | undefined =>
  normalizeScalar(value, { min: 1900, max: 2100, integer: true });

const LIFT_KEYS: LiftKey[] = ["bench", "squat", "deadlift"];

const normalizeLiftMap = (value: unknown): LiftMap => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: LiftMap = {};
  LIFT_KEYS.forEach((lift) => {
    const raw = Number(source[lift]);
    if (Number.isFinite(raw)) {
      next[lift] = raw;
    }
  });
  return next;
};

const normalizeLiftWeekMap = (value: unknown): LiftWeekMap => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: LiftWeekMap = {};
  LIFT_KEYS.forEach((lift) => {
    const week = normalizeWeek(source[lift]);
    if (week) {
      next[lift] = week;
    }
  });
  return next;
};

const normalizeLiftCycleMap = (value: unknown): LiftCycleMap => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: LiftCycleMap = {};
  LIFT_KEYS.forEach((lift) => {
    const cycle = normalizeCycle(source[lift]);
    if (cycle) {
      next[lift] = cycle;
    }
  });
  return next;
};

const normalizeTeamTrainingState = (value: unknown): TeamTrainingState => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const tm = normalizeLiftMap(source.tm);
  const oneRm = normalizeLiftMap(source.oneRm);
  const liftWeeks = normalizeLiftWeekMap(source.liftWeeks);
  const liftCycles = normalizeLiftCycleMap(source.liftCycles);
  const currentWeek = normalizeWeek(source.currentWeek);
  const currentCycle = normalizeCycle(source.currentCycle);
  const state: TeamTrainingState = {};
  if (Object.keys(tm).length) state.tm = tm;
  if (Object.keys(oneRm).length) state.oneRm = oneRm;
  if (Object.keys(liftWeeks).length) state.liftWeeks = liftWeeks;
  if (Object.keys(liftCycles).length) state.liftCycles = liftCycles;
  if (currentWeek) state.currentWeek = currentWeek;
  if (currentCycle) state.currentCycle = currentCycle;
  return state;
};

const normalizeTeamTrainingMap = (
  value: unknown
): Partial<Record<Team, TeamTrainingState>> => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: Partial<Record<Team, TeamTrainingState>> = {};
  Object.entries(source).forEach(([key, entry]) => {
    const team = normalizeTeam(key);
    if (!team) return;
    const normalized = normalizeTeamTrainingState(entry);
    if (Object.keys(normalized).length === 0) return;
    next[team] = normalized;
  });
  return next;
};

const mergeTeamScopes = (...inputs: Array<Team | Team[] | undefined>): Team[] => {
  const merged: Team[] = [];
  inputs.forEach((value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => {
        if (entry && !merged.includes(entry)) merged.push(entry);
      });
      return;
    }
    if (!merged.includes(value)) merged.push(value);
  });
  return merged;
};

const resolveActiveTeam = (
  profile: Pick<Profile, "team" | "teamAnchor" | "teamScopes">,
  preferred?: Team | ""
): Team | undefined => {
  const scopes = sanitizeTeamScopeArray(profile.teamScopes);
  const anchor = normalizeTeam(profile.teamAnchor ?? profile.team);
  const preferredTeam = preferred ? normalizeTeam(preferred) : undefined;
  if (preferredTeam && scopes.includes(preferredTeam)) return preferredTeam;
  if (anchor && scopes.includes(anchor)) return anchor;
  return scopes[0] ?? anchor ?? preferredTeam;
};

const buildTeamTrainingState = (profile: Partial<Profile>): TeamTrainingState => {
  const tm = normalizeLiftMap(profile.tm);
  const oneRm = normalizeLiftMap(profile.oneRm);
  const liftWeeks = normalizeLiftWeekMap(profile.liftWeeks);
  const liftCycles = normalizeLiftCycleMap(profile.liftCycles);
  const state: TeamTrainingState = {
    tm,
    oneRm,
    currentWeek: normalizeWeek(profile.currentWeek) ?? 1,
    currentCycle: normalizeCycle(profile.currentCycle) ?? 1,
  };
  if (Object.keys(liftWeeks).length) state.liftWeeks = liftWeeks;
  if (Object.keys(liftCycles).length) state.liftCycles = liftCycles;
  return state;
};

const mergeActiveTeamData = (
  profile: Partial<Profile>,
  activeTeam?: Team
): Partial<Record<Team, TeamTrainingState>> => {
  const base = normalizeTeamTrainingMap(profile.teamData);
  if (!activeTeam) return base;
  const next = { ...base };
  const incoming = buildTeamTrainingState(profile);
  const existing = next[activeTeam] ?? {};
  next[activeTeam] = { ...existing, ...incoming };
  return next;
};

const profRef = (database: Firestore, uid: string) =>
  doc(database, "athletes", uid, "profile", "main");

let ensurePromise: Promise<string> | null = null;
let roleCache: string[] | null = null;
let rolePromise: Promise<string[]> | null = null;

type RoleListener = (roles: string[]) => void;

const roleListeners = new Set<RoleListener>();

const canonicalizeRoles = (roles: string[]): string[] =>
  Array.from(
    new Set(
      roles
        .map((role) => (typeof role === "string" ? role.trim().toLowerCase() : ""))
        .filter(Boolean)
    )
  ).sort();

const rolesMatch = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

const emitRoleChange = (roles: string[]) => {
  roleListeners.forEach((listener) => {
    try {
      listener([...roles]);
    } catch (err) {
      console.warn("Role listener failed", err);
    }
  });
};

const applyRoleCache = (roles: string[]) => {
  const canonical = canonicalizeRoles(roles);
  if (roleCache && rolesMatch(roleCache, canonical)) return;
  roleCache = canonical;
  emitRoleChange(canonical);
};

const clearRoleCache = () => {
  roleCache = null;
  emitRoleChange([]);
};

export function subscribeToRoleChanges(listener: RoleListener): () => void {
  roleListeners.add(listener);
  if (roleCache) {
    try {
      listener([...roleCache]);
    } catch (err) {
      console.warn("Role listener failed", err);
    }
  }
  return () => {
    roleListeners.delete(listener);
  };
}

export async function ensureAnon(): Promise<string> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  if (!auth) return LOCAL_UID;
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  if (ensurePromise) return ensurePromise;

  ensurePromise = new Promise<string>((resolve) => {
    const finish = (value: string) => {
      ensurePromise = null;
      resolve(value);
    };
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user?.uid) {
        unsub();
        finish(user.uid);
      }
    });
  });

  return ensurePromise;
}

const roleRef = (database: Firestore, uid: string) =>
  doc(database, "roles", uid);

const sanitizeRoleArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return canonicalizeRoles(value);
};

const sanitizeTeamScopeArray = (value: unknown): Team[] => {
  if (!Array.isArray(value)) return [];
  const scoped = value
    .map((entry) => normalizeTeam(entry) ?? null)
    .filter((entry): entry is Team => Boolean(entry));
  return Array.from(new Set(scoped));
};

const teamScopesEqual = (a: Team[], b: Team[]): boolean => {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
};

const deriveFallbackTeamScopes = (data: any): Team[] => {
  const anchor = normalizeTeam(
    data?.teamAnchor ?? data?.team ?? data?.lastTeam ?? null
  );
  if (anchor) {
    return resolveTeamScopes(anchor);
  }
  return DEFAULT_TEAM_SCOPE;
};

const maybeRepairLegacyRoleDoc = async (
  database: Firestore,
  uid: string,
  normalizedRoles: string[],
  data: any
) => {
  if (!database) return;
  const storedRoles = sanitizeRoleArray(data?.roles);
  const needsRoleRepair =
    normalizedRoles.length > 0 && !rolesMatch(storedRoles, normalizedRoles);

  const storedScopes = sanitizeTeamScopeArray(data?.teamScopes);
  const needsTeamScopeRepair =
    storedScopes.length === 0 &&
    (normalizedRoles.includes("coach") || normalizedRoles.includes("admin"));

  if (!needsRoleRepair && !needsTeamScopeRepair) return;

  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (needsRoleRepair) {
    payload.roles = normalizedRoles;
  }
  if (needsTeamScopeRepair) {
    payload.teamScopes = deriveFallbackTeamScopes(data);
  }

  try {
    await setDoc(roleRef(database, uid), payload, { merge: true });
  } catch (err) {
    console.warn("Failed to repair legacy role doc", err);
  }
};

const normalizeRoles = (raw: any): string[] => {
  if (!raw) return [];
  const baseList: string[] = Array.isArray(raw.roles)
    ? raw.roles
    : raw.role
    ? [raw.role]
    : [];
  const truthyKeys =
    typeof raw === "object" && raw
      ? Object.entries(raw)
          .filter(([key, value]) => {
            if (key === "roles" || key === "role") return false;
            if (typeof value === "boolean") return value;
            if (typeof value === "string") {
              const normalized = value.trim().toLowerCase();
              return normalized === "true" || normalized === "yes" || normalized === "1";
            }
            return false;
          })
          .map(([key]) => key)
      : [];
  const roles = [...baseList, ...truthyKeys];
  return canonicalizeRoles(roles);
};

async function fetchRoles(): Promise<string[]> {
  if (roleCache) return roleCache;
  if (rolePromise) return rolePromise;

  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) {
    applyRoleCache([]);
    return [];
  }

  rolePromise = (async () => {
    try {
      const snap = await getDoc(roleRef(database, uid));
      const data = snap.data();
      const roles = snap.exists() ? normalizeRoles(data) : [];
      applyRoleCache(roles);
      if (snap.exists()) {
        await maybeRepairLegacyRoleDoc(database, uid, roles, data);
      }
      return roles;
    } finally {
      rolePromise = null;
    }
  })();

  return rolePromise;
}

export async function refreshRoles(targetUid?: string): Promise<string[]> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = targetUid ?? auth?.currentUser?.uid;
  if (!database || !uid) {
    applyRoleCache([]);
    return [];
  }
  const snap = await getDoc(roleRef(database, uid));
  const data = snap.data();
  const roles = snap.exists() ? normalizeRoles(data) : [];
  applyRoleCache(roles);
  if (snap.exists()) {
    await maybeRepairLegacyRoleDoc(database, uid, roles, data);
  }
  return roles;
}

async function setCurrentUserRoles(nextRoles: string[]): Promise<string[]> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return [];

  const roles = canonicalizeRoles(nextRoles);

  const payload: Record<string, any> = {
    roles,
    updatedAt: serverTimestamp(),
  };

  await setDoc(roleRef(database, uid), payload, { merge: true });
  applyRoleCache(roles);
  return roles;
}

export async function getUid(): Promise<string | null> {
  const uid = await ensureAnon();
  if (!uid || uid === LOCAL_UID) return null;
  return uid;
}

function normalizeProfileData(data: Record<string, any>, targetUid: string): Profile {
  const team = normalizeTeam(data.team);
  const teamAnchor = normalizeTeam(data.teamAnchor ?? data.team);
  const teamData = normalizeTeamTrainingMap(data.teamData);
  const teamDataTeams = Object.keys(teamData)
    .map((entry) => normalizeTeam(entry))
    .filter((entry): entry is Team => Boolean(entry));
  const teamScopes = mergeTeamScopes(
    sanitizeTeamScopeArray(data.teamScopes),
    team,
    teamAnchor,
    teamDataTeams
  );
  const preferredTeam =
    typeof window !== "undefined" ? getStoredTeamSelection() : "";
  const activeTeam = resolveActiveTeam(
    { team, teamAnchor, teamScopes },
    preferredTeam
  );
  const activeState = activeTeam ? teamData[activeTeam] : undefined;
  const createdAt = toMillis(data.createdAt);
  const updatedAt = toMillis(data.updatedAt);
  const legacyTm = normalizeLiftMap(data.tm);
  const legacyOneRm = normalizeLiftMap(data.oneRm);
  const legacyLiftWeeks = normalizeLiftWeekMap(data.liftWeeks);
  const legacyLiftCycles = normalizeLiftCycleMap(data.liftCycles);
  const height = normalizeHeight(data.height);
  const weight = normalizeWeight(data.weight);
  const graduationYear = normalizeGraduationYear(data.graduationYear);
  const liftWeeks =
    activeState?.liftWeeks && Object.keys(activeState.liftWeeks).length
      ? activeState.liftWeeks
      : legacyLiftWeeks;
  const liftCycles =
    activeState?.liftCycles && Object.keys(activeState.liftCycles).length
      ? activeState.liftCycles
      : legacyLiftCycles;
  const resolvedTeam = teamAnchor ?? team ?? activeTeam;
  return {
    uid: targetUid,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    unit: (data.unit || "lb") as Unit,
    createdAt: createdAt || undefined,
    updatedAt: updatedAt || undefined,
    updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
    height,
    weight,
    graduationYear,
    team: resolvedTeam,
    teamScopes,
    teamAnchor: teamAnchor ?? resolvedTeam,
    teamData,
    liftWeeks: Object.keys(liftWeeks).length ? liftWeeks : undefined,
    liftCycles: Object.keys(liftCycles).length ? liftCycles : undefined,
    tm: activeState?.tm && Object.keys(activeState.tm).length ? activeState.tm : legacyTm,
    oneRm:
      activeState?.oneRm && Object.keys(activeState.oneRm).length
        ? activeState.oneRm
        : legacyOneRm,
    accessCode: data.accessCode ?? null,
    equipment: normalizeEquipment(data.equipment as EquipmentSettings | undefined),
    currentWeek: activeState?.currentWeek ?? normalizeWeek(data.currentWeek),
    currentCycle: activeState?.currentCycle ?? normalizeCycle(data.currentCycle),
  };
}

export async function loadProfileRemote(uid?: string): Promise<Profile | null> {
  const targetUid = uid ?? await getUid();
  if (!targetUid) return null;
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return null;
  const snap = await getDoc(profRef(database, targetUid));
  if (!snap.exists()) return null;
  return normalizeProfileData(snap.data() || {}, targetUid);
}

export async function saveProfile(
  p: Profile,
  options?: { skipLocal?: boolean; requireRemote?: boolean }
) {
  const handles = resolveHandles();
  const database = handles?.db;
  const requireRemote = options?.requireRemote === true;
  const actorUid = handles?.auth?.currentUser?.uid ?? null;
  const normalizedEquipment = normalizeEquipment(p.equipment);
  const normalizedHeight = normalizeHeight(p.height);
  const normalizedWeight = normalizeWeight(p.weight);
  const normalizedGraduationYear = normalizeGraduationYear(p.graduationYear);
  const normalizedTeam = normalizeTeam(p.team);
  const normalizedAnchor = normalizeTeam(p.teamAnchor ?? p.team);
  const baseTeamScopes = sanitizeTeamScopeArray(p.teamScopes);
  const teamDataTeams = Object.keys(normalizeTeamTrainingMap(p.teamData))
    .map((entry) => normalizeTeam(entry))
    .filter((entry): entry is Team => Boolean(entry));
  const storedSelection =
    typeof window !== "undefined" ? getStoredTeamSelection() : "";
  const activeTeam = resolveActiveTeam(
    { team: normalizedTeam, teamAnchor: normalizedAnchor, teamScopes: baseTeamScopes },
    storedSelection
  );
  const resolvedTeam = normalizedAnchor ?? normalizedTeam ?? activeTeam;
  const mergedScopes = mergeTeamScopes(
    baseTeamScopes,
    teamDataTeams,
    resolvedTeam,
    activeTeam
  );
  const mergedTeamData = mergeActiveTeamData(p, activeTeam);
  const normalizedCreatedAt = toMillis(p.createdAt);
  const normalizedProfile: Profile = {
    ...p,
    team: resolvedTeam,
    teamAnchor: normalizedAnchor ?? resolvedTeam,
    teamScopes: mergedScopes,
    teamData: mergedTeamData,
    height: normalizedHeight,
    weight: normalizedWeight,
    graduationYear: normalizedGraduationYear,
    liftWeeks: normalizeLiftWeekMap(p.liftWeeks),
    liftCycles: normalizeLiftCycleMap(p.liftCycles),
    tm: normalizeLiftMap(p.tm),
    oneRm: normalizeLiftMap(p.oneRm),
    equipment: normalizedEquipment,
    currentWeek: normalizeWeek(p.currentWeek),
    currentCycle: normalizeCycle(p.currentCycle),
    createdAt: normalizedCreatedAt || undefined,
  };
  if (!database) {
    if (options?.skipLocal || requireRemote) {
      throw new Error("Firebase is not available to sync this profile right now.");
    }
    saveProfileLocal({
      ...normalizedProfile,
      createdAt: normalizedProfile.createdAt ?? Date.now(),
    });
    return;
  }
  const ref = profRef(database, p.uid);
  const payload: Record<string, any> = {
    firstName: normalizedProfile.firstName || "",
    lastName: normalizedProfile.lastName || "",
    unit: normalizedProfile.unit || "lb",
    height: normalizedHeight ?? null,
    weight: normalizedWeight ?? null,
    graduationYear: normalizedGraduationYear ?? null,
    team: normalizedProfile.team || null,
    tm: normalizedProfile.tm || {},
    oneRm: normalizedProfile.oneRm || {},
    accessCode: normalizedProfile.accessCode ?? null,
    equipment: normalizedEquipment,
    updatedAt: serverTimestamp(),
    updatedBy: actorUid ?? normalizedProfile.uid ?? null,
  };
  if (normalizedProfile.teamAnchor) {
    payload.teamAnchor = normalizedProfile.teamAnchor;
  }
  if (normalizedProfile.teamScopes && normalizedProfile.teamScopes.length > 0) {
    payload.teamScopes = normalizedProfile.teamScopes;
  }
  if (normalizedProfile.teamData && Object.keys(normalizedProfile.teamData).length > 0) {
    payload.teamData = normalizedProfile.teamData;
  }
  if (normalizedProfile.liftWeeks && Object.keys(normalizedProfile.liftWeeks).length > 0) {
    payload.liftWeeks = normalizedProfile.liftWeeks;
  }
  if (normalizedProfile.liftCycles && Object.keys(normalizedProfile.liftCycles).length > 0) {
    payload.liftCycles = normalizedProfile.liftCycles;
  }
  if (normalizedProfile.currentWeek) {
    payload.currentWeek = normalizedProfile.currentWeek;
  }
  if (normalizedProfile.currentCycle) {
    payload.currentCycle = normalizedProfile.currentCycle;
  }
  const snap = await getDoc(ref);
  const existingCreatedAt = snap.exists() ? toMillis((snap.data() as any)?.createdAt) : 0;
  const persistedCreatedAt = existingCreatedAt || normalizedProfile.createdAt || Date.now();
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() });
  }
  if (!options?.skipLocal) {
    saveProfileLocal({
      ...normalizedProfile,
      createdAt: persistedCreatedAt,
    });
  }
}

// Update athlete's current week
export async function updateAthleteWeek(uid: string, week: 1 | 2 | 3): Promise<void> {
  const profile = await loadProfileRemote(uid);
  if (!profile) {
    throw new Error("Athlete profile not found.");
  }
  const nextLiftWeeks: LiftWeekMap = { ...(profile.liftWeeks ?? {}) };
  const nextLiftCycles: LiftCycleMap = { ...(profile.liftCycles ?? {}) };
  const baseCycle = normalizeCycle(profile.currentCycle) ?? 1;
  LIFT_KEYS.forEach((lift) => {
    nextLiftWeeks[lift] = week;
    if (!nextLiftCycles[lift]) {
      nextLiftCycles[lift] = baseCycle;
    }
  });
  await saveProfile(
    {
      ...profile,
      liftWeeks: nextLiftWeeks,
      liftCycles: nextLiftCycles,
      currentWeek: week,
    },
    { skipLocal: true, requireRemote: true }
  );
}

// Calculate TM increase suggestions based on Week 3 AMRAP performance
export async function calculateTMSuggestions(uid: string): Promise<{
  bench?: number;
  squat?: number;
  deadlift?: number;
}> {
  const profile = await loadProfileRemote(uid);
  if (!profile || !profile.tm) return {};
  
  const activeTeam =
    typeof window !== "undefined" ? normalizeTeam(getStoredTeamSelection()) : profile.team;
  const sessions = await fetchAthleteSessions(uid, 12, activeTeam ?? profile.team);
  const week3Sessions = sessions.filter(s => s.week === 3);
  
  const suggestions: Record<string, number> = {};
  
  (['bench', 'squat', 'deadlift'] as const).forEach(lift => {
    const currentTM = profile.tm?.[lift];
    if (!currentTM) return;
    
    // Find most recent Week 3 session for this lift
    const recentWeek3 = week3Sessions
      .filter(s => s.lift === lift)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    
    if (!recentWeek3) return;
    
    // Standard progression: +5 lb or +2.5 kg for upper, +10 lb or +5 kg for lower
    const unit = profile.unit || 'lb';
    const isLower = lift === 'squat' || lift === 'deadlift';
    
    if (unit === 'lb') {
      suggestions[lift] = isLower ? 10 : 5;
    } else {
      suggestions[lift] = isLower ? 5 : 2.5;
    }
  });
  
  return suggestions;
}

// Advance entire cycle - move to Week 1 and optionally increase TMs
export async function advanceCycle(uid: string, tmIncreases?: {
  bench?: number;
  squat?: number;
  deadlift?: number;
}): Promise<void> {
  const profile = await loadProfileRemote(uid);
  if (!profile) throw new Error("Profile not found");
  
  const nextCycle = (normalizeCycle(profile.currentCycle) ?? 1) + 1;
  const nextLiftWeeks: LiftWeekMap = { ...(profile.liftWeeks ?? {}) };
  const nextLiftCycles: LiftCycleMap = { ...(profile.liftCycles ?? {}) };
  LIFT_KEYS.forEach((lift) => {
    nextLiftWeeks[lift] = 1;
    nextLiftCycles[lift] = nextCycle;
  });
  const updatedProfile: Profile = {
    ...profile,
    liftWeeks: nextLiftWeeks,
    liftCycles: nextLiftCycles,
    currentWeek: 1,
    currentCycle: nextCycle,
  };
  
  if (tmIncreases) {
    const nextTm: NonNullable<Profile["tm"]> = { ...(profile.tm ?? {}) };
    (["bench", "squat", "deadlift"] as const).forEach((lift) => {
      const current = profile.tm?.[lift];
      const increment = tmIncreases[lift];
      if (typeof current === "number" && Number.isFinite(current) && typeof increment === "number") {
        nextTm[lift] = current + increment;
      }
    });
    updatedProfile.tm = nextTm;
  }
  
  await saveProfile(updatedProfile, { skipLocal: true, requireRemote: true });
}

export const normalizePasscodeDigits = (code: string): string =>
  code.replace(/\D+/g, "").slice(0, 4);

const sanitizeAthleteName = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

export const buildAthleteEmail = (firstName: string, lastName: string): string => {
  const canonical = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, "");
  return `${canonical}@pl.strength`;
};

const passcodeToPassword = (code: string) => `${code}pl!`;

export class AthleteAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "AthleteAuthError";
  }
}

export type AthleteSignInOptions = {
  firstName: string;
  lastName: string;
  passcodeDigits: string;
  team?: Team | "";
};

export type AthleteSignInResult = {
  profile: Profile;
  createdAccount: boolean;
  credential: UserCredential | null;
};

export async function signInOrCreateAthleteAccount(
  options: AthleteSignInOptions
): Promise<AthleteSignInResult> {
  const auth = fb.auth;
  if (!auth) {
    throw new AthleteAuthError("auth/unavailable", "Firebase auth is unavailable.");
  }

  const first = options.firstName.trim();
  const last = options.lastName.trim();
  const code = options.passcodeDigits.trim();

  const email = buildAthleteEmail(first, last);
  const password = passcodeToPassword(code);

  let credential: UserCredential | null = null;
  let createdAccount = false;

  try {
    credential = await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const error = err as AuthError;
    // Try to create account for any auth failure - if email exists, we'll get a specific error
    const canCreate =
      error.code === "auth/user-not-found" ||
      error.code === "auth/invalid-credential" ||
      error.code === "auth/wrong-password";

    if (canCreate) {
      try {
        credential = await createUserWithEmailAndPassword(auth, email, password);
        createdAccount = true;
      } catch (createErr: any) {
        const createError = createErr as AuthError;
        // If email already exists, the original password was wrong
        if (createError.code === "auth/email-already-in-use") {
          throw new AthleteAuthError("auth/wrong-password", "Incorrect passcode.");
        }
        throw createError;
      }
    } else {
      throw error;
    }
  }

  const uid = credential?.user?.uid ?? auth.currentUser?.uid;
  if (!uid) {
    throw new AthleteAuthError("auth/internal-error", "We could not sign you in.");
  }

  let existingProfile: Profile | null = null;
  try {
    existingProfile = await loadProfileRemote(uid);
  } catch (err) {
    console.warn("Failed to load existing profile before athlete save", err);
  }

  // Skip passcode uniqueness check - athletes are unique by name/email
  // Passcode can be reused as long as the first+last name combination is unique

  const resolvedTeam = options.team ? normalizeTeam(options.team) : normalizeTeam(existingProfile?.team);
  const teamAnchor = normalizeTeam(existingProfile?.teamAnchor ?? existingProfile?.team) ?? resolvedTeam;
  const existingTeamData = normalizeTeamTrainingMap(existingProfile?.teamData);
  const activeState = resolvedTeam ? existingTeamData[resolvedTeam] : undefined;
  const tm = activeState?.tm ?? existingProfile?.tm ?? {};
  const oneRm = activeState?.oneRm ?? existingProfile?.oneRm ?? {};
  const liftWeeks = activeState?.liftWeeks ?? existingProfile?.liftWeeks;
  const liftCycles = activeState?.liftCycles ?? existingProfile?.liftCycles;
  const currentWeek = activeState?.currentWeek ?? existingProfile?.currentWeek ?? 1;
  const currentCycle = activeState?.currentCycle ?? existingProfile?.currentCycle ?? 1;
  const nextTeamData = mergeActiveTeamData(
    {
      tm,
      oneRm,
      liftWeeks,
      liftCycles,
      currentWeek,
      currentCycle,
      teamData: existingTeamData,
    },
    resolvedTeam
  );
  const teamScopes = mergeTeamScopes(
    sanitizeTeamScopeArray(existingProfile?.teamScopes),
    Object.keys(existingTeamData)
      .map((entry) => normalizeTeam(entry))
      .filter((entry): entry is Team => Boolean(entry)),
    teamAnchor,
    resolvedTeam
  );
  const profile: Profile = {
    uid,
    firstName: first,
    lastName: last,
    unit: existingProfile?.unit ?? "lb",
    team: teamAnchor ?? resolvedTeam,
    teamAnchor: teamAnchor ?? resolvedTeam,
    teamScopes,
    teamData: nextTeamData,
    liftWeeks,
    liftCycles,
    tm,
    oneRm,
    accessCode: code,
    equipment: normalizeEquipment(existingProfile?.equipment),
    currentWeek,
    currentCycle,
  };

  await saveProfile(profile, { requireRemote: true });

  return {
    profile,
    createdAccount,
    credential,
  };
}

export type CreateAthleteAccountOptions = {
  firstName: string;
  lastName: string;
  passcodeDigits: string;
  team: Team | "";
};

export type CreateAthleteAccountResult = {
  profile: Profile;
  createdAccount: boolean;
};

export async function createAthleteAccount(
  options: CreateAthleteAccountOptions
): Promise<CreateAthleteAccountResult> {
  const secondaryAuth = getSecondaryAuth();
  if (!secondaryAuth) {
    throw new AthleteAuthError("auth/unavailable", "Firebase auth is unavailable.");
  }

  const first = sanitizeAthleteName(options.firstName);
  const last = sanitizeAthleteName(options.lastName);
  const code = normalizePasscodeDigits(options.passcodeDigits);

  if (!first || !last) {
    throw new AthleteAuthError("auth/invalid-name", "Enter first and last name.");
  }
  if (code.length !== 4) {
    throw new AthleteAuthError("auth/invalid-passcode", "Passcode must be 4 digits.");
  }
  if (!options.team) {
    throw new AthleteAuthError("auth/invalid-team", "Select a team before saving.");
  }

  const email = buildAthleteEmail(first, last);
  const password = passcodeToPassword(code);
  let credential: UserCredential | null = null;
  let createdAccount = false;

  try {
    credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    createdAccount = true;
  } catch (err: any) {
    const error = err as AuthError;
    if (error.code === "auth/email-already-in-use") {
      try {
        credential = await signInWithEmailAndPassword(secondaryAuth, email, password);
      } catch (signInErr: any) {
        const signInError = signInErr as AuthError;
        if (signInError.code === "auth/wrong-password") {
          throw new AthleteAuthError("auth/wrong-password", "Incorrect passcode.");
        }
        throw signInError;
      }
    } else {
      throw error;
    }
  }

  const uid = credential?.user?.uid ?? secondaryAuth.currentUser?.uid;
  if (!uid) {
    throw new AthleteAuthError("auth/internal-error", "We could not create the athlete account.");
  }

  let existingProfile: Profile | null = null;
  try {
    existingProfile = await loadProfileRemote(uid);
  } catch (err) {
    console.warn("Failed to load existing profile before athlete save", err);
  }

  const cleanupCreatedAccount = async () => {
    if (!createdAccount || !credential?.user) return;
    try {
      await credential.user.delete();
    } catch (deleteErr) {
      console.warn("Failed to clean up created athlete account", deleteErr);
    }
  };

  const codeStatus = await ensureAthleteCode(
    uid,
    code,
    existingProfile?.accessCode ?? null
  );

  if (codeStatus === "taken") {
    await cleanupCreatedAccount();
    throw new AthleteAuthError(
      "athlete-code/taken",
      "That code is already being used by another athlete."
    );
  }

  if (codeStatus === "unavailable") {
    await cleanupCreatedAccount();
    throw new AthleteAuthError(
      "athlete-code/unavailable",
      "We could not verify that code. Try again shortly."
    );
  }

  const resolvedTeam = options.team ? normalizeTeam(options.team) : normalizeTeam(existingProfile?.team);
  const teamAnchor = normalizeTeam(existingProfile?.teamAnchor ?? existingProfile?.team) ?? resolvedTeam;
  const existingTeamData = normalizeTeamTrainingMap(existingProfile?.teamData);
  const activeState = resolvedTeam ? existingTeamData[resolvedTeam] : undefined;
  const tm = activeState?.tm ?? existingProfile?.tm ?? {};
  const oneRm = activeState?.oneRm ?? existingProfile?.oneRm ?? {};
  const liftWeeks = activeState?.liftWeeks ?? existingProfile?.liftWeeks;
  const liftCycles = activeState?.liftCycles ?? existingProfile?.liftCycles;
  const currentWeek = activeState?.currentWeek ?? existingProfile?.currentWeek ?? 1;
  const currentCycle = activeState?.currentCycle ?? existingProfile?.currentCycle ?? 1;
  const nextTeamData = mergeActiveTeamData(
    {
      tm,
      oneRm,
      liftWeeks,
      liftCycles,
      currentWeek,
      currentCycle,
      teamData: existingTeamData,
    },
    resolvedTeam
  );
  const teamScopes = mergeTeamScopes(
    sanitizeTeamScopeArray(existingProfile?.teamScopes),
    Object.keys(existingTeamData)
      .map((entry) => normalizeTeam(entry))
      .filter((entry): entry is Team => Boolean(entry)),
    teamAnchor,
    resolvedTeam
  );
  const profile: Profile = {
    uid,
    firstName: first,
    lastName: last,
    unit: existingProfile?.unit ?? "lb",
    team: teamAnchor ?? resolvedTeam,
    teamAnchor: teamAnchor ?? resolvedTeam,
    teamScopes,
    teamData: nextTeamData,
    liftWeeks,
    liftCycles,
    tm,
    oneRm,
    accessCode: code,
    equipment: normalizeEquipment(existingProfile?.equipment),
    currentWeek,
    currentCycle,
  };

  try {
    await saveProfile(profile, { skipLocal: true, requireRemote: true });
  } catch (err) {
    await cleanupCreatedAccount();
    throw err;
  }

  try {
    await secondaryAuth.signOut();
  } catch (err) {
    console.warn("Failed to sign out secondary auth", err);
  }

  return {
    profile,
    createdAccount,
  };
}

// listRoster via collectionGroup("profile")
export type RosterEntry = {
  uid: string;
  firstName?: string;
  lastName?: string;
  unit?: Unit;
  createdAt?: number;
  updatedAt?: number;
  updatedBy?: string | null;
  team?: Team;
  teamScopes?: Team[];
  teamAnchor?: Team;
  accessCode?: string | null;
  roles?: string[];
};

export async function listRoster(): Promise<RosterEntry[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return [];
  try {
    await ensureAnon();
  } catch (err) {
    console.warn("ensureAnon failed before listRoster", err);
  }
  
  
  const cg = collectionGroup(database, "profile");
  const snap = await getDocs(cg);

  const rows = await Promise.all(
    snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      const parts = docSnap.ref.path.split("/");
      const uid = parts[1] || data.uid;
      let roles: string[] = [];
      try {
        const roleSnap = await getDoc(roleRef(database, uid));
        roles = roleSnap.exists() ? normalizeRoles(roleSnap.data()) : [];
      } catch (err) {
        console.warn(`Failed to load roles for ${uid}`, err);
      }

      const team = normalizeTeam(data.team);
      const teamAnchor = normalizeTeam(data.teamAnchor ?? data.team);
      const teamData = normalizeTeamTrainingMap(data.teamData);
      const teamScopes = mergeTeamScopes(
        sanitizeTeamScopeArray(data.teamScopes),
        teamAnchor,
        team,
        Object.keys(teamData)
          .map((entry) => normalizeTeam(entry))
          .filter((entry): entry is Team => Boolean(entry))
      );
      return {
        uid,
        firstName: data.firstName,
        lastName: data.lastName,
        unit: data.unit as Unit,
        createdAt: toMillis(data.createdAt) || undefined,
        updatedAt: toMillis(data.updatedAt) || undefined,
        updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
        team: teamAnchor ?? team,
        teamAnchor: teamAnchor ?? team,
        teamScopes,
        accessCode: data.accessCode ?? null,
        roles,
      };
    })
  );

  return rows;
}

export async function backfillCreatedAtDates(): Promise<{ updated: number; skipped: number; errors: number }> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) throw new Error("Database unavailable");

  const secondaryAuth = getSecondaryAuth();

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const profilesSnapshot = await getDocs(collectionGroup(database, "profile"));

    for (const profileDoc of profilesSnapshot.docs) {
      const profile = profileDoc.data();
      const athleteId = profileDoc.ref.parent.parent?.id;

      if (!athleteId) {
        console.warn(`Skipping profile without athlete ID: ${profileDoc.id}`);
        skipped++;
        continue;
      }

      try {
        let createdAtDate: number | null = null;

        // 1. Try to get the account creation date from Firebase Auth
        if (secondaryAuth && profile.firstName && profile.lastName && profile.accessCode) {
          try {
            const email = buildAthleteEmail(profile.firstName, profile.lastName);
            const password = passcodeToPassword(profile.accessCode);
            const credential = await signInWithEmailAndPassword(secondaryAuth, email, password);
            const authCreationTime = credential.user.metadata.creationTime;
            if (authCreationTime) {
              createdAtDate = new Date(authCreationTime).getTime();
            }
          } catch (authErr) {
            console.warn(`Could not sign in as ${athleteId} to read auth creation time:`, authErr);
          }
        }

        // 2. Fall back to the athlete's first session date
        if (!createdAtDate) {
          const sessionsQuery = query(
            collectionGroup(database, "session"),
            where("athleteId", "==", athleteId),
            orderBy("createdAt", "asc"),
            limit(1)
          );

          const sessionsSnapshot = await getDocs(sessionsQuery);

          if (!sessionsSnapshot.empty) {
            const firstSession = sessionsSnapshot.docs[0].data();
            createdAtDate = toMillis(firstSession.createdAt);
          }
        }

        // 3. Last resort: fall back to today's date
        if (!createdAtDate) {
          createdAtDate = Date.now();
        }

        // Update the profile with the determined createdAt date
        await updateDoc(profileDoc.ref, { createdAt: createdAtDate });
        updated++;
        console.log(`Updated ${athleteId} with createdAt: ${new Date(createdAtDate).toLocaleDateString()}`);
      } catch (err) {
        console.error(`Failed to update ${athleteId}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error("Backfill failed:", err);
    throw err;
  }

  return { updated, skipped, errors };
}

// ---- Attendance sheets ----

export type AttendanceLevel = Team;

export type AttendanceAthlete = {
  id: string;
  uid?: string;
  firstName: string;
  lastName: string;
  level: AttendanceLevel;
  number?: string;
  grade?: string;
  height?: string;
  weight?: string;
  position?: string;
  letter?: string;
};

export type AttendanceSession = {
  key: string;
  label: string;
};

export type AttendanceSessionsByDate = Record<string, AttendanceSession[]>;
export type AttendanceSessionLocksByDate = Record<string, Record<string, boolean>>;
export type AttendanceSessionSelectionsByAthleteDate = Record<
  string,
  Record<string, string>
>;

export const ATTENDANCE_DEFAULT_SESSION_LABELS = [
  "After School",
  "Evening",
  "Summer",
] as const;

export const buildDefaultAttendanceSessions = (): AttendanceSession[] =>
  ATTENDANCE_DEFAULT_SESSION_LABELS.map((label, index) => ({
    key: attendanceSessionKeyForIndex(index),
    label,
  }));

export type AttendanceSheet = {
  team: Team;
  dates: string[];
  athletes: AttendanceAthlete[];
  records: Record<string, Record<string, boolean>>;
  sessionSelections: AttendanceSessionSelectionsByAthleteDate;
  sessionsByDate: AttendanceSessionsByDate;
  sessionLocks: AttendanceSessionLocksByDate;
  lockedDates: Record<string, boolean>;
  updatedAt?: number;
};

export type AttendanceTeamStatus = {
  team: Team;
  dates: string[];
  sessionsByDate: AttendanceSessionsByDate;
  sessionLocks: AttendanceSessionLocksByDate;
  lockedDates: Record<string, boolean>;
  updatedAt?: number;
};

export type AttendanceCheckinStatus = "pending" | "approved" | "rejected";

export type AttendanceCheckin = {
  id: string;
  team: Team;
  date: string;
  dayKey: string;
  sessionKey?: string;
  sessionLabel?: string;
  uid: string;
  athleteId?: string;
  firstName?: string;
  lastName?: string;
  status: AttendanceCheckinStatus;
  submittedAt?: number;
  reviewedAt?: number;
  reviewedBy?: string;
  reviewedByName?: string;
};

const ATTENDANCE_STORAGE_PREFIX = "pl.attendance.";
const ATTENDANCE_STATUS_COLLECTION = "attendanceStatus";
const ATTENDANCE_CHECKINS_COLLECTION = "attendanceCheckins";

const attendanceStorageKey = (team: Team): string =>
  `${ATTENDANCE_STORAGE_PREFIX}${team}`;

const defaultAttendanceSheet = (team: Team): AttendanceSheet => ({
  team,
  dates: [],
  athletes: [],
  records: {},
  sessionSelections: {},
  sessionsByDate: {},
  sessionLocks: {},
  lockedDates: {},
  updatedAt: undefined,
});

const formatLocalDateInput = (value: Date): string => {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  const year = local.getFullYear();
  const month = `${local.getMonth() + 1}`.padStart(2, "0");
  const day = `${local.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const attendanceStatusDocRef = (database: Firestore, team: Team) =>
  doc(database, ATTENDANCE_STATUS_COLLECTION, team);

const buildAttendanceDayKey = (team: Team, date: string): string => `${team}__${date}`;

const encodeAttendanceDocIdPart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, "_");

const attendanceCheckinDocId = (team: Team, date: string, uid: string): string =>
  `${encodeAttendanceDocIdPart(team)}__${encodeAttendanceDocIdPart(
    date
  )}__${encodeAttendanceDocIdPart(uid)}`;

const attendanceCheckinDocRef = (
  database: Firestore,
  team: Team,
  date: string,
  uid: string
) => doc(database, ATTENDANCE_CHECKINS_COLLECTION, attendanceCheckinDocId(team, date, uid));

const attendanceSessionKeyForIndex = (index: number): string => `session-${index + 1}`;

const sanitizeAttendanceSessionKey = (value: unknown): string | undefined => {
  const raw = sanitizeAttendanceDetail(value, 60);
  if (!raw) return undefined;
  const normalized = raw.replace(/[^a-zA-Z0-9_-]/g, "-");
  return normalized || undefined;
};

const normalizeAttendanceSessionsByDate = (
  dates: string[],
  rawSessionsByDate: unknown
): AttendanceSessionsByDate => {
  const source =
    rawSessionsByDate &&
    typeof rawSessionsByDate === "object" &&
    !Array.isArray(rawSessionsByDate)
      ? (rawSessionsByDate as Record<string, unknown>)
      : {};
  const sessionsByDate: AttendanceSessionsByDate = {};
  dates.forEach((date) => {
    const rawSessions = source[date];
    const normalizedSessions: AttendanceSession[] = [];
    const seenKeys = new Set<string>();

    if (Array.isArray(rawSessions)) {
      rawSessions.forEach((entry, index) => {
        let keyCandidate: string | undefined;
        let labelCandidate: string | undefined;
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          keyCandidate = sanitizeAttendanceSessionKey((entry as Record<string, unknown>).key);
          labelCandidate = sanitizeAttendanceDetail(
            (entry as Record<string, unknown>).label,
            60
          );
        } else if (typeof entry === "string" || typeof entry === "number") {
          labelCandidate = sanitizeAttendanceDetail(entry, 60);
        }
        const fallbackLabel =
          ATTENDANCE_DEFAULT_SESSION_LABELS[index] ?? `Session ${index + 1}`;
        const label = labelCandidate ?? fallbackLabel;
        let key = keyCandidate ?? attendanceSessionKeyForIndex(index);
        while (seenKeys.has(key)) {
          key = `${key}-${seenKeys.size + 1}`;
        }
        seenKeys.add(key);
        normalizedSessions.push({ key, label });
      });
    }

    sessionsByDate[date] =
      normalizedSessions.length > 0
        ? normalizedSessions
        : [{ key: attendanceSessionKeyForIndex(0), label: "After School" }];
  });
  return sessionsByDate;
};

const normalizeAttendanceSessionLocksByDate = (
  dates: string[],
  sessionsByDate: AttendanceSessionsByDate,
  rawSessionLocks: unknown,
  rawLockedDates: unknown
): AttendanceSessionLocksByDate => {
  const locksSource =
    rawSessionLocks &&
    typeof rawSessionLocks === "object" &&
    !Array.isArray(rawSessionLocks)
      ? (rawSessionLocks as Record<string, unknown>)
      : {};
  const lockedSource =
    rawLockedDates &&
    typeof rawLockedDates === "object" &&
    !Array.isArray(rawLockedDates)
      ? (rawLockedDates as Record<string, unknown>)
      : {};
  const sessionLocks: AttendanceSessionLocksByDate = {};
  dates.forEach((date) => {
    const lockAllForDate = lockedSource[date] === true;
    const rowSource =
      locksSource[date] &&
      typeof locksSource[date] === "object" &&
      !Array.isArray(locksSource[date])
        ? (locksSource[date] as Record<string, unknown>)
        : {};
    const row: Record<string, boolean> = {};
    (sessionsByDate[date] ?? []).forEach((session) => {
      row[session.key] = lockAllForDate || rowSource[session.key] === true;
    });
    sessionLocks[date] = row;
  });
  return sessionLocks;
};

const deriveAttendanceLockedDatesFromSessionLocks = (
  dates: string[],
  sessionsByDate: AttendanceSessionsByDate,
  sessionLocks: AttendanceSessionLocksByDate,
  rawLockedDates: unknown
): Record<string, boolean> => {
  const explicitLockedDates = normalizeAttendanceLockedDates(dates, rawLockedDates);
  const lockedDates: Record<string, boolean> = {};
  dates.forEach((date) => {
    const sessions = sessionsByDate[date] ?? [];
    const rowLocks = sessionLocks[date] ?? {};
    const allLocked =
      sessions.length > 0 && sessions.every((session) => rowLocks[session.key] === true);
    lockedDates[date] = explicitLockedDates[date] === true || allLocked;
  });
  return lockedDates;
};

const normalizeAttendanceSessionState = (
  dates: string[],
  rawSessionsByDate: unknown,
  rawSessionLocks: unknown,
  rawLockedDates: unknown
): {
  sessionsByDate: AttendanceSessionsByDate;
  sessionLocks: AttendanceSessionLocksByDate;
  lockedDates: Record<string, boolean>;
} => {
  const sessionsByDate = normalizeAttendanceSessionsByDate(dates, rawSessionsByDate);
  const sessionLocks = normalizeAttendanceSessionLocksByDate(
    dates,
    sessionsByDate,
    rawSessionLocks,
    rawLockedDates
  );
  const lockedDates = deriveAttendanceLockedDatesFromSessionLocks(
    dates,
    sessionsByDate,
    sessionLocks,
    rawLockedDates
  );
  return { sessionsByDate, sessionLocks, lockedDates };
};

const resolveFirstUnlockedAttendanceSession = (
  sessions: AttendanceSession[],
  sessionLocks: Record<string, boolean>
): AttendanceSession | null =>
  sessions.find((session) => sessionLocks[session.key] !== true) ?? null;

const normalizeAttendanceLockedDates = (
  dates: string[],
  raw: unknown
): Record<string, boolean> => {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const allowed = new Set(dates);
  const lockedDates: Record<string, boolean> = {};
  dates.forEach((date) => {
    lockedDates[date] = source[date] === true;
  });
  Object.entries(source).forEach(([date, value]) => {
    if (!allowed.has(date) || value !== true) return;
    lockedDates[date] = true;
  });
  return lockedDates;
};

const normalizeAttendanceTeamStatus = (
  input: any,
  team: Team
): AttendanceTeamStatus => {
  const rawDates = Array.isArray(input?.dates) ? input.dates : [];
  const dates: string[] = Array.from(
    new Set(
      rawDates
        .map((value: unknown) =>
          typeof value === "string" ? value.trim().slice(0, 40) : ""
        )
        .filter((value: string) => value.length > 0)
    )
  );
  const sessionState = normalizeAttendanceSessionState(
    dates,
    input?.sessionsByDate,
    input?.sessionLocks,
    input?.lockedDates
  );
  const updatedAt = toMillis(input?.updatedAt) || undefined;
  return {
    team,
    dates,
    sessionsByDate: sessionState.sessionsByDate,
    sessionLocks: sessionState.sessionLocks,
    lockedDates: sessionState.lockedDates,
    updatedAt,
  };
};

const normalizeAttendanceCheckin = (
  input: any,
  id: string
): AttendanceCheckin | null => {
  if (!input || typeof input !== "object") return null;
  const team = normalizeTeam(input.team);
  const date = typeof input.date === "string" ? input.date.trim().slice(0, 40) : "";
  const uid = typeof input.uid === "string" ? input.uid.trim() : "";
  const dayKey =
    typeof input.dayKey === "string" && input.dayKey.trim()
      ? input.dayKey.trim().slice(0, 120)
      : team && date
      ? buildAttendanceDayKey(team, date)
      : "";
  const status: AttendanceCheckinStatus =
    input.status === "approved" || input.status === "rejected" ? input.status : "pending";
  if (!team || !date || !uid || !dayKey) return null;
  return {
    id,
    team,
    date,
    dayKey,
    sessionKey: sanitizeAttendanceSessionKey(input.sessionKey),
    sessionLabel: sanitizeAttendanceDetail(input.sessionLabel, 60),
    uid,
    athleteId:
      typeof input.athleteId === "string" && input.athleteId.trim()
        ? input.athleteId.trim()
        : undefined,
    firstName:
      typeof input.firstName === "string" && input.firstName.trim()
        ? sanitizeName(input.firstName)
        : undefined,
    lastName:
      typeof input.lastName === "string" && input.lastName.trim()
        ? sanitizeName(input.lastName)
        : undefined,
    status,
    submittedAt: toMillis(input.submittedAt) || undefined,
    reviewedAt: toMillis(input.reviewedAt) || undefined,
    reviewedBy:
      typeof input.reviewedBy === "string" && input.reviewedBy.trim()
        ? input.reviewedBy.trim()
        : undefined,
    reviewedByName:
      typeof input.reviewedByName === "string" && input.reviewedByName.trim()
        ? sanitizeName(input.reviewedByName)
        : undefined,
  };
};

const readAttendanceLocal = (team: Team): AttendanceSheet | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(attendanceStorageKey(team));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return normalizeAttendanceSheet(parsed, team);
  } catch (_) {
    return null;
  }
};

const writeAttendanceLocal = (sheet: AttendanceSheet) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      attendanceStorageKey(sheet.team),
      JSON.stringify(sheet)
    );
  } catch (_) {
    // ignore storage issues
  }
};

const sanitizeName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 60);
  return trimmed;
};

const sanitizeAttendanceDetail = (
  value: unknown,
  maxLength = 40
): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const normalized = String(value).trim().slice(0, maxLength);
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : undefined;
};

const ATTENDANCE_FIRST_NAME_ALIAS_GROUPS = [
  ["matthew", "matt", "mat"],
  ["michael", "mike", "mikey"],
  ["christopher", "chris"],
  ["nicholas", "nick"],
  ["jonathan", "jon", "johnny"],
  ["anthony", "tony"],
  ["benjamin", "ben"],
  ["andrew", "andy", "drew"],
  ["daniel", "dan", "danny"],
  ["joseph", "joe", "joey"],
] as const;

const ATTENDANCE_FIRST_NAME_ALIAS_LOOKUP: Record<string, string> =
  ATTENDANCE_FIRST_NAME_ALIAS_GROUPS.reduce<Record<string, string>>((acc, group) => {
    const canonical = group[0];
    group.forEach((value) => {
      acc[value] = canonical;
    });
    return acc;
  }, {});

const normalizeAttendanceNameToken = (value: unknown): string => {
  const normalized = sanitizeName(value).toLowerCase().replace(/[^a-z]/g, "");
  return normalized;
};

const normalizeAttendanceFirstNameAliasKey = (value: unknown): string => {
  const token = normalizeAttendanceNameToken(value);
  if (!token) return "";
  return ATTENDANCE_FIRST_NAME_ALIAS_LOOKUP[token] ?? token;
};

const areAttendanceNamesEquivalent = (
  firstA: unknown,
  lastA: unknown,
  firstB: unknown,
  lastB: unknown
): boolean => {
  const normalizedLastA = normalizeAttendanceNameToken(lastA);
  const normalizedLastB = normalizeAttendanceNameToken(lastB);
  if (!normalizedLastA || !normalizedLastB || normalizedLastA !== normalizedLastB) {
    return false;
  }
  const normalizedFirstA = normalizeAttendanceFirstNameAliasKey(firstA);
  const normalizedFirstB = normalizeAttendanceFirstNameAliasKey(firstB);
  return Boolean(normalizedFirstA && normalizedFirstA === normalizedFirstB);
};

const isGeneratedAttendanceAthleteId = (id: string): boolean => id.startsWith("uid-");

const attendanceAthleteMergeScore = (athlete: AttendanceAthlete): number => {
  let score = 0;
  if (!isGeneratedAttendanceAthleteId(athlete.id)) score += 25;
  if (athlete.uid) score += 10;
  if (athlete.number) score += 2;
  if (athlete.grade) score += 2;
  if (athlete.height) score += 1;
  if (athlete.weight) score += 1;
  if (athlete.position) score += 1;
  if (athlete.letter) score += 1;
  if (athlete.firstName) score += 1;
  if (athlete.lastName) score += 1;
  return score;
};

const shouldMergeAttendanceAthletes = (
  primary: AttendanceAthlete,
  candidate: AttendanceAthlete
): boolean => {
  if (primary.id === candidate.id) return true;
  if (primary.level !== candidate.level) return false;
  if (primary.uid && candidate.uid) {
    return primary.uid === candidate.uid;
  }
  if (!primary.uid && !candidate.uid) return false;
  if (
    primary.number &&
    candidate.number &&
    primary.number.trim() &&
    candidate.number.trim() &&
    primary.number.trim() !== candidate.number.trim()
  ) {
    return false;
  }
  if (
    primary.grade &&
    candidate.grade &&
    primary.grade.trim() &&
    candidate.grade.trim() &&
    primary.grade.trim() !== candidate.grade.trim()
  ) {
    return false;
  }
  return areAttendanceNamesEquivalent(
    primary.firstName,
    primary.lastName,
    candidate.firstName,
    candidate.lastName
  );
};

const choosePreferredName = (primary: string, candidate: string): string => {
  const a = sanitizeName(primary);
  const b = sanitizeName(candidate);
  if (!a) return b;
  if (!b) return a;
  if (normalizeAttendanceFirstNameAliasKey(a) === normalizeAttendanceFirstNameAliasKey(b)) {
    return b.length > a.length ? b : a;
  }
  return a;
};

const mergeAttendanceAthleteProfile = (
  primary: AttendanceAthlete,
  candidate: AttendanceAthlete
): AttendanceAthlete => ({
  ...primary,
  uid: primary.uid ?? candidate.uid,
  firstName: choosePreferredName(primary.firstName, candidate.firstName),
  lastName: sanitizeName(primary.lastName || candidate.lastName),
  number: primary.number ?? candidate.number,
  grade: primary.grade ?? candidate.grade,
  height: primary.height ?? candidate.height,
  weight: primary.weight ?? candidate.weight,
  position: primary.position ?? candidate.position,
  letter: primary.letter ?? candidate.letter,
});

const normalizeAttendanceRecords = (
  athletes: AttendanceAthlete[],
  dates: string[],
  raw: unknown
): Record<string, Record<string, boolean>> => {
  const records: Record<string, Record<string, boolean>> = {};
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dateSet = new Set(dates);
  athletes.forEach((athlete) => {
    const athleteSource = source[athlete.id];
    const row: Record<string, boolean> = {};
    if (
      athleteSource &&
      typeof athleteSource === "object" &&
      !Array.isArray(athleteSource)
    ) {
      Object.entries(athleteSource as Record<string, unknown>).forEach(
        ([date, value]) => {
          if (dateSet.has(date)) {
            row[date] = value === true;
          }
        }
      );
    }
    dates.forEach((date) => {
      if (!(date in row)) {
        row[date] = false;
      }
    });
    records[athlete.id] = row;
  });
  return records;
};

const normalizeAttendanceSessionSelections = (
  athletes: AttendanceAthlete[],
  dates: string[],
  sessionsByDate: AttendanceSessionsByDate,
  records: Record<string, Record<string, boolean>>,
  raw: unknown
): AttendanceSessionSelectionsByAthleteDate => {
  const source =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const selections: AttendanceSessionSelectionsByAthleteDate = {};

  athletes.forEach((athlete) => {
    const athleteSource = source[athlete.id];
    const sourceRow =
      athleteSource &&
      typeof athleteSource === "object" &&
      !Array.isArray(athleteSource)
        ? (athleteSource as Record<string, unknown>)
        : {};
    const row: Record<string, string> = {};

    dates.forEach((date) => {
      if (records[athlete.id]?.[date] !== true) return;
      const sessionsForDate = sessionsByDate[date] ?? [];
      if (sessionsForDate.length === 0) return;

      const explicitSessionKey = sanitizeAttendanceSessionKey(sourceRow[date]);
      if (
        explicitSessionKey &&
        sessionsForDate.some((session) => session.key === explicitSessionKey)
      ) {
        row[date] = explicitSessionKey;
        return;
      }

      row[date] = sessionsForDate[0].key;
    });

    selections[athlete.id] = row;
  });

  return selections;
};

const dedupeAttendanceAthletesAndRecords = (
  athletes: AttendanceAthlete[],
  dates: string[],
  records: Record<string, Record<string, boolean>>,
  rawSessionSelections: AttendanceSessionSelectionsByAthleteDate,
  sessionsByDate: AttendanceSessionsByDate
): {
  athletes: AttendanceAthlete[];
  records: Record<string, Record<string, boolean>>;
  sessionSelections: AttendanceSessionSelectionsByAthleteDate;
} => {
  if (athletes.length <= 1) {
    const normalizedRecords = normalizeAttendanceRecords(athletes, dates, records);
    const normalizedSelections = normalizeAttendanceSessionSelections(
      athletes,
      dates,
      sessionsByDate,
      normalizedRecords,
      rawSessionSelections
    );
    return {
      athletes,
      records: normalizedRecords,
      sessionSelections: normalizedSelections,
    };
  }

  const sorted = [...athletes].sort(
    (a, b) => attendanceAthleteMergeScore(b) - attendanceAthleteMergeScore(a)
  );
  const nextAthletes: AttendanceAthlete[] = [];
  const nextRecords: Record<string, Record<string, boolean>> = {};
  const nextRawSelections: AttendanceSessionSelectionsByAthleteDate = {};

  sorted.forEach((athlete) => {
    const existingIndex = nextAthletes.findIndex((row) =>
      shouldMergeAttendanceAthletes(row, athlete)
    );
    const athleteRecord = records[athlete.id] ?? {};
    const athleteSelections = rawSessionSelections[athlete.id] ?? {};

    if (existingIndex < 0) {
      nextAthletes.push(athlete);
      nextRecords[athlete.id] = { ...athleteRecord };
      nextRawSelections[athlete.id] = { ...athleteSelections };
      return;
    }

    const primary = nextAthletes[existingIndex];
    const merged = mergeAttendanceAthleteProfile(primary, athlete);
    nextAthletes[existingIndex] = merged;
    const primaryId = primary.id;
    const mergedRecord = { ...(nextRecords[primaryId] ?? {}) };
    dates.forEach((date) => {
      mergedRecord[date] = Boolean(mergedRecord[date] || athleteRecord[date]);
    });
    nextRecords[primaryId] = mergedRecord;
    const mergedSelections = { ...(nextRawSelections[primaryId] ?? {}) };
    Object.entries(athleteSelections).forEach(([date, sessionKey]) => {
      if (!mergedSelections[date] && sessionKey) {
        mergedSelections[date] = sessionKey;
      }
    });
    nextRawSelections[primaryId] = mergedSelections;
  });

  const normalizedRecords = normalizeAttendanceRecords(nextAthletes, dates, nextRecords);
  const normalizedSelections = normalizeAttendanceSessionSelections(
    nextAthletes,
    dates,
    sessionsByDate,
    normalizedRecords,
    nextRawSelections
  );

  return {
    athletes: nextAthletes,
    records: normalizedRecords,
    sessionSelections: normalizedSelections,
  };
};

const normalizeAttendanceSheet = (
  input: any,
  team: Team
): AttendanceSheet => {
  const rawDates = Array.isArray(input?.dates) ? input.dates : [];
  const dates: string[] = Array.from(
    new Set(
      rawDates
        .map((value: unknown) =>
          typeof value === "string" ? value.trim().slice(0, 40) : ""
        )
        .filter((value: string) => value.length > 0)
    )
  );

  const rawAthletes = Array.isArray(input?.athletes) ? input.athletes : [];
  const athletes: AttendanceAthlete[] = rawAthletes
    .map((item: any) => {
      if (!item || typeof item !== "object") return null;
      const id =
        typeof item.id === "string" && item.id.trim()
          ? item.id.trim()
          : null;
      const uid =
        typeof item.uid === "string" && item.uid.trim() ? item.uid.trim() : undefined;
      const firstName = sanitizeName((item as any).firstName);
      const lastName = sanitizeName((item as any).lastName);
      const level = normalizeTeam((item as any).level) ?? team;
      if (!id || (!firstName && !lastName)) return null;
      const number = sanitizeAttendanceDetail((item as any).number, 20);
      const grade = sanitizeAttendanceDetail((item as any).grade, 20);
      const height = sanitizeAttendanceDetail((item as any).height, 20);
      const weight = sanitizeAttendanceDetail((item as any).weight, 20);
      const position = sanitizeAttendanceDetail((item as any).position, 30);
      const letter = sanitizeAttendanceDetail((item as any).letter, 10);
      return {
        id,
        ...(uid ? { uid } : {}),
        firstName,
        lastName,
        level,
        ...(number ? { number } : {}),
        ...(grade ? { grade } : {}),
        ...(height ? { height } : {}),
        ...(weight ? { weight } : {}),
        ...(position ? { position } : {}),
        ...(letter ? { letter } : {}),
      };
    })
    .filter((item: any): item is AttendanceAthlete => item !== null);

  const updatedAtRaw = input?.updatedAt;
  let updatedAt: number | undefined;
  if (typeof updatedAtRaw === "number" && Number.isFinite(updatedAtRaw)) {
    updatedAt = updatedAtRaw;
  } else if (
    updatedAtRaw &&
    typeof (updatedAtRaw as any).toMillis === "function"
  ) {
    try {
      updatedAt = (updatedAtRaw as any).toMillis();
    } catch (_) {
      updatedAt = undefined;
    }
  }

  const sessionState = normalizeAttendanceSessionState(
    dates,
    input?.sessionsByDate,
    input?.sessionLocks,
    input?.lockedDates
  );
  const records = normalizeAttendanceRecords(athletes, dates, input?.records ?? {});
  const sessionSelections = normalizeAttendanceSessionSelections(
    athletes,
    dates,
    sessionState.sessionsByDate,
    records,
    input?.sessionSelections
  );
  const deduped = dedupeAttendanceAthletesAndRecords(
    athletes,
    dates,
    records,
    sessionSelections,
    sessionState.sessionsByDate
  );

  return {
    team,
    dates,
    athletes: deduped.athletes,
    records: deduped.records,
    sessionSelections: deduped.sessionSelections,
    sessionsByDate: sessionState.sessionsByDate,
    sessionLocks: sessionState.sessionLocks,
    lockedDates: sessionState.lockedDates,
    updatedAt,
  };
};

const attendanceDocRef = (database: Firestore, team: Team) =>
  doc(database, "attendance", team);

export async function loadAttendanceSheet(
  team: Team
): Promise<AttendanceSheet> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    return readAttendanceLocal(team) ?? defaultAttendanceSheet(team);
  }

  try {
    const ref = attendanceDocRef(database, team);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const fallback = readAttendanceLocal(team) ?? defaultAttendanceSheet(team);
      return fallback;
    }
    const normalized = normalizeAttendanceSheet(snap.data(), team);
    writeAttendanceLocal(normalized);
    return normalized;
  } catch (err) {
    console.warn(`loadAttendanceSheet failed for ${team}`, err);
    return readAttendanceLocal(team) ?? defaultAttendanceSheet(team);
  }
}

export async function saveAttendanceSheet(
  sheet: AttendanceSheet,
  options?: { requireRemote?: boolean }
): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  const requireRemote = options?.requireRemote === true;
  if (!database && requireRemote) {
    throw new Error("Firebase is not available to sync attendance right now.");
  }

  const cleanDates = Array.from(
    new Set(sheet.dates.map((value) => value.trim()).filter(Boolean))
  );
  const cleanAthletes = sheet.athletes
    .map((athlete) => {
      const uid =
        typeof athlete.uid === "string" && athlete.uid.trim() ? athlete.uid.trim() : undefined;
      const number = sanitizeAttendanceDetail(athlete.number, 20);
      const grade = sanitizeAttendanceDetail(athlete.grade, 20);
      const height = sanitizeAttendanceDetail(athlete.height, 20);
      const weight = sanitizeAttendanceDetail(athlete.weight, 20);
      const position = sanitizeAttendanceDetail(athlete.position, 30);
      const letter = sanitizeAttendanceDetail(athlete.letter, 10);
      return {
        id: athlete.id,
        ...(uid ? { uid } : {}),
        firstName: sanitizeName(athlete.firstName),
        lastName: sanitizeName(athlete.lastName),
        level: normalizeTeam(athlete.level) ?? sheet.team,
        ...(number ? { number } : {}),
        ...(grade ? { grade } : {}),
        ...(height ? { height } : {}),
        ...(weight ? { weight } : {}),
        ...(position ? { position } : {}),
        ...(letter ? { letter } : {}),
      };
    })
    .filter((athlete) => athlete.id && (athlete.firstName || athlete.lastName));

  const cleanRecords = normalizeAttendanceRecords(
    cleanAthletes,
    cleanDates,
    sheet.records
  );
  const sessionState = normalizeAttendanceSessionState(
    cleanDates,
    sheet.sessionsByDate,
    sheet.sessionLocks,
    sheet.lockedDates
  );
  const cleanSessionsByDate = sessionState.sessionsByDate;
  const cleanSessionLocks = sessionState.sessionLocks;
  const cleanLockedDates = sessionState.lockedDates;
  const cleanSessionSelections = normalizeAttendanceSessionSelections(
    cleanAthletes,
    cleanDates,
    cleanSessionsByDate,
    cleanRecords,
    sheet.sessionSelections
  );

  const payload = {
    dates: cleanDates,
    athletes: cleanAthletes,
    records: cleanRecords,
    sessionSelections: cleanSessionSelections,
    sessionsByDate: cleanSessionsByDate,
    sessionLocks: cleanSessionLocks,
    lockedDates: cleanLockedDates,
    updatedAt: serverTimestamp(),
  };

  if (database) {
    const ref = attendanceDocRef(database, sheet.team);
    await setDoc(ref, payload, { merge: true });
    const statusRef = attendanceStatusDocRef(database, sheet.team);
    await setDoc(
      statusRef,
      {
        dates: cleanDates,
        sessionsByDate: cleanSessionsByDate,
        sessionLocks: cleanSessionLocks,
        lockedDates: cleanLockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  writeAttendanceLocal({
    team: sheet.team,
    dates: cleanDates,
    athletes: cleanAthletes,
    records: cleanRecords,
    sessionSelections: cleanSessionSelections,
    sessionsByDate: cleanSessionsByDate,
    sessionLocks: cleanSessionLocks,
    lockedDates: cleanLockedDates,
    updatedAt: Date.now(),
  });
}

const buildAttendanceAthleteIdForUid = (uid: string): string =>
  `uid-${uid}`.replace(/[^a-zA-Z0-9_-]/g, "_");

const findAttendanceAthleteForCheckin = (
  sheet: AttendanceSheet,
  team: Team,
  checkin: {
    uid: string;
    athleteId?: string;
    firstName?: string;
    lastName?: string;
  }
): AttendanceAthlete | null => {
  if (checkin.athleteId) {
    const byId = sheet.athletes.find((athlete) => athlete.id === checkin.athleteId);
    if (byId) return byId;
  }
  const byUid = sheet.athletes.find(
    (athlete) => athlete.level === team && athlete.uid === checkin.uid
  );
  if (byUid) return byUid;

  const first = sanitizeName(checkin.firstName ?? "").toLowerCase();
  const last = sanitizeName(checkin.lastName ?? "").toLowerCase();
  if (!first && !last) return null;
  const exactByName = sheet.athletes.find(
    (athlete) =>
      athlete.level === team &&
      sanitizeName(athlete.firstName).toLowerCase() === first &&
      sanitizeName(athlete.lastName).toLowerCase() === last
  );
  if (exactByName) return exactByName;

  return (
    sheet.athletes.find(
      (athlete) =>
        athlete.level === team &&
        areAttendanceNamesEquivalent(
          athlete.firstName,
          athlete.lastName,
          checkin.firstName ?? "",
          checkin.lastName ?? ""
        )
    ) ?? null
  );
};

const ensureAttendanceRowsForDates = (
  records: Record<string, Record<string, boolean>>,
  athletes: AttendanceAthlete[],
  dates: string[]
): Record<string, Record<string, boolean>> => {
  const nextRecords: Record<string, Record<string, boolean>> = { ...records };
  athletes.forEach((athlete) => {
    const row = { ...(nextRecords[athlete.id] ?? {}) };
    dates.forEach((date) => {
      if (!(date in row)) {
        row[date] = false;
      }
    });
    nextRecords[athlete.id] = row;
  });
  return nextRecords;
};

export async function loadAttendanceTeamStatus(team: Team): Promise<AttendanceTeamStatus> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    const local = readAttendanceLocal(team);
    return normalizeAttendanceTeamStatus(
      {
        dates: local?.dates ?? [],
        sessionsByDate: local?.sessionsByDate ?? {},
        sessionLocks: local?.sessionLocks ?? {},
        lockedDates: local?.lockedDates ?? {},
        updatedAt: local?.updatedAt,
      },
      team
    );
  }
  try {
    const snap = await getDoc(attendanceStatusDocRef(database, team));
    if (snap.exists()) {
      return normalizeAttendanceTeamStatus(snap.data(), team);
    }
  } catch (err) {
    console.warn(`loadAttendanceTeamStatus failed for ${team}`, err);
  }
  const local = readAttendanceLocal(team);
  return normalizeAttendanceTeamStatus(
    {
      dates: local?.dates ?? [],
      sessionsByDate: local?.sessionsByDate ?? {},
      sessionLocks: local?.sessionLocks ?? {},
      lockedDates: local?.lockedDates ?? {},
      updatedAt: local?.updatedAt,
    },
    team
  );
}

export async function loadAthleteAttendanceCheckin(
  team: Team,
  date: string,
  uid: string
): Promise<AttendanceCheckin | null> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return null;
  try {
    const snap = await getDoc(attendanceCheckinDocRef(database, team, date, uid));
    if (!snap.exists()) return null;
    return normalizeAttendanceCheckin(snap.data(), snap.id);
  } catch (err) {
    console.warn(`loadAthleteAttendanceCheckin failed for ${team} ${date}`, err);
    return null;
  }
}

export async function listAttendanceCheckinsForDate(
  team: Team,
  date: string
): Promise<AttendanceCheckin[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return [];
  try {
    const snap = await getDocs(
      query(
        collection(database, ATTENDANCE_CHECKINS_COLLECTION),
        where("dayKey", "==", buildAttendanceDayKey(team, date)),
        limit(600)
      )
    );
    return snap.docs
      .map((docSnap) => normalizeAttendanceCheckin(docSnap.data(), docSnap.id))
      .filter((row): row is AttendanceCheckin => row !== null)
      .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
  } catch (err) {
    console.warn(`listAttendanceCheckinsForDate failed for ${team} ${date}`, err);
    return [];
  }
}

export function subscribeAttendanceCheckinsForDate(
  team: Team,
  date: string,
  listener: (rows: AttendanceCheckin[]) => void,
  onError?: (error: unknown) => void
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  const cleanDate = date.trim();
  if (!database || !cleanDate) {
    listener([]);
    return () => {};
  }

  try {
    const q = query(
      collection(database, ATTENDANCE_CHECKINS_COLLECTION),
      where("dayKey", "==", buildAttendanceDayKey(team, cleanDate)),
      limit(600)
    );
    return onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => normalizeAttendanceCheckin(docSnap.data(), docSnap.id))
          .filter((row): row is AttendanceCheckin => row !== null)
          .sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0));
        listener(rows);
      },
      (error) => {
        console.warn(`subscribeAttendanceCheckinsForDate failed for ${team} ${cleanDate}`, error);
        if (onError) {
          onError(error);
        } else {
          listener([]);
        }
      }
    );
  } catch (err) {
    console.warn(`subscribeAttendanceCheckinsForDate setup failed for ${team} ${cleanDate}`, err);
    if (onError) {
      onError(err);
    } else {
      listener([]);
    }
    return () => {};
  }
}

export async function submitAthleteAttendanceCheckin(options: {
  team: Team;
  uid: string;
  firstName?: string;
  lastName?: string;
  date?: string;
}): Promise<AttendanceCheckin> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    throw new Error("Firebase is required for attendance check-in.");
  }
  const team = options.team;
  const requestedUid = options.uid.trim();
  const authUid = handles?.auth?.currentUser?.uid?.trim() ?? "";
  const uid = authUid || requestedUid;
  if (requestedUid && authUid && requestedUid !== authUid) {
    console.warn("submitAthleteAttendanceCheckin uid mismatch; using auth uid", {
      requestedUid,
      authUid,
      team,
    });
  }
  const firstName = sanitizeName(options.firstName ?? "");
  const lastName = sanitizeName(options.lastName ?? "");
  const date = (options.date ?? formatLocalDateInput(new Date())).trim();
  if (!uid) {
    throw new Error("Missing athlete UID for attendance check-in.");
  }
  if (!date) {
    throw new Error("Missing attendance check-in date.");
  }

  const checkin = await runTransaction(database, async (tx) => {
    const statusRef = attendanceStatusDocRef(database, team);
    const checkinRef = attendanceCheckinDocRef(database, team, date, uid);
    const statusSnap = await tx.get(statusRef);
    const status = normalizeAttendanceTeamStatus(statusSnap.data(), team);
    if (!status.dates.includes(date)) {
      throw new Error("attendance/checkin-closed");
    }

    const existingSnap = await tx.get(checkinRef);
    if (existingSnap.exists()) {
      const existing = normalizeAttendanceCheckin(existingSnap.data(), checkinRef.id);
      if (existing) return existing;
      throw new Error("attendance/checkin-invalid");
    }

    const sessionsForDate = status.sessionsByDate[date] ?? [];
    const sessionLocksForDate = status.sessionLocks[date] ?? {};
    const targetSession = resolveFirstUnlockedAttendanceSession(
      sessionsForDate,
      sessionLocksForDate
    );
    if (!targetSession || status.lockedDates[date]) {
      throw new Error("attendance/date-locked");
    }

    const now = Date.now();
    const created: AttendanceCheckin = {
      id: checkinRef.id,
      team,
      date,
      dayKey: buildAttendanceDayKey(team, date),
      sessionKey: targetSession.key,
      sessionLabel: targetSession.label,
      uid,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      status: "pending",
      submittedAt: now,
    };

    tx.set(checkinRef, {
      team,
      date,
      dayKey: created.dayKey,
      sessionKey: targetSession.key,
      sessionLabel: targetSession.label,
      uid,
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      status: "pending",
      submittedAt: serverTimestamp(),
    });
    return created;
  });

  return checkin;
}

export async function updateAttendanceCheckinStatus(options: {
  team: Team;
  date: string;
  uid: string;
  status: "approved" | "rejected";
  reviewedByName?: string;
  athleteId?: string;
  firstName?: string;
  lastName?: string;
  sessionKey?: string;
  sessionLabel?: string;
}): Promise<boolean> {
  const handles = resolveHandles();
  const database = handles?.db;
  const reviewerUid = handles?.auth?.currentUser?.uid ?? undefined;
  if (!database) return false;

  const team = options.team;
  const date = options.date.trim();
  const uid = options.uid.trim();
  const status = options.status;
  const reviewedByName = sanitizeName(options.reviewedByName ?? "");
  const athleteId =
    typeof options.athleteId === "string" && options.athleteId.trim()
      ? options.athleteId.trim()
      : undefined;
  const firstName = sanitizeName(options.firstName ?? "");
  const lastName = sanitizeName(options.lastName ?? "");
  let sessionKey = sanitizeAttendanceSessionKey(options.sessionKey);
  let sessionLabel = sanitizeAttendanceDetail(options.sessionLabel, 60);
  if (!date || !uid) return false;

  const checkinRef = attendanceCheckinDocRef(database, team, date, uid);
  const checkinSnap = await getDoc(checkinRef);
  if (!checkinSnap.exists()) {
    try {
      const status = await loadAttendanceTeamStatus(team);
      const sessionsForDate = status.sessionsByDate[date] ?? [];
      const sessionLocksForDate = status.sessionLocks[date] ?? {};
      const fallbackSession = sessionKey
        ? sessionsForDate.find((session) => session.key === sessionKey)
        : resolveFirstUnlockedAttendanceSession(sessionsForDate, sessionLocksForDate) ??
          sessionsForDate[0];
      if (fallbackSession) {
        sessionKey = fallbackSession.key;
        if (!sessionLabel) {
          sessionLabel = fallbackSession.label;
        }
      }
    } catch (_) {
      // ignore status lookup failures
    }
  } else if (!sessionKey || !sessionLabel) {
    const existing = normalizeAttendanceCheckin(checkinSnap.data(), checkinRef.id);
    if (existing) {
      if (!sessionKey) {
        sessionKey = existing.sessionKey;
      }
      if (!sessionLabel) {
        sessionLabel = existing.sessionLabel;
      }
    }
  }

  const createPayload = !checkinSnap.exists()
    ? {
        team,
        date,
        dayKey: buildAttendanceDayKey(team, date),
        ...(sessionKey ? { sessionKey } : {}),
        ...(sessionLabel ? { sessionLabel } : {}),
        uid,
        ...(athleteId ? { athleteId } : {}),
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        submittedAt: serverTimestamp(),
      }
    : {};

  await setDoc(
    checkinRef,
    {
      ...createPayload,
      status,
      reviewedAt: serverTimestamp(),
      ...(reviewerUid ? { reviewedBy: reviewerUid } : {}),
      ...(reviewedByName ? { reviewedByName } : {}),
      ...(athleteId ? { athleteId } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ...(sessionKey ? { sessionKey } : {}),
      ...(sessionLabel ? { sessionLabel } : {}),
    },
    { merge: true }
  );
  return true;
}

export async function reviewAttendanceCheckin(options: {
  team: Team;
  date: string;
  uid: string;
  status: "approved" | "rejected";
  reviewedByName?: string;
}): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  const reviewerUid = handles?.auth?.currentUser?.uid ?? undefined;
  if (!database) {
    throw new Error("Firebase is required to review attendance check-ins.");
  }

  const team = options.team;
  const date = options.date.trim();
  const uid = options.uid.trim();
  const reviewedByName = sanitizeName(options.reviewedByName ?? "");
  const status = options.status;
  if (!date || !uid) {
    throw new Error("Missing check-in review target.");
  }

  await runTransaction(database, async (tx) => {
    const attendanceRef = attendanceDocRef(database, team);
    const statusRef = attendanceStatusDocRef(database, team);
    const checkinRef = attendanceCheckinDocRef(database, team, date, uid);

    const checkinSnap = await tx.get(checkinRef);
    if (!checkinSnap.exists()) {
      throw new Error("attendance/checkin-not-found");
    }
    const checkin = normalizeAttendanceCheckin(checkinSnap.data(), checkinRef.id);
    if (!checkin) {
      throw new Error("attendance/checkin-invalid");
    }

    const attendanceSnap = await tx.get(attendanceRef);
    const statusSnap = await tx.get(statusRef);
    const baseSheet = attendanceSnap.exists()
      ? normalizeAttendanceSheet(attendanceSnap.data(), team)
      : defaultAttendanceSheet(team);
    const baseStatus = statusSnap.exists()
      ? normalizeAttendanceTeamStatus(statusSnap.data(), team)
      : normalizeAttendanceTeamStatus(
          {
            dates: baseSheet.dates,
            sessionsByDate: baseSheet.sessionsByDate,
            sessionLocks: baseSheet.sessionLocks,
            lockedDates: baseSheet.lockedDates,
          },
          team
        );

    const nextDates = baseSheet.dates.includes(date)
      ? [...baseSheet.dates]
      : [...baseSheet.dates, date].sort((a, b) => a.localeCompare(b));

    const seedDates = baseSheet.dates.length > 0 ? baseSheet.dates : baseStatus.dates;
    const sourceSessionsByDate =
      seedDates.length > 0 ? baseSheet.sessionsByDate : baseStatus.sessionsByDate;
    const sourceSessionLocks =
      seedDates.length > 0 ? baseSheet.sessionLocks : baseStatus.sessionLocks;
    const sourceLockedDates =
      seedDates.length > 0 ? baseSheet.lockedDates : baseStatus.lockedDates;

    const nextSessionState = normalizeAttendanceSessionState(
      nextDates,
      sourceSessionsByDate,
      sourceSessionLocks,
      sourceLockedDates
    );
    const nextSessionsByDate = nextSessionState.sessionsByDate;
    const nextSessionLocks = nextSessionState.sessionLocks;
    const nextLockedDates = nextSessionState.lockedDates;

    const checkinSessionsForDate = nextSessionsByDate[date] ?? [];
    let nextCheckinSessionKey =
      checkin.sessionKey &&
      checkinSessionsForDate.some((session) => session.key === checkin.sessionKey)
        ? checkin.sessionKey
        : checkinSessionsForDate[0]?.key;
    let nextCheckinSessionLabel = nextCheckinSessionKey
      ? checkinSessionsForDate.find((session) => session.key === nextCheckinSessionKey)?.label
      : undefined;
    if (!nextCheckinSessionLabel && checkin.sessionLabel) {
      nextCheckinSessionLabel = checkin.sessionLabel;
    }

    const nextAthletes = [...baseSheet.athletes];
    let nextRecords = ensureAttendanceRowsForDates(baseSheet.records, nextAthletes, nextDates);

    let matchedAthlete = findAttendanceAthleteForCheckin(baseSheet, team, {
      uid: checkin.uid,
      athleteId: checkin.athleteId,
      firstName: checkin.firstName,
      lastName: checkin.lastName,
    });

    if (!matchedAthlete && status === "approved") {
      const firstName = sanitizeName(checkin.firstName ?? "");
      const lastName = sanitizeName(checkin.lastName ?? "");
      matchedAthlete = {
        id: buildAttendanceAthleteIdForUid(checkin.uid),
        uid: checkin.uid,
        firstName: firstName || "Athlete",
        lastName,
        level: team,
      };
      nextAthletes.push(matchedAthlete);
      nextRecords = ensureAttendanceRowsForDates(nextRecords, nextAthletes, nextDates);
    }

    if (matchedAthlete) {
      const athleteIndex = nextAthletes.findIndex((row) => row.id === matchedAthlete!.id);
      if (athleteIndex >= 0) {
        const athleteRow = nextAthletes[athleteIndex];
        if (!athleteRow.uid) {
          nextAthletes[athleteIndex] = {
            ...athleteRow,
            uid: checkin.uid,
          };
        }
      }
      const row = { ...(nextRecords[matchedAthlete.id] ?? {}) };
      nextDates.forEach((value) => {
        if (!(value in row)) row[value] = false;
      });
      row[date] = status === "approved";
      nextRecords[matchedAthlete.id] = row;
    }

    const nextSessionSelections = normalizeAttendanceSessionSelections(
      nextAthletes,
      nextDates,
      nextSessionsByDate,
      nextRecords,
      baseSheet.sessionSelections
    );
    if (matchedAthlete) {
      const selectionRow = { ...(nextSessionSelections[matchedAthlete.id] ?? {}) };
      if (status === "approved" && nextCheckinSessionKey) {
        selectionRow[date] = nextCheckinSessionKey;
      } else {
        delete selectionRow[date];
      }
      if (Object.keys(selectionRow).length > 0) {
        nextSessionSelections[matchedAthlete.id] = selectionRow;
      } else {
        delete nextSessionSelections[matchedAthlete.id];
      }
    }

    tx.set(
      attendanceRef,
      {
        dates: nextDates,
        athletes: nextAthletes,
        records: nextRecords,
        sessionSelections: nextSessionSelections,
        sessionsByDate: nextSessionsByDate,
        sessionLocks: nextSessionLocks,
        lockedDates: nextLockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      statusRef,
      {
        dates: nextDates,
        sessionsByDate: nextSessionsByDate,
        sessionLocks: nextSessionLocks,
        lockedDates: nextLockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      checkinRef,
      {
        status,
        reviewedAt: serverTimestamp(),
        ...(reviewerUid ? { reviewedBy: reviewerUid } : {}),
        ...(reviewedByName ? { reviewedByName } : {}),
        ...(matchedAthlete ? { athleteId: matchedAthlete.id } : {}),
        ...(nextCheckinSessionKey ? { sessionKey: nextCheckinSessionKey } : {}),
        ...(nextCheckinSessionLabel ? { sessionLabel: nextCheckinSessionLabel } : {}),
      },
      { merge: true }
    );
  });
}

export async function setAttendanceDateLocked(
  team: Team,
  date: string,
  locked: boolean,
  reviewedByName?: string
): Promise<{ autoApprovedPending: number }> {
  const handles = resolveHandles();
  const database = handles?.db;
  const reviewerUid = handles?.auth?.currentUser?.uid ?? undefined;
  const cleanReviewedByName = sanitizeName(reviewedByName ?? "");
  if (!database) {
    throw new Error("Firebase is required to lock attendance dates.");
  }
  const targetDate = date.trim();
  if (!targetDate) {
    throw new Error("Missing attendance date.");
  }

  const pendingToApprove = locked
    ? (await listAttendanceCheckinsForDate(team, targetDate)).filter(
        (row) => row.status === "pending"
      )
    : [];

  await runTransaction(database, async (tx) => {
    const attendanceRef = attendanceDocRef(database, team);
    const statusRef = attendanceStatusDocRef(database, team);
    const attendanceSnap = await tx.get(attendanceRef);
    const statusSnap = await tx.get(statusRef);

    const baseSheet = attendanceSnap.exists()
      ? normalizeAttendanceSheet(attendanceSnap.data(), team)
      : defaultAttendanceSheet(team);
    const baseStatus = statusSnap.exists()
      ? normalizeAttendanceTeamStatus(statusSnap.data(), team)
      : normalizeAttendanceTeamStatus(
          {
            dates: baseSheet.dates,
            sessionsByDate: baseSheet.sessionsByDate,
            sessionLocks: baseSheet.sessionLocks,
            lockedDates: baseSheet.lockedDates,
          },
          team
        );
    const dates = baseSheet.dates.length > 0 ? baseSheet.dates : baseStatus.dates;
    if (!dates.includes(targetDate)) {
      throw new Error("attendance/date-not-found");
    }
    const sourceSessionsByDate =
      baseSheet.dates.length > 0 ? baseSheet.sessionsByDate : baseStatus.sessionsByDate;
    const sourceSessionLocks =
      baseSheet.dates.length > 0 ? baseSheet.sessionLocks : baseStatus.sessionLocks;
    const sourceLockedDates =
      baseSheet.dates.length > 0 ? baseSheet.lockedDates : baseStatus.lockedDates;
    const sessionState = normalizeAttendanceSessionState(
      dates,
      sourceSessionsByDate,
      sourceSessionLocks,
      sourceLockedDates
    );
    const sessionsByDate = sessionState.sessionsByDate;
    const sessionLocks: AttendanceSessionLocksByDate = {
      ...sessionState.sessionLocks,
      [targetDate]: { ...(sessionState.sessionLocks[targetDate] ?? {}) },
    };
    (sessionsByDate[targetDate] ?? []).forEach((session) => {
      sessionLocks[targetDate][session.key] = locked;
    });
    const lockedDates = deriveAttendanceLockedDatesFromSessionLocks(
      dates,
      sessionsByDate,
      sessionLocks,
      { ...sessionState.lockedDates, [targetDate]: locked }
    );
    const sessionsForTargetDate = sessionsByDate[targetDate] ?? [];
    const nextAthletes = [...baseSheet.athletes];
    let nextRecords = ensureAttendanceRowsForDates(baseSheet.records, nextAthletes, dates);
    const autoApprovedSessionAssignments: Array<{
      athleteId: string;
      sessionKey?: string;
    }> = [];

    if (locked && pendingToApprove.length > 0) {
      pendingToApprove.forEach((checkin) => {
        let matchedAthlete = findAttendanceAthleteForCheckin(baseSheet, team, {
          uid: checkin.uid,
          athleteId: checkin.athleteId,
          firstName: checkin.firstName,
          lastName: checkin.lastName,
        });
        if (!matchedAthlete) {
          const generatedId = buildAttendanceAthleteIdForUid(checkin.uid);
          const byGeneratedId =
            nextAthletes.find((athlete) => athlete.id === generatedId) ?? null;
          if (byGeneratedId) {
            matchedAthlete = byGeneratedId;
          } else {
            const firstName = sanitizeName(checkin.firstName ?? "");
            const lastName = sanitizeName(checkin.lastName ?? "");
            matchedAthlete = {
              id: generatedId,
              uid: checkin.uid,
              firstName: firstName || "Athlete",
              lastName,
              level: team,
            };
            nextAthletes.push(matchedAthlete);
            nextRecords = ensureAttendanceRowsForDates(nextRecords, nextAthletes, dates);
          }
        }

        if (matchedAthlete) {
          const athleteIndex = nextAthletes.findIndex(
            (athlete) => athlete.id === matchedAthlete!.id
          );
          if (athleteIndex >= 0 && !nextAthletes[athleteIndex].uid) {
            nextAthletes[athleteIndex] = {
              ...nextAthletes[athleteIndex],
              uid: checkin.uid,
            };
          }

          const row = { ...(nextRecords[matchedAthlete.id] ?? {}) };
          dates.forEach((value) => {
            if (!(value in row)) row[value] = false;
          });
          row[targetDate] = true;
          nextRecords[matchedAthlete.id] = row;
          const resolvedSessionKey =
            checkin.sessionKey &&
            sessionsForTargetDate.some((session) => session.key === checkin.sessionKey)
              ? checkin.sessionKey
              : sessionsForTargetDate[0]?.key;
          autoApprovedSessionAssignments.push({
            athleteId: matchedAthlete.id,
            sessionKey: resolvedSessionKey,
          });
        }

        const checkinRef = attendanceCheckinDocRef(database, team, targetDate, checkin.uid);
        tx.set(
          checkinRef,
          {
            status: "approved",
            reviewedAt: serverTimestamp(),
            ...(reviewerUid ? { reviewedBy: reviewerUid } : {}),
            ...(cleanReviewedByName ? { reviewedByName: cleanReviewedByName } : {}),
            ...(matchedAthlete ? { athleteId: matchedAthlete.id } : {}),
          },
          { merge: true }
        );
      });
    }

    const nextSessionSelections = normalizeAttendanceSessionSelections(
      nextAthletes,
      dates,
      sessionsByDate,
      nextRecords,
      baseSheet.sessionSelections
    );
    autoApprovedSessionAssignments.forEach(({ athleteId, sessionKey }) => {
      const row = { ...(nextSessionSelections[athleteId] ?? {}) };
      if (sessionKey) {
        row[targetDate] = sessionKey;
      } else {
        delete row[targetDate];
      }
      if (Object.keys(row).length > 0) {
        nextSessionSelections[athleteId] = row;
      } else {
        delete nextSessionSelections[athleteId];
      }
    });

    tx.set(
      attendanceRef,
      {
        dates,
        athletes: nextAthletes,
        records: nextRecords,
        sessionSelections: nextSessionSelections,
        sessionsByDate,
        sessionLocks,
        lockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      statusRef,
      {
        dates,
        sessionsByDate,
        sessionLocks,
        lockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });

  return { autoApprovedPending: pendingToApprove.length };
}

export async function setAttendanceSessionLocked(
  team: Team,
  date: string,
  sessionKey: string,
  locked: boolean
): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    throw new Error("Firebase is required to lock attendance sessions.");
  }
  const targetDate = date.trim();
  const targetSessionKey = sanitizeAttendanceSessionKey(sessionKey);
  if (!targetDate) {
    throw new Error("Missing attendance date.");
  }
  if (!targetSessionKey) {
    throw new Error("Missing attendance session.");
  }

  if (locked) {
    const existing = await listAttendanceCheckinsForDate(team, targetDate);
    if (
      existing.some(
        (row) =>
          row.status === "pending" &&
          (!row.sessionKey || row.sessionKey === targetSessionKey)
      )
    ) {
      throw new Error("attendance/pending-checkins");
    }
  }

  await runTransaction(database, async (tx) => {
    const attendanceRef = attendanceDocRef(database, team);
    const statusRef = attendanceStatusDocRef(database, team);
    const attendanceSnap = await tx.get(attendanceRef);
    const statusSnap = await tx.get(statusRef);

    const baseSheet = attendanceSnap.exists()
      ? normalizeAttendanceSheet(attendanceSnap.data(), team)
      : defaultAttendanceSheet(team);
    const baseStatus = statusSnap.exists()
      ? normalizeAttendanceTeamStatus(statusSnap.data(), team)
      : normalizeAttendanceTeamStatus(
          {
            dates: baseSheet.dates,
            sessionsByDate: baseSheet.sessionsByDate,
            sessionLocks: baseSheet.sessionLocks,
            lockedDates: baseSheet.lockedDates,
          },
          team
        );

    const dates = baseSheet.dates.length > 0 ? baseSheet.dates : baseStatus.dates;
    if (!dates.includes(targetDate)) {
      throw new Error("attendance/date-not-found");
    }

    const sourceSessionsByDate =
      baseSheet.dates.length > 0 ? baseSheet.sessionsByDate : baseStatus.sessionsByDate;
    const sourceSessionLocks =
      baseSheet.dates.length > 0 ? baseSheet.sessionLocks : baseStatus.sessionLocks;
    const sourceLockedDates =
      baseSheet.dates.length > 0 ? baseSheet.lockedDates : baseStatus.lockedDates;
    const sessionState = normalizeAttendanceSessionState(
      dates,
      sourceSessionsByDate,
      sourceSessionLocks,
      sourceLockedDates
    );
    const sessionsByDate = sessionState.sessionsByDate;
    const sessionsForDate = sessionsByDate[targetDate] ?? [];
    if (!sessionsForDate.some((session) => session.key === targetSessionKey)) {
      throw new Error("attendance/session-not-found");
    }

    const sessionLocks: AttendanceSessionLocksByDate = {
      ...sessionState.sessionLocks,
      [targetDate]: {
        ...(sessionState.sessionLocks[targetDate] ?? {}),
        [targetSessionKey]: locked,
      },
    };
    const lockedDates = deriveAttendanceLockedDatesFromSessionLocks(
      dates,
      sessionsByDate,
      sessionLocks,
      sessionState.lockedDates
    );

    tx.set(
      attendanceRef,
      {
        dates,
        sessionsByDate,
        sessionLocks,
        lockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    tx.set(
      statusRef,
      {
        dates,
        sessionsByDate,
        sessionLocks,
        lockedDates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  });
}

export type AccessHistory = {
  code: string;
  roles: string[];
  teamScopes: string[];
  teamAnchor: string | null;
  lastUsed: Timestamp;
};

type AccessHistoryRecord = Record<string, {
  roles: string[];
  teamScopes: string[];
  teamAnchor: string | null;
  lastUsed: Timestamp;
}>;

export async function getAccessHistory(): Promise<AccessHistory[]> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return [];

  const ref = roleRef(database, uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];

  const data = snap.data() as RolesDocument;
  if (!data.accessHistory) return [];

  const history = data.accessHistory as AccessHistoryRecord;
  return Object.entries(history).map(([code, record]) => ({
    code,
    roles: record.roles,
    teamScopes: record.teamScopes,
    teamAnchor: record.teamAnchor,
    lastUsed: record.lastUsed
  }));
}

export async function clearAccessHistory(): Promise<void> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return;

  const ref = roleRef(database, uid);
  await updateDoc(ref, {
    accessHistory: {},
    updatedAt: serverTimestamp()
  });
}

export async function getCurrentRoles(): Promise<string[]> {
  return await fetchRoles();
}

export async function isCoach(): Promise<boolean> {
  const roles = await fetchRoles();
  return roles.includes("coach") || roles.includes("admin");
}

export async function isAdmin(): Promise<boolean> {
  const roles = await fetchRoles();
  return roles.includes("admin");
}

export function resetRoleCache() {
  clearRoleCache();
  rolePromise = null;
}

export async function ensureRole(role: string): Promise<void> {
  const normalized = role.toLowerCase();
  const roles = await fetchRoles();
  if (roles.includes(normalized)) return;
  const updatedRoles = await setCurrentUserRoles([...roles, normalized]);
  if (!updatedRoles.length) {
    applyRoleCache([...roles, normalized]);
  }
}

export async function ensureCoachRole(): Promise<void> {
  await ensureRole("coach");
}

const rolesEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export async function ensureCoachRoleOnly(): Promise<void> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return;

  const ref = roleRef(database, uid);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data() as RolesDocument : null;
  const roles = await fetchRoles();

  // Remove admin role if present
  const filtered = roles.filter((role) => role !== "admin");
  if (!filtered.includes("coach")) {
    filtered.push("coach");
  }

  // Only update if roles changed
  if (rolesEqual(filtered, roles)) return;

  // Build update payload preserving history
  const payload: Record<string, unknown> = {
    roles: filtered,
    updatedAt: serverTimestamp(),
  };

  // Don't include teamScopes in initial write - let updateCoachTeamScope handle it
  // Only preserve existing teamScopes if document already exists
  if (existing?.teamScopes && existing.teamScopes.length > 0) {
    payload.teamScopes = existing.teamScopes;
  }
  
  // Only include teamAnchor if it exists
  if (existing?.teamAnchor) {
    payload.teamAnchor = existing.teamAnchor;
  }
  
  // Build accessHistory properly as a nested object
  const existingHistory = existing?.accessHistory ?? {};
  payload.accessHistory = {
    ...existingHistory,
    "2468": {
      roles: ["coach"],
      teamScopes: existing?.teamScopes || [],
      teamAnchor: existing?.teamAnchor ?? null,
      lastUsed: serverTimestamp()
    }
  };

  await setDoc(ref, payload, { merge: true });
  applyRoleCache(filtered);
}

export async function ensureAdminRole(): Promise<void> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return;

  const ref = roleRef(database, uid);
  const snap = await getDoc(ref);
  const existing = snap.exists() ? snap.data() as RolesDocument : null;
  const roles = await fetchRoles();
  
  // If already admin, just ensure coach role
  if (roles.includes("admin")) {
    if (!roles.includes("coach")) {
      const updated = await setCurrentUserRoles([...roles, "coach"]);
      if (!updated.length) {
        applyRoleCache([...roles, "coach"]);
      }
    }
    return;
  }

  // Combine roles for admin - minimal payload
  const combined = ["admin", "coach"];
  
  // Build minimal update payload
  const payload: Record<string, unknown> = {
    roles: combined,
    updatedAt: serverTimestamp(),
  };

  await setDoc(ref, payload, { merge: true });
  applyRoleCache(combined);
}

export type Lift = "bench" | "squat" | "deadlift";
type Week = 1 | 2 | 3;

export type SessionSet = {
  pct: number;
  weight: number;
  reps: number;
  status?: "S" | "F";
  actualReps?: number | null;
};
export type SessionPayload = {
  lift: Lift;
  week: Week;
  cycle: number;
  team?: Team;
  unit: Unit;
  tm: number;
  warmups: SessionSet[];
  work: SessionSet[];
  amrap: { weight: number; reps: number };
  est1rm: number;
  note?: string;
  pr?: boolean;
};

export type SessionRecord = SessionPayload & {
  id?: string;
  uid?: string;
  createdAt?: number | null;
  source?: "remote" | "local";
};

const SESSION_KEY = "pl.sessions.v1";

const readLocalSessions = (): SessionRecord[] => {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as SessionRecord[];
  } catch (err) {
    console.warn("Failed to read local sessions", err);
  }
  return [];
};

const writeLocalSessions = (rows: SessionRecord[]) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(rows));
  } catch (err) {
    console.warn("Failed to write local sessions", err);
  }
};

const persistLocalSession = (session: SessionRecord) => {
  const rows = readLocalSessions();
  rows.push(session);
  writeLocalSessions(rows);
};

const toMillis = (value: any): number => {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object") {
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") {
      return value.seconds * 1000 + Math.round((value.nanoseconds || 0) / 1e6);
    }
  }
  return 0;
};

const normalizeSetList = (value: any): SessionSet[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const pct = Number(item?.pct);
    const weight = Number(item?.weight);
    const reps = Number(item?.reps);
    const status =
      item?.status === "S" || item?.status === "F" ? (item.status as "S" | "F") : undefined;
    const rawActual =
      typeof item?.actualReps === "number"
        ? item.actualReps
        : typeof item?.actualReps === "string"
        ? Number(item.actualReps)
        : undefined;
    const actualReps =
      status === "F" && Number.isFinite(rawActual) && (rawActual as number) >= 0
        ? Number(rawActual)
        : undefined;
    return {
      pct: Number.isFinite(pct) ? pct : 0,
      weight: Number.isFinite(weight) ? weight : 0,
      reps: Number.isFinite(reps) ? reps : 0,
      status,
      actualReps,
    };
  });
};

const normalizeSession = (
  raw: any,
  overrides: Partial<SessionRecord> = {}
): SessionRecord => {
  const createdAt = toMillis(raw?.createdAt) || Date.now();
  const rawCycle = Number(raw?.cycle);
  const cycle = Number.isFinite(rawCycle) && rawCycle >= 1 ? Math.floor(rawCycle) : 1;
  const overrideTeam = normalizeTeam((overrides as any)?.team);
  const resolvedTeam = normalizeTeam(raw?.team) ?? overrideTeam;
  return {
    lift: raw.lift,
    week: raw.week,
    cycle,
    unit: raw.unit,
    tm: raw.tm,
    warmups: normalizeSetList(raw.warmups),
    work: normalizeSetList(raw.work),
    amrap: raw.amrap || { weight: 0, reps: 0 },
    est1rm: raw.est1rm ?? 0,
    note: raw.note || "",
    pr: !!raw.pr,
    createdAt,
    ...overrides,
    team: resolvedTeam,
  };
};

export async function saveSession(
  payload: SessionPayload,
  targetUid?: string,
  options?: { requireRemote?: boolean }
): Promise<{ source: "remote" | "local" }> {
  const requireRemote = options?.requireRemote === true;
  const resolvedTeam =
    normalizeTeam(payload.team) ??
    (typeof window !== "undefined" ? normalizeTeam(getStoredTeamSelection()) : undefined);
  const basePayload = {
    ...payload,
    team: resolvedTeam,
  };
  const base = normalizeSession(basePayload, {
    createdAt: Date.now(),
    source: "local",
  });

  const handles = resolveHandles();
  const database = handles?.db;

  if (targetUid) {
    if (!database) {
      throw new Error("Firebase is not available for coach session save.");
    }
    const col = collection(database, "athletes", targetUid, "sessions");
    await addDoc(col, {
      ...basePayload,
      createdAt: serverTimestamp(),
    });
    return { source: "remote" };
  }

  let uid: string | null = null;
  try {
    uid = await getUid();
  } catch (err) {
    console.warn("saveSession getUid failed", err);
  }

  if (!uid || !database) {
    if (requireRemote) {
      throw new Error("Firebase is not available to sync this session right now.");
    }
    persistLocalSession({ ...base, uid: uid ?? LOCAL_UID });
    return { source: "local" };
  }

  const col = collection(database, "athletes", uid, "sessions");
  await addDoc(col, {
    ...basePayload,
    createdAt: serverTimestamp(),
  });

  return { source: "remote" };
}

export async function recentSessions(
  lift: Lift,
  count = 10,
  targetUid?: string,
  team?: Team
): Promise<SessionRecord[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  const teamFilter = team ? normalizeTeam(team) : undefined;

  if (targetUid) {
    if (!database) return [];
    try {
      const col = collection(database, "athletes", targetUid, "sessions");
      const fetchLimit = Math.max(count * 3, 25);
      const snap = await getDocs(
        query(col, orderBy("createdAt", "desc"), limit(fetchLimit))
      );
      const remote = snap.docs
        .map((docSnap) =>
          normalizeSession(docSnap.data(), {
            id: docSnap.id,
            uid: targetUid,
            source: "remote",
          })
        )
        .filter((s) => s.lift === lift)
        .filter((s) =>
          teamFilter ? s.team === teamFilter || !s.team : true
        );
      return remote.slice(0, count);
    } catch (err) {
      console.warn("recentSessions coach query failed", err);
      return [];
    }
  }

  const local = readLocalSessions()
    .filter((s) => s.lift === lift)
    .filter((s) => (teamFilter ? s.team === teamFilter || !s.team : true));
  const localSorted = local
    .map((s) =>
      normalizeSession(s, { source: "local", uid: s.uid ?? LOCAL_UID })
    )
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  let uid: string | null = null;
  try {
    uid = await getUid();
  } catch (err) {
    console.warn("recentSessions getUid failed", err);
  }

  if (!uid || !database) {
    return localSorted.slice(0, count);
  }

  try {
    const col = collection(database, "athletes", uid, "sessions");
    const fetchLimit = Math.max(count * 3, 25);
    const snap = await getDocs(
      query(col, orderBy("createdAt", "desc"), limit(fetchLimit))
    );
    const remote = snap.docs
      .map((docSnap) =>
        normalizeSession(docSnap.data(), {
          id: docSnap.id,
          uid,
          source: "remote",
        })
      )
      .filter((s) => s.lift === lift)
      .filter((s) =>
        teamFilter ? s.team === teamFilter || !s.team : true
      );

    const combined = [...remote, ...localSorted];
    combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return combined.slice(0, count);
  } catch (err) {
    console.warn("recentSessions query failed", err);
    return localSorted.slice(0, count);
  }
}

export async function bestEst1RM(
  lift: Lift,
  sample = 10,
  targetUid?: string,
  team?: Team
): Promise<number> {
  const rows = await recentSessions(lift, sample, targetUid, team);
  const ests = rows
    .map((r) => (typeof r.est1rm === "number" ? r.est1rm : Number(r.est1rm)))
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (!ests.length) return 0;
  return Math.max(...ests);
}

export type AthleteCodeStatus = "ok" | "taken" | "unavailable";

export async function ensureAthleteCode(
  uid: string,
  code: string,
  previous?: string | null
): Promise<AthleteCodeStatus> {
  const trimmed = (code ?? "").trim();
  if (!trimmed) return "unavailable";

  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return "ok";

  const newRef = doc(database, "athleteCodes", trimmed);
  const shouldClearPrevious = previous && previous !== trimmed;
  const prevRef =
    shouldClearPrevious && previous
      ? doc(database, "athleteCodes", previous)
      : null;

  try {
    await runTransaction(database, async (tx) => {
      const existing = await tx.get(newRef);
      let prevSnap: DocumentSnapshot | null = null;
      if (prevRef) {
        prevSnap = await tx.get(prevRef);
      }

      if (existing.exists()) {
        const owner = existing.data()?.uid;
        if (owner && owner !== uid) {
          throw new Error("TAKEN");
        }
      }

      tx.set(newRef, { uid, updatedAt: serverTimestamp() });

      if (prevRef && prevSnap?.exists()) {
        const owner = prevSnap.data()?.uid;
        if (owner === uid) {
          tx.delete(prevRef);
        }
      }
    });
    return "ok";
  } catch (err: any) {
    if (err?.message === "TAKEN") return "taken";
    console.warn("ensureAthleteCode transaction failed", err);
    return "unavailable";
  }
}

const generateCodeCandidate = (): string => {
  const value = Math.floor(Math.random() * 9000) + 1000;
  return String(value);
};

export type AssignAthleteAccessCodeResult = {
  status: AthleteCodeStatus;
  code: string;
  source: "remote" | "local";
};

export async function assignAthleteAccessCode(
  targetUid: string,
  code: string
): Promise<AssignAthleteAccessCodeResult> {
  const trimmed = (code ?? "").trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return { status: "unavailable", code: trimmed, source: "remote" };
  }

  let profile = await loadProfileRemote(targetUid);
  if (!profile) {
    profile = {
      uid: targetUid,
      firstName: "",
      lastName: "",
      unit: "lb",
      team: undefined,
      tm: {},
      oneRm: {},
      accessCode: null,
      equipment: defaultEquipment(),
    };
  }

  const normalized: Profile = {
    ...profile,
    accessCode: trimmed,
    tm: profile.tm ?? {},
    oneRm: profile.oneRm ?? {},
    equipment: profile.equipment ?? defaultEquipment(),
  };

  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    return { status: "unavailable", code: trimmed, source: "remote" };
  }

  const status = await ensureAthleteCode(targetUid, trimmed, profile.accessCode ?? null);
  if (status === "taken") {
    return { status, code: trimmed, source: "remote" };
  }
  if (status !== "ok") {
    return { status, code: trimmed, source: "remote" };
  }

  try {
    await saveProfile(normalized, { requireRemote: true });
    return { status: "ok", code: trimmed, source: "remote" };
  } catch (err) {
    console.warn("Failed to sync access code to Firestore.", err);
    return { status: "unavailable", code: trimmed, source: "remote" };
  }
}

export async function regenerateAthleteCode(targetUid: string): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = generateCodeCandidate();
    const result = await assignAthleteAccessCode(targetUid, candidate);
    if (result.status === "ok") {
      return result.code;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Could not reserve a unique code. Try again.");
}

export type DeleteAthleteResult = {
  status: "ok" | "partial";
  warnings: string[];
};

export async function deleteAthlete(uid: string): Promise<DeleteAthleteResult> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    throw new Error("Firebase is required to delete athletes.");
  }

  const auth = handles?.auth;
  const warnings: string[] = [];
  let profile: Profile | null = null;
  try {
    profile = await loadProfileRemote(uid);
  } catch (err) {
    warnings.push("profile lookup");
    console.warn("Failed to load profile before deletion", err);
  }
  const sessionsCol = collection(database, "athletes", uid, "sessions");
  let sessionRefs: DocumentReference[] = [];

  try {
    const snap = await getDocs(sessionsCol);
    sessionRefs = snap.docs.map((docSnap) => docSnap.ref);
  } catch (err) {
    console.warn("Failed to list sessions before deleting athlete", err);
    warnings.push("sessions lookup");
  }

  if (sessionRefs.length) {
    const chunkSize = 400;
    for (let i = 0; i < sessionRefs.length; i += chunkSize) {
      const batch = writeBatch(database);
      sessionRefs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
      try {
        await batch.commit();
      } catch (err) {
        console.warn("Failed to delete some athlete sessions", err);
        warnings.push("sessions");
        break;
      }
    }
  }

  const accessCodes = new Set<string>();
  if (profile?.accessCode) {
    accessCodes.add(profile.accessCode);
  } else {
    try {
      const codeSnap = await getDocs(
        query(collection(database, "athleteCodes"), where("uid", "==", uid))
      );
      codeSnap.forEach((docSnap) => accessCodes.add(docSnap.id));
    } catch (err) {
      console.warn("Failed to query athlete code mapping for deletion", err);
      warnings.push("access codes lookup");
    }
  }

  try {
    await deleteDoc(profRef(database, uid));
  } catch (err) {
    console.warn("Failed to delete athlete profile", err);
    throw err;
  }

  if (accessCodes.size) {
    const codeBatch = writeBatch(database);
    accessCodes.forEach((code) =>
      codeBatch.delete(doc(database, "athleteCodes", code))
    );
    try {
      await codeBatch.commit();
    } catch (err) {
      console.warn("Failed to remove athlete codes", err);
      warnings.push("access codes");
    }
  }

  try {
    await deleteDoc(roleRef(database, uid));
  } catch (err) {
    console.warn(`Failed to remove role mapping for ${uid}`, err);
    warnings.push("role mapping");
  }

  if (auth?.currentUser?.uid === uid) {
    return {
      status: warnings.length ? "partial" : "ok",
      warnings,
    };
  }

  try {
    const queueRef = doc(collection(database, AUTH_DELETE_QUEUE_COLLECTION), uid);
    await setDoc(
      queueRef,
      {
        uid,
        status: "pending",
        requestedAt: serverTimestamp(),
        requestedBy: auth?.currentUser?.uid ?? null,
      },
      { merge: true }
    );
  } catch (err) {
    console.warn(`Failed to queue auth deletion for ${uid}`, err);
    warnings.push("auth deletion");
  }

  return {
    status: warnings.length ? "partial" : "ok",
    warnings,
  };
}

export async function fetchAthleteSessions(
  uid: string,
  count = 12,
  team?: Team
): Promise<SessionRecord[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return [];
  const teamFilter = team ? normalizeTeam(team) : undefined;
  try {
    const col = collection(database, "athletes", uid, "sessions");
    const snap = await getDocs(
      query(col, orderBy("createdAt", "desc"), limit(Math.max(count, 1)))
    );
    return snap.docs
      .map((docSnap) =>
        normalizeSession(docSnap.data(), {
          id: docSnap.id,
          uid,
          source: "remote",
        })
      )
      .filter((session) =>
        teamFilter ? session.team === teamFilter || !session.team : true
      );
  } catch (err) {
    return [];
  }
}

/**
 * Batch-fetch the most recent session timestamp for every athlete in a single
 * collectionGroup query instead of one query per athlete (N+1).
 * Returns a map of athleteUid → createdAt (ms).
 */
export async function fetchLastWorkoutDates(
  team?: Team
): Promise<Record<string, number>> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return {};

  const teamFilter = team ? normalizeTeam(team) : undefined;

  try {
    const cg = collectionGroup(database, "sessions");
    const q = teamFilter
      ? query(cg, where("team", "==", teamFilter), orderBy("createdAt", "desc"))
      : query(cg, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);

    const result: Record<string, number> = {};
    for (const docSnap of snap.docs) {
      // Path: athletes/{uid}/sessions/{sessionId}
      const parts = docSnap.ref.path.split("/");
      const uid = parts[1] ?? "";
      if (!uid || result[uid]) continue; // Keep only the most recent per athlete
      const ts = toMillis(docSnap.data()?.createdAt);
      if (ts) result[uid] = ts;
    }
    return result;
  } catch (err) {
    console.warn("fetchLastWorkoutDates failed", err);
    return {};
  }
}

/**
 * Fetch the most recent attendance check-in/review timestamp per athlete for a team.
 * Returns a map of athleteUid -> timestamp (ms).
 */
export async function fetchLastAttendanceCheckinDates(
  team?: Team
): Promise<Record<string, number>> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return {};

  const teamFilter = team ? normalizeTeam(team) : undefined;
  if (!teamFilter) return {};

  try {
    const col = collection(database, ATTENDANCE_CHECKINS_COLLECTION);
    const snap = await getDocs(query(col, where("team", "==", teamFilter)));
    const result: Record<string, number> = {};

    snap.forEach((docSnap) => {
      const data = docSnap.data();
      const uid = typeof data?.uid === "string" ? data.uid : "";
      if (!uid) return;

      const ts = toMillis(data?.submittedAt);
      if (!ts) return;

      if (!result[uid] || ts > result[uid]) {
        result[uid] = ts;
      }
    });

    return result;
  } catch (err) {
    console.warn("fetchLastAttendanceCheckinDates failed", err);
    return {};
  }
}

export async function updateSession(
  uid: string,
  sessionId: string,
  updates: Partial<SessionPayload>
): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) throw new Error("Firebase is required to update sessions.");

  const ref = doc(database, "athletes", uid, "sessions", sessionId);
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteSession(uid: string, sessionId: string): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) throw new Error("Firebase is required to delete sessions.");
  const ref = doc(database, "athletes", uid, "sessions", sessionId);
  await deleteDoc(ref);
}

// ---- Real-time Session Subscriptions ----

export type SessionListener = (sessions: SessionRecord[]) => void;

/**
 * Subscribe to real-time session updates for a specific athlete.
 * Returns an unsubscribe function.
 */
export function subscribeToAthleteSessions(
  uid: string,
  listener: SessionListener,
  options?: { count?: number; team?: Team }
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  const count = options?.count ?? 20;
  const teamFilter = options?.team ? normalizeTeam(options.team) : undefined;

  if (!database) {
    // No Firebase - return empty and noop unsubscribe
    listener([]);
    return () => {};
  }

  const col = collection(database, "athletes", uid, "sessions");
  const q = query(col, orderBy("createdAt", "desc"), limit(Math.max(count, 1)));

  return onSnapshot(
    q,
    (snapshot) => {
      const sessions = snapshot.docs
        .map((docSnap) =>
          normalizeSession(docSnap.data(), {
            id: docSnap.id,
            uid,
            source: "remote",
          })
        )
        .filter((session) =>
          teamFilter ? session.team === teamFilter || !session.team : true
        );
      listener(sessions);
    },
    (error) => {
      console.warn("subscribeToAthleteSessions error:", error);
      listener([]);
    }
  );
}

/**
 * Subscribe to real-time session updates across all athletes on a team.
 * Returns an unsubscribe function.
 */
export function subscribeToTeamSessions(
  team: Team,
  listener: (sessions: Array<SessionRecord & { athleteId: string }>) => void,
  options?: { count?: number; since?: number }
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;
  const maxCount = options?.count ?? 50;
  const sinceTime = options?.since ?? Date.now() - 24 * 60 * 60 * 1000; // Default: last 24 hours

  if (!database) {
    listener([]);
    return () => {};
  }

  // Use collectionGroup to query all sessions subcollections
  const cg = collectionGroup(database, "sessions");
  const q = query(
    cg,
    where("team", "==", team),
    orderBy("createdAt", "desc"),
    limit(maxCount)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const sessions = snapshot.docs
        .map((docSnap) => {
          // Extract athlete UID from the document path: athletes/{uid}/sessions/{sessionId}
          const pathParts = docSnap.ref.path.split("/");
          const athleteId = pathParts[1] ?? "";
          const data = docSnap.data();
          const createdAt = toMillis(data?.createdAt) || 0;
          
          // Filter by time
          if (createdAt < sinceTime) return null;
          
          return {
            ...normalizeSession(data, {
              id: docSnap.id,
              uid: athleteId,
              source: "remote" as const,
            }),
            athleteId,
          };
        })
        .filter((s): s is SessionRecord & { athleteId: string } => s !== null);
      
      listener(sessions);
    },
    (error) => {
      console.warn("subscribeToTeamSessions error:", error);
      listener([]);
    }
  );
}

/**
 * Subscribe to a single athlete's profile for real-time updates.
 * Useful for athletes to see coach-made changes instantly.
 */
export function subscribeToProfile(
  uid: string,
  listener: (profile: Profile | null) => void
): () => void {
  const handles = resolveHandles();
  const database = handles?.db;

  if (!database) {
    listener(null);
    return () => {};
  }

  const ref = profRef(database, uid);

  return onSnapshot(
    ref,
    (snapshot) => {
      if (!snapshot.exists()) {
        listener(null);
        return;
      }
      const profile = normalizeProfileData(snapshot.data(), uid);
      listener(profile);
    },
    (error) => {
      console.warn("subscribeToProfile error:", error);
      listener(null);
    }
  );
}

// ---- Sync local sessions to Firebase ----

/**
 * Sync any orphaned local sessions to Firebase.
 * Call this on app startup when Firebase is available.
 * Returns the number of sessions synced.
 */
export async function syncLocalSessionsToFirebase(): Promise<number> {
  const handles = resolveHandles();
  const database = handles?.db;
  
  if (!database) return 0;
  
  let uid: string | null = null;
  try {
    uid = await getUid();
  } catch {
    return 0;
  }
  
  if (!uid || uid === LOCAL_UID) return 0;
  
  const localSessions = readLocalSessions();
  if (!localSessions.length) return 0;
  
  const col = collection(database, "athletes", uid, "sessions");
  let synced = 0;
  
  for (const session of localSessions) {
    try {
      const { id, uid: sessionUid, source, createdAt, ...payload } = session;
      await addDoc(col, {
        ...payload,
        createdAt: serverTimestamp(),
        syncedFrom: "local",
        originalCreatedAt: createdAt,
      });
      synced++;
    } catch (err) {
      console.warn("Failed to sync local session:", err);
    }
  }
  
  // Clear local sessions after successful sync
  if (synced > 0) {
    writeLocalSessions([]);
    console.log(`Synced ${synced} local sessions to Firebase`);
  }
  
  return synced;
}

export async function fetchTeamProfiles(
  team: Team,
  options?: { excludeRoles?: string[] }
): Promise<Profile[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return [];
  
  const cg = collectionGroup(database, "profile");
  const snap = await getDocs(cg);
  
  const profiles: Profile[] = [];
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const uid = data.uid || docSnap.ref.path.split("/")[1];
    const pTeam = normalizeTeam(data.team);
    const pTeamAnchor = normalizeTeam(data.teamAnchor ?? data.team);
    const teamData = normalizeTeamTrainingMap(data.teamData);
    const teamDataTeams = Object.keys(teamData)
      .map((entry) => normalizeTeam(entry))
      .filter((entry): entry is Team => Boolean(entry));
    const teamScopes = mergeTeamScopes(
      sanitizeTeamScopeArray(data.teamScopes),
      pTeamAnchor,
      pTeam,
      teamDataTeams
    );
    const inRequestedTeam =
      pTeam === team ||
      pTeamAnchor === team ||
      teamScopes.includes(team) ||
      Boolean(teamData[team]);

    if (!inRequestedTeam) return;

    const activeState = teamData[team];
    const legacyTm = normalizeLiftMap(data.tm);
    const legacyOneRm = normalizeLiftMap(data.oneRm);
    const legacyLiftWeeks = normalizeLiftWeekMap(data.liftWeeks);
    const legacyLiftCycles = normalizeLiftCycleMap(data.liftCycles);
    const tm =
      activeState?.tm && Object.keys(activeState.tm).length
        ? activeState.tm
        : legacyTm;
    const oneRm =
      activeState?.oneRm && Object.keys(activeState.oneRm).length
        ? activeState.oneRm
        : legacyOneRm;
    const liftWeeks =
      activeState?.liftWeeks && Object.keys(activeState.liftWeeks).length
        ? activeState.liftWeeks
        : legacyLiftWeeks;
    const liftCycles =
      activeState?.liftCycles && Object.keys(activeState.liftCycles).length
        ? activeState.liftCycles
        : legacyLiftCycles;

    profiles.push({
      uid,
      firstName: data.firstName || "",
      lastName: data.lastName || "",
      unit: (data.unit as Unit) || "lb",
      createdAt: toMillis(data.createdAt) || undefined,
      updatedAt: toMillis(data.updatedAt) || undefined,
      updatedBy: typeof data.updatedBy === "string" ? data.updatedBy : null,
      team: pTeamAnchor ?? pTeam ?? team,
      teamAnchor: pTeamAnchor ?? pTeam ?? team,
      teamScopes,
      teamData,
      tm,
      oneRm,
      accessCode: data.accessCode,
      equipment: normalizeEquipment(data.equipment as EquipmentSettings | undefined),
      currentWeek: activeState?.currentWeek ?? normalizeWeek(data.currentWeek) ?? 1,
      currentCycle: activeState?.currentCycle ?? normalizeCycle(data.currentCycle) ?? 1,
      liftWeeks: Object.keys(liftWeeks).length ? liftWeeks : undefined,
      liftCycles: Object.keys(liftCycles).length ? liftCycles : undefined,
    } as Profile);
  });

  if (options?.excludeRoles?.length) {
    const filtered = await Promise.all(
      profiles.map(async (p) => {
        try {
          const roleSnap = await getDoc(roleRef(database, p.uid));
          const roles = roleSnap.exists() ? normalizeRoles(roleSnap.data()) : [];
          const hasExcluded = options.excludeRoles!.some((r) => roles.includes(r));
          return hasExcluded ? null : p;
        } catch (err) {
          console.warn(`Failed to check roles for ${p.uid}`, err);
          return p;
        }
      })
    );
    return filtered.filter((p): p is Profile => p !== null);
  }

  return profiles;
}

// ---- Custom Quotes for NFC Welcome Screen ----

export type CustomQuote = {
  id?: string;
  text: string;
  author: string;
  createdAt?: Date;
  createdBy?: string;
};

/**
 * Load all custom quotes from Firestore (org-level collection).
 * Falls back to empty array if Firebase is unavailable.
 */
export async function loadCustomQuotes(): Promise<CustomQuote[]> {
  const database = fb.db;
  if (!database) return [];

  try {
    const quotesRef = collection(database, "quotes");
    const q = query(quotesRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        text: data.text ?? "",
        author: data.author ?? "Unknown",
        createdAt: data.createdAt?.toDate?.() ?? undefined,
        createdBy: data.createdBy ?? undefined,
      };
    });
  } catch (err) {
    console.warn("Failed to load custom quotes", err);
    return [];
  }
}

/**
 * Save a new custom quote to Firestore.
 * Only coaches should call this.
 */
export async function saveCustomQuote(
  quote: { text: string; author: string },
  uid?: string
): Promise<string | null> {
  const database = fb.db;
  if (!database) return null;

  try {
    const quotesRef = collection(database, "quotes");
    const docRef = await addDoc(quotesRef, {
      text: quote.text.trim(),
      author: quote.author.trim() || "Unknown",
      createdAt: serverTimestamp(),
      createdBy: uid ?? null,
    });
    return docRef.id;
  } catch (err) {
    console.warn("Failed to save custom quote", err);
    return null;
  }
}

/**
 * Delete a custom quote from Firestore.
 */
export async function deleteCustomQuote(quoteId: string): Promise<boolean> {
  const database = fb.db;
  if (!database) return false;

  try {
    await deleteDoc(doc(database, "quotes", quoteId));
    return true;
  } catch (err) {
    console.warn("Failed to delete custom quote", err);
    return false;
  }
}

// ---- NFC Tag Tap Logging ----

export type NfcTapLog = {
  tagId: string;
  timestamp: Date;
  uid?: string;
};

/**
 * Log an NFC tag tap for analytics.
 * This is fire-and-forget - failures are silent.
 */
export async function logNfcTap(tagId: string, uid?: string): Promise<void> {
  const database = fb.db;
  if (!database) return;

  try {
    const logsRef = collection(database, "nfcTaps");
    await addDoc(logsRef, {
      tagId,
      timestamp: serverTimestamp(),
      uid: uid ?? null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch (err) {
    // Silent fail - analytics not critical
    console.debug("NFC tap log failed", err);
  }
}

/**
 * Get NFC tap statistics (for admin dashboard).
 * Returns tap counts per tag for the last N days.
 */
export async function getNfcTapStats(
  days: number = 30
): Promise<Record<string, number>> {
  const database = fb.db;
  if (!database) return {};

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const logsRef = collection(database, "nfcTaps");
    const q = query(logsRef, where("timestamp", ">=", cutoff));
    const snapshot = await getDocs(q);
    
    const counts: Record<string, number> = {};
    snapshot.docs.forEach((docSnap) => {
      const data = docSnap.data();
      const tag = data.tagId ?? "unknown";
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
    
    return counts;
  } catch (err) {
    console.warn("Failed to get NFC tap stats", err);
    return {};
  }
}

// ---- Featured Quote of the Day ----

export type FeaturedQuote = {
  text: string;
  author: string;
  date: string; // YYYY-MM-DD format
  setBy?: string;
};

/**
 * Get today's date in YYYY-MM-DD format.
 */
function getTodayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * Get the featured quote for today (if one was set).
 * Returns null if no featured quote or if it's from a different day.
 */
export async function getFeaturedQuote(): Promise<FeaturedQuote | null> {
  const database = fb.db;
  if (!database) return null;

  try {
    const docRef = doc(database, "settings", "featuredQuote");
    const snapshot = await getDoc(docRef);
    
    if (!snapshot.exists()) return null;
    
    const data = snapshot.data();
    const today = getTodayDateString();
    
    // Only return if it's set for today
    if (data.date !== today) return null;
    
    return {
      text: data.text ?? "",
      author: data.author ?? "Unknown",
      date: data.date,
      setBy: data.setBy,
    };
  } catch (err) {
    console.warn("Failed to get featured quote", err);
    return null;
  }
}

/**
 * Set a quote as the featured quote for today only.
 * Tomorrow it will automatically revert to the normal rotation.
 */
export async function setFeaturedQuote(
  quote: { text: string; author: string },
  uid?: string
): Promise<boolean> {
  const database = fb.db;
  if (!database) return false;

  try {
    const docRef = doc(database, "settings", "featuredQuote");
    await setDoc(docRef, {
      text: quote.text.trim(),
      author: quote.author.trim() || "Unknown",
      date: getTodayDateString(),
      setBy: uid ?? null,
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (err) {
    console.warn("Failed to set featured quote", err);
    return false;
  }
}

/**
 * Clear the featured quote (revert to normal rotation).
 */
export async function clearFeaturedQuote(): Promise<boolean> {
  const database = fb.db;
  if (!database) return false;

  try {
    const docRef = doc(database, "settings", "featuredQuote");
    await deleteDoc(docRef);
    return true;
  } catch (err) {
    console.warn("Failed to clear featured quote", err);
    return false;
  }
}
