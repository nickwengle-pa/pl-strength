const KEY = 'pl.profile.v1';

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
