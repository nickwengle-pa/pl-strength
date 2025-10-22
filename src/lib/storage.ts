const KEY = 'pl.profile.v1';

export function loadProfile(): any|null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveProfile(p: any) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}
