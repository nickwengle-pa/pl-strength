import { fb, getUid } from './db';
import { collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { weekPercents, warmupPercents, roundToPlate } from './tm';

export type PlanRow = {
  kind: 'warmup'|'work';
  pct: number;
  weight: number;
  targetReps: number;
  actualReps?: number;
  note?: string;
};

export type PlanSheet = {
  lift: 'bench'|'squat'|'deadlift'|'press';
  week: 1|2|3|4;
  unit: 'lb'|'kg';
  tm: number;
  rows: PlanRow[];
  createdAt?: any;
};

export function buildPlan(lift: PlanSheet['lift'], week: PlanSheet['week'], unit: PlanSheet['unit'], tm: number): PlanRow[] {
  const step = unit === 'lb' ? 5 : 2.5;
  const warm = warmupPercents().map((p,i)=>({ kind:'warmup' as const, pct:p, weight: roundToPlate(tm*p, unit, step), targetReps: i<2?5:3 }));
  const workP = weekPercents(week);
  const repScheme = week===1?[5,5,5]:week===2?[3,3,3]:week===3?[5,3,1]:[5,5,5];
  const work = workP.map((p,i)=>({ kind:'work' as const, pct:p, weight: roundToPlate(tm*p, unit, step), targetReps: repScheme[i] }));
  return [...warm, ...work];
}

export async function savePlan(sheet: PlanSheet) {
  const uid = await getUid();
  const db = fb?.db;
  if (!uid || !db) return null;
  const col = collection(db, 'athletes', uid, 'plans');
  const docRef = await addDoc(col, { ...sheet, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function recentPlans(n: number = 10): Promise<PlanSheet[]> {
  const uid = await getUid();
  const db = fb?.db;
  if (!uid || !db) return [];
  const col = collection(db, 'athletes', uid, 'plans');
  const qRef = query(col, orderBy('createdAt', 'desc'), limit(n));
  const snap = await getDocs(qRef);
  const out: PlanSheet[] = [];
  snap.forEach(d => out.push(d.data() as PlanSheet));
  return out;
}
