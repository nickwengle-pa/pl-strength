export function warmupPercents(): number[] {
  return [0.40, 0.50, 0.60];
}
export function weekPercents(week: 1|2|3|4): number[] {
  if (week === 1) return [0.65, 0.75, 0.85];
  if (week === 2) return [0.70, 0.80, 0.90];
  if (week === 3) return [0.75, 0.85, 0.95];
  return [0.40, 0.50, 0.60];
}
export function estimate1RM(weight: number, reps: number): number {
  return weight * (1 + 0.0333 * reps);
}
export function roundToPlate(x:number, unit:'lb'|'kg', step:number): number {
  const s = step || (unit === 'lb' ? 5 : 2.5);
  return Math.round(x / s) * s;
}
