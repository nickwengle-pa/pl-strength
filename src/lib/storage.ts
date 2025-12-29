const KEY = 'pl.profile.v1';

const LIFT_KEYS = ["bench", "squat", "deadlift"] as const;

const normalizeLiftWeekMap = (value: any): Record<string, 1 | 2 | 3> => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: Record<string, 1 | 2 | 3> = {};
  LIFT_KEYS.forEach((lift) => {
    const parsed = Number(source[lift]);
    if (parsed === 1 || parsed === 2 || parsed === 3) {
      next[lift] = parsed;
    }
  });
  return next;
};

const normalizeLiftCycleMap = (value: any): Record<string, number> => {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const next: Record<string, number> = {};
  LIFT_KEYS.forEach((lift) => {
    const parsed = Number(source[lift]);
    if (Number.isFinite(parsed) && parsed >= 1) {
      next[lift] = Math.floor(parsed);
    }
  });
  return next;
};

export function loadProfile(): any|null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const week = Number((parsed as any).currentWeek);
      if (week === 1 || week === 2 || week === 3) {
        (parsed as any).currentWeek = week;
      } else {
        delete (parsed as any).currentWeek;
      }
      const cycle = Number((parsed as any).currentCycle);
      if (Number.isFinite(cycle) && cycle >= 1) {
        (parsed as any).currentCycle = Math.floor(cycle);
      } else {
        delete (parsed as any).currentCycle;
      }
      const liftWeeks = normalizeLiftWeekMap((parsed as any).liftWeeks);
      if (Object.keys(liftWeeks).length > 0) {
        (parsed as any).liftWeeks = liftWeeks;
      } else {
        delete (parsed as any).liftWeeks;
      }
      const liftCycles = normalizeLiftCycleMap((parsed as any).liftCycles);
      if (Object.keys(liftCycles).length > 0) {
        (parsed as any).liftCycles = liftCycles;
      } else {
        delete (parsed as any).liftCycles;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveProfile(p: any) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
