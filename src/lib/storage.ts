
// Lightweight local storage until Firebase keys are configured.
export type Profile = {
  firstName: string;
  unit: 'lb'|'kg';
  tm: { bench?: number; squat?: number; deadlift?: number; press?: number };
};

const KEY = 'pl-strength/profile';

export function saveProfile(p: Profile) {
  localStorage.setItem(KEY, JSON.stringify(p));
}

export function loadProfile(): Profile | null {
  const v = localStorage.getItem(KEY);
  return v ? JSON.parse(v) as Profile : null;
}
