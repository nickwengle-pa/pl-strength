import {
  onAuthStateChanged,
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
  serverTimestamp,
  setDoc,
  updateDoc,
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
export type Profile = {
  uid: string;
  firstName: string;
  lastName: string;
  unit: Unit;
  team?: Team;
  tm?: { bench?: number; squat?: number; deadlift?: number; press?: number };
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
  const roles: string[] = Array.isArray(raw.roles)
    ? raw.roles
    : raw.role
    ? [raw.role]
    : [];
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
  };
}

export async function saveProfile(p: Profile) {
  const handles = resolveHandles();
  const database = handles?.db;
  if (!database) {
    saveProfileLocal(p);
    return;
  }
  const ref = profRef(database, p.uid);
  const payload = {
    firstName: p.firstName || "",
    lastName: p.lastName || "",
    unit: p.unit || "lb",
    team: p.team || null,
    tm: p.tm || {},
  };
  const snap = await getDoc(ref);
  if (snap.exists()) await updateDoc(ref, payload);
  else await setDoc(ref, payload);
}

// listRoster via collectionGroup("profile")
export async function listRoster(): Promise<
  Array<{ uid: string; firstName?: string; lastName?: string; unit?: Unit; team?: Team }>
> {
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
  return snap.docs.map((d) => {
    const data = d.data();
    const parts = d.ref.path.split("/");
    const uid = parts[1] || data.uid;
    return {
      uid,
      firstName: data.firstName,
      lastName: data.lastName,
      unit: data.unit as Unit,
      team: data.team as Team,
    };
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

export type SessionSet = { pct: number; weight: number; reps: number };
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
    warmups: raw.warmups || [],
    work: raw.work || [],
    amrap: raw.amrap || { weight: 0, reps: 0 },
    est1rm: raw.est1rm ?? 0,
    note: raw.note || "",
    pr: !!raw.pr,
    createdAt,
    ...overrides,
  };
};

export async function saveSession(
  payload: SessionPayload
): Promise<{ source: "remote" | "local" }> {
  const base = normalizeSession(payload, {
    createdAt: Date.now(),
    source: "local",
  });

  let uid: string | null = null;
  try {
    uid = await getUid();
  } catch (err) {
    console.warn("saveSession getUid failed", err);
  }

  const handles = resolveHandles();
  const database = handles?.db;

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
  count = 10
): Promise<SessionRecord[]> {
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

  const handles = resolveHandles();
  const database = handles?.db;
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
  sample = 10
): Promise<number> {
  const rows = await recentSessions(lift, sample);
  const ests = rows
    .map((r) => (typeof r.est1rm === "number" ? r.est1rm : Number(r.est1rm)))
    .filter((v): v is number => typeof v === "number" && !isNaN(v));
  if (!ests.length) return 0;
  return Math.max(...ests);
}
