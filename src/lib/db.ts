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
  updateDoc,
  where,
  writeBatch,
  type DocumentReference,
  type Firestore,
} from "firebase/firestore";
import { tryInitFirebase, type FirebaseHandles } from "./firebase";
import { saveProfile as saveProfileLocal } from "./storage";

const LOCAL_UID = "local";

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
export type Team = "JH" | "Varsity";
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

export type Profile = {
  uid: string;
  firstName: string;
  lastName: string;
  unit: Unit;
  team?: Team;
  tm?: { bench?: number; squat?: number; deadlift?: number; press?: number };
  oneRm?: { bench?: number; squat?: number; deadlift?: number; press?: number };
  accessCode?: string | null;
  equipment?: EquipmentSettings;
};

const DEFAULT_PLATES: Record<Unit, number[]> = {
  lb: [55, 45, 35, 25, 10, 5, 2.5, 1.25],
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

const profRef = (database: Firestore, uid: string) =>
  doc(database, "athletes", uid, "profile", "main");

let ensurePromise: Promise<string> | null = null;
let roleCache: string[] | null = null;
let rolePromise: Promise<string[]> | null = null;

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
  return Array.from(
    new Set(
      roles
        .map((r) => (typeof r === "string" ? r.toLowerCase() : ""))
        .filter(Boolean)
    )
  );
};

async function fetchRoles(): Promise<string[]> {
  if (roleCache) return roleCache;
  if (rolePromise) return rolePromise;

  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) {
    roleCache = [];
    return roleCache;
  }

  rolePromise = (async () => {
    try {
      const snap = await getDoc(roleRef(database, uid));
      const roles = snap.exists() ? normalizeRoles(snap.data()) : [];
      roleCache = roles;
      return roles;
    } finally {
      rolePromise = null;
    }
  })();

  return rolePromise;
}

async function setCurrentUserRoles(nextRoles: string[]): Promise<void> {
  const handles = resolveHandles();
  const auth = handles?.auth;
  const database = handles?.db;
  const uid = auth?.currentUser?.uid;
  if (!database || !uid) return;

  const roles = Array.from(
    new Set(nextRoles.map((r) => String(r).toLowerCase()).filter(Boolean))
  );
  const primaryRole = roles.includes("admin")
    ? "admin"
    : roles.includes("coach")
    ? "coach"
    : roles[0] ?? null;

  const payload: Record<string, any> = {
    roles,
    updatedAt: serverTimestamp(),
  };
  if (primaryRole) payload.role = primaryRole;

  await setDoc(roleRef(database, uid), payload, { merge: true });
  roleCache = roles;
}

export async function getUid(): Promise<string | null> {
  const uid = await ensureAnon();
  if (!uid || uid === LOCAL_UID) return null;
  return uid;
}

export async function loadProfileRemote(uid?: string): Promise<Profile | null> {
  const targetUid = uid ?? await getUid();
  if (!targetUid) return null;
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return null;
  const snap = await getDoc(profRef(database, targetUid));
  if (!snap.exists()) return null;
  const data = snap.data() || {};
  return {
    uid: targetUid,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    unit: (data.unit || "lb") as Unit,
    team: data.team as Team | undefined,
    tm: data.tm || {},
    oneRm: data.oneRm || {},
    accessCode: data.accessCode ?? null,
    equipment: normalizeEquipment(data.equipment as EquipmentSettings | undefined),
  };
}

export async function saveProfile(p: Profile, options?: { skipLocal?: boolean }) {
  const handles = resolveHandles();
  const database = handles?.db;
  const normalizedEquipment = normalizeEquipment(p.equipment);
  const normalizedProfile: Profile = {
    ...p,
    oneRm: p.oneRm || {},
    equipment: normalizedEquipment,
  };
  if (!database) {
    if (options?.skipLocal) {
      throw new Error("Firebase is not available to sync this profile right now.");
    }
    saveProfileLocal(normalizedProfile);
    return;
  }
  const ref = profRef(database, p.uid);
  const payload = {
    firstName: normalizedProfile.firstName || "",
    lastName: normalizedProfile.lastName || "",
    unit: normalizedProfile.unit || "lb",
    team: normalizedProfile.team || null,
    tm: normalizedProfile.tm || {},
    oneRm: normalizedProfile.oneRm || {},
    accessCode: normalizedProfile.accessCode ?? null,
    equipment: normalizedEquipment,
  };
  const snap = await getDoc(ref);
  if (snap.exists()) await updateDoc(ref, payload);
  else await setDoc(ref, payload);
  if (!options?.skipLocal) {
    saveProfileLocal(normalizedProfile);
  }
}

