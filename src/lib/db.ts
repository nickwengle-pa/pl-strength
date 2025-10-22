import { app, auth, db } from '../firebase';
import {
  addDoc, collection, doc, getDoc, getDocs,
  limit, orderBy, query, serverTimestamp
} from 'firebase/firestore';

export const fb = { app, auth, db };

export async function getUid(): Promise<string|null> {
  return auth.currentUser?.uid ?? null;
}

export async function loadProfileRemote(): Promise<any|null> {
  const uid = await getUid();
  if (!uid) return null;
  const snap = await getDoc(doc(db, 'athletes', uid, 'profile', 'meta'));
  return snap.exists() ? snap.data() : null;
}

type Warm = { pct:number; weight:number; reps:number };
type Work = { pct:number; weight:number; reps:number };
type Amrap = { weight:number; reps:number };

export async function saveSession(data: {
  lift: 'bench'|'squat'|'deadlift'|'press';
  week: 1|2|3|4;
  unit: 'lb'|'kg';
  tm: number;
  warmups: Warm[];
  work: Work[];
  amrap?: Amrap;
  est1rm?: number;
  note?: string;
  pr?: boolean;
}) {
  const uid = await getUid();
  if (!uid) return null;
  const col = collection(db, 'athletes', uid, 'sessions');
  const payload = { ...data, createdAt: serverTimestamp() };
  return await addDoc(col, payload);
}

export async function recentSessions(lift: 'bench'|'squat'|'deadlift'|'press', n:number=12): Promise<any[]> {
  const uid = await getUid();
  if (!uid) return [];
  const col = collection(db, 'athletes', uid, 'sessions');
  const qRef = query(col, orderBy('createdAt', 'desc'), limit(n*3));
  const snap = await getDocs(qRef);
  const rows: any[] = [];
  snap.forEach(d => rows.push({ id:d.id, ...d.data() }));
  return rows.filter(r => r.lift === lift).slice(0, n);
}

export async function bestEst1RM(lift: 'bench'|'squat'|'deadlift'|'press', lookback:number=30): Promise<number> {
  const rows = await recentSessions(lift, lookback);
  let best = 0;
  for (const r of rows) {
    if (typeof r.est1rm === 'number' && r.est1rm > best) best = r.est1rm;
  }
  return best;
}

export async function listRoster(): Promise<Array<{uid:string; firstName?:string; lastName?:string; unit?:'lb'|'kg'}>> {
  const cgRef = (await import('firebase/firestore')).collectionGroup(db, 'profile');
  const snap = await getDocs(cgRef);
  const out: Array<{uid:string; firstName?:string; lastName?:string; unit?:'lb'|'kg'}> = [];
  snap.forEach(d => {
    const path = d.ref.path; // "athletes/{uid}/profile/meta"
    const parts = path.split('/');
    const uid = parts.length >= 2 ? parts[1] : 'unknown';
    const data = d.data() as any;
    if (parts[3] !== 'meta') return;
    out.push({
      uid,
      firstName: data.firstName,
      lastName: data.lastName,
      unit: data.unit
    });
  });
  const seen = new Set<string>();
  return out.filter(r => {
    if (seen.has(r.uid)) return false;
    seen.add(r.uid);
    return true;
  });
}
