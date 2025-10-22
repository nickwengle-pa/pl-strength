
export type Lift = 'bench' | 'squat' | 'deadlift' | 'press';

export function estimate1RM(weight: number, reps: number) {
  return +(weight * reps * 0.0333 + weight).toFixed(1);
}

export function trainingMax(oneRM: number) {
  return Math.round(oneRM * 0.90);
}

export function weekPercents(week: 1|2|3|4) {
  if (week === 1) return [0.65, 0.75, 0.85];
  if (week === 2) return [0.70, 0.80, 0.90];
  if (week === 3) return [0.75, 0.85, 0.95];
  return [0.40, 0.50, 0.60]; // deload
}

export function warmupPercents() {
  return [0.40, 0.50, 0.60];
}

export function roundToPlate(weight: number, unit: 'lb'|'kg', step: number) {
  const s = step || (unit === 'lb' ? 5 : 2.5);
  return Math.round(weight / s) * s;
}