export const normalizePasscodeDigits = (code: string): string =>
  code.replace(/\D+/g, "").slice(0, 4);

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
    const canCreate =
      error.code === "auth/user-not-found" || error.code === "auth/invalid-credential";
    if (canCreate) {
      credential = await createUserWithEmailAndPassword(auth, email, password);
      createdAccount = true;
    } else if (error.code === "auth/wrong-password") {
      throw new AthleteAuthError("auth/wrong-password", "Incorrect passcode.");
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

  const codeStatus = await ensureAthleteCode(
    uid,
    code,
    existingProfile?.accessCode ?? null
  );

  if (codeStatus === "taken") {
    if (createdAccount && auth.currentUser) {
      try {
        await auth.currentUser.delete();
      } catch (deleteErr) {
        console.warn("Failed to remove newly created user after code conflict", deleteErr);
      }
    }
    try {
      await auth.signOut();
    } catch (signOutErr) {
      console.warn("Failed to sign out after code conflict", signOutErr);
    }
    throw new AthleteAuthError(
      "athlete-code/taken",
      "That code is already being used by another athlete."
    );
  }

  if (codeStatus === "unavailable") {
    throw new AthleteAuthError(
      "athlete-code/unavailable",
      "We could not verify that code. Try again shortly."
    );
  }

  const resolvedTeam =
    options.team && options.team !== "" ? options.team : existingProfile?.team;
  const profile: Profile = {
    uid,
    firstName: first,
    lastName: last,
    unit: existingProfile?.unit ?? "lb",
    team: resolvedTeam,
    tm: existingProfile?.tm ?? {},
    accessCode: code,
    equipment: normalizeEquipment(existingProfile?.equipment),
  };

  await saveProfile(profile);

  return {
    profile,
    createdAccount,
    credential,
  };
}

// listRoster via collectionGroup("profile")
export type RosterEntry = {
  uid: string;
  firstName?: string;
  lastName?: string;
  unit?: Unit;
  team?: Team;
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

      return {
        uid,
        firstName: data.firstName,
        lastName: data.lastName,
        unit: data.unit as Unit,
        team: data.team as Team,
        accessCode: data.accessCode ?? null,
        roles,
      };
    })
  );

  return rows;
}

// ---- Attendance sheets ----

export type AttendanceLevel = Team;

export type AttendanceAthlete = {
  id: string;
  firstName: string;
  lastName: string;
  level: AttendanceLevel;
};

export type AttendanceSheet = {
  team: Team;
  dates: string[];
  athletes: AttendanceAthlete[];
  records: Record<string, Record<string, boolean>>;
  updatedAt?: number;
};

const ATTENDANCE_STORAGE_PREFIX = "pl.attendance.";

const attendanceStorageKey = (team: Team): string =>
  `${ATTENDANCE_STORAGE_PREFIX}${team}`;

const defaultAttendanceSheet = (team: Team): AttendanceSheet => ({
  team,
  dates: [],
  athletes: [],
  records: {},
  updatedAt: undefined,
});

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

const normalizeAttendanceSheet = (
  input: any,
  team: Team
): AttendanceSheet => {
  const rawDates = Array.isArray(input?.dates) ? input.dates : [];
  const dates = Array.from(
    new Set(
      rawDates
        .map((value) =>
          typeof value === "string" ? value.trim().slice(0, 40) : ""
        )
        .filter((value) => value.length > 0)
    )
  );

  const rawAthletes = Array.isArray(input?.athletes) ? input.athletes : [];
  const athletes: AttendanceAthlete[] = rawAthletes
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id =
        typeof item.id === "string" && item.id.trim()
          ? item.id.trim()
          : null;
      const firstName = sanitizeName((item as any).firstName);
      const lastName = sanitizeName((item as any).lastName);
      const level =
        (item as any).level === "Varsity" ? "Varsity" : "JH";
      if (!id || (!firstName && !lastName)) return null;
      return { id, firstName, lastName, level };
    })
    .filter((item): item is AttendanceAthlete => item !== null);

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

  return {
    team,
    dates,
    athletes,
    records: normalizeAttendanceRecords(
      athletes,
      dates,
      input?.records ?? {}
    ),
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
  sheet: AttendanceSheet
): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;

  const cleanDates = Array.from(
    new Set(sheet.dates.map((value) => value.trim()).filter(Boolean))
  );
  const cleanAthletes = sheet.athletes
    .map((athlete) => ({
      ...athlete,
      firstName: sanitizeName(athlete.firstName),
      lastName: sanitizeName(athlete.lastName),
      level: athlete.level === "Varsity" ? "Varsity" : "JH",
    }))
    .filter((athlete) => athlete.id && (athlete.firstName || athlete.lastName));

  const cleanRecords = normalizeAttendanceRecords(
    cleanAthletes,
    cleanDates,
    sheet.records
  );

  const payload = {
    dates: cleanDates,
    athletes: cleanAthletes,
    records: cleanRecords,
    updatedAt: serverTimestamp(),
  };

  if (database) {
    const ref = attendanceDocRef(database, sheet.team);
    await setDoc(ref, payload, { merge: true });
  }

  writeAttendanceLocal({
    team: sheet.team,
    dates: cleanDates,
    athletes: cleanAthletes,
    records: cleanRecords,
    updatedAt: Date.now(),
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
  roleCache = null;
  rolePromise = null;
}

export async function ensureRole(role: string): Promise<void> {
  const normalized = role.toLowerCase();
  const roles = await fetchRoles();
  if (roles.includes(normalized)) return;
  await setCurrentUserRoles([...roles, normalized]);
}

export async function ensureCoachRole(): Promise<void> {
  await ensureRole("coach");
}

type Lift = "bench" | "squat" | "deadlift" | "press";
type Week = 1 | 2 | 3 | 4;

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
  return {
    lift: raw.lift,
    week: raw.week,
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
  };
};

