import { tryInitFirebase } from './firebase';
import {
  doc, getDoc, setDoc, serverTimestamp,
  collection, addDoc, query, orderBy, limit, getDocs
} from 'firebase/firestore';
import type { Profile } from './storage';

export const fb = tryInitFirebase();

export async function getUid(): Promise<string | null> {
  if (!fb) return null;
  const u = fb.auth.currentUser;
  return u?.uid ?? null;
}

// ------- Profile (remote) -------
export async function saveProfileRemote(p: Profile) {
  if (!fb) return false;
  const uid = await getUid();
  if (!uid) return false;
  const profileRef = doc(fb.db, 'athletes', uid, 'profile', 'meta');
  await setDoc(profileRef, {
    firstName: p.firstName,
    unit: p.unit,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  if (p.tm) {
    const tmRef = doc(fb.db, 'athletes', uid, 'profile', 'tm');
    await setDoc(tmRef, { ...p.tm, updatedAt: serverTimestamp() }, { merge: true });
  }
  return true;
}

export async function loadProfileRemote(): Promise<Profile | null> {
  if (!fb) return null;
  const uid = await getUid();
  if (!uid) return null;
  const metaRef = doc(fb.db, 'athletes', uid, 'profile', 'meta');
  const tmRef = doc(fb.db, 'athletes', uid, 'profile', 'tm');
  const [mSnap, tSnap] = await Promise.all([getDoc(metaRef), getDoc(tmRef)]);
  if (!mSnap.exists()) return null;
  const meta = mSnap.data() as any;
  const tm = tSnap.exists() ? (tSnap.data() as any) : {};
  return { firstName: meta.firstName || 'Athlete', unit: meta.unit || 'lb', tm: {
    bench: tm.bench, squat: tm.squat, deadlift: tm.deadlift, press: tm.press
  }};
}

// ------- Coach Roster -------
import { collectionGroup } from 'firebase/firestore';
export async function listRoster(): Promise<Array<{uid:string, firstName:string, unit:'lb'|'kg'}>> {
  if (!fb) return [];
  const snaps = await getDocs(collectionGroup(fb.db, 'profile'));
  const rows: Array<{uid:string, firstName:string, unit:'lb'|'kg'}> = [];
  snaps.forEach(s => {
    if (s.id === 'meta') {
      const data = s.data() as any;
      const uid = s.ref.parent?.parent?.id || 'unknown';
      rows.push({
        uid,
        firstName: (data.firstName || 'Athlete') as string,
        unit: (data.unit || 'lb') as 'lb'|'kg'
      });
    }
  });
  rows.sort((a,b)=>a.firstName.localeCompare(b.firstName));
  return rows;
}

// ------- Sessions -------
export type SessionDoc = {
  createdAt?: any; // serverTimestamp
  lift: 'bench'|'squat'|'deadlift'|'press';
  week: 1|2|3|4;
  unit: 'lb'|'kg';
  tm: number;
  warmups: Array<{ pct: number; weight: number; reps: number }>;
  work: Array<{ pct: number; weight: number; reps: number }>;
  amrap: { weight: number; reps: number };
  est1rm: number;
  note?: string;
  pr?: boolean;
};

export async function saveSession(docData: SessionDoc) {
  if (!fb) return null;
  const uid = await getUid();
  if (!uid) return null;
  const col = collection(fb.db, 'athletes', uid, 'sessions');
  const res = await addDoc(col, { ...docData, createdAt: serverTimestamp() });
  return res.id;
}

// No composite index required: always order by createdAt and filter in memory
export async function recentSessions(lift: SessionDoc['lift']|null, n: number = 10): Promise<SessionDoc[]> {
  if (!fb) return [];
  const uid = await getUid();
  if (!uid) return [];
  const col = collection(fb.db, 'athletes', uid, 'sessions');
  const qRef = query(col, orderBy('createdAt', 'desc'), limit(50));
  const snap = await getDocs(qRef);
  let rows: SessionDoc[] = [];
  snap.forEach(d => rows.push(d.data() as SessionDoc));
  if (lift) rows = rows.filter(r => r.lift === lift);
  return rows.slice(0, n);
}

export async function bestEst1RM(lift: SessionDoc['lift'], n: number = 50): Promise<number> {
  const rows = await recentSessions(lift, n);
  let best = 0;
  for (const r of rows) best = Math.max(best, r.est1rm || 0);
  return best;
}