export async function saveSession(
  payload: SessionPayload,
  targetUid?: string
): Promise<{ source: "remote" | "local" }> {
  const base = normalizeSession(payload, {
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
      ...payload,
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
    persistLocalSession({ ...base, uid: uid ?? LOCAL_UID });
    return { source: "local" };
  }

  const col = collection(database, "athletes", uid, "sessions");
  await addDoc(col, {
    ...payload,
    createdAt: serverTimestamp(),
  });

  return { source: "remote" };
}

export async function recentSessions(
  lift: Lift,
  count = 10,
  targetUid?: string
): Promise<SessionRecord[]> {
  const handles = resolveHandles();
  const database = handles?.db;

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
        .filter((s) => s.lift === lift);
      return remote.slice(0, count);
    } catch (err) {
      console.warn("recentSessions coach query failed", err);
      return [];
    }
  }

  const local = readLocalSessions().filter((s) => s.lift === lift);
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
      .filter((s) => s.lift === lift);

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
  targetUid?: string
): Promise<number> {
  const rows = await recentSessions(lift, sample, targetUid);
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
      if (existing.exists()) {
        const owner = existing.data()?.uid;
        if (owner && owner !== uid) {
          throw new Error("TAKEN");
        }
      }

      tx.set(newRef, { uid, updatedAt: serverTimestamp() });

      if (prevRef) {
        const prevSnap = await tx.get(prevRef);
        if (prevSnap.exists()) {
          const owner = prevSnap.data()?.uid;
          if (owner === uid) {
            tx.delete(prevRef);
          }
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

export async function assignAthleteAccessCode(
  targetUid: string,
  code: string
): Promise<{ status: AthleteCodeStatus; code: string }> {
  const trimmed = (code ?? "").trim();
  if (!/^\d{4}$/.test(trimmed)) {
    return { status: "unavailable", code: trimmed };
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

  const status = await ensureAthleteCode(targetUid, trimmed, profile.accessCode ?? null);
  if (status !== "ok") {
    return { status, code: trimmed };
  }

  const normalized: Profile = {
    ...profile,
    accessCode: trimmed,
    tm: profile.tm ?? {},
    oneRm: profile.oneRm ?? {},
    equipment: profile.equipment ?? defaultEquipment(),
  };
  await saveProfile(normalized);
  return { status: "ok", code: trimmed };
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

export async function deleteAthlete(uid: string): Promise<void> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    throw new Error("Firebase is required to delete athletes.");
  }

  const profile = await loadProfileRemote(uid);
  const sessionsCol = collection(database, "athletes", uid, "sessions");
  let sessionRefs: DocumentReference[] = [];

  try {
    const snap = await getDocs(sessionsCol);
    sessionRefs = snap.docs.map((docSnap) => docSnap.ref);
  } catch (err) {
    console.warn("Failed to list sessions before deleting athlete", err);
  }

  if (sessionRefs.length) {
    const chunkSize = 400;
    for (let i = 0; i < sessionRefs.length; i += chunkSize) {
      const batch = writeBatch(database);
      sessionRefs.slice(i, i + chunkSize).forEach((ref) => batch.delete(ref));
      await batch.commit();
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
    }
  }

  const cleanupBatch = writeBatch(database);
  cleanupBatch.delete(profRef(database, uid));
  accessCodes.forEach((code) =>
    cleanupBatch.delete(doc(database, "athleteCodes", code))
  );

  await cleanupBatch.commit();
}

export async function fetchAthleteSessions(
  uid: string,
  count = 12
): Promise<SessionRecord[]> {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) return [];
  try {
    const col = collection(database, "athletes", uid, "sessions");
    const snap = await getDocs(
      query(col, orderBy("createdAt", "desc"), limit(Math.max(count, 1)))
    );
    return snap.docs.map((docSnap) =>
      normalizeSession(docSnap.data(), {
        id: docSnap.id,
        uid,
        source: "remote",
      })
    );
  } catch (err) {
    console.warn(`fetchAthleteSessions failed for ${uid}`, err);
    return [];
  }
}
