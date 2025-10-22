
import { loadProfile } from '../lib/storage';

export default function QuickSummary() {
  const p = loadProfile();
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Quick Summary</h3>
      <p className="text-sm">This page will show “What to do today” once cycles and sessions are added. For now, set your Training Maxes in the Calculator, then return here.</p>
      <ul className="list-disc pl-5 text-sm">
        <li>Warm‑ups first: 40%, 50%, 60% × 5/5/3</li>
        <li>Three work sets based on your week</li>
        <li>Last set = AMRAP (don’t hit failure—save 1–2 reps)</li>
        <li>Record reps; we’ll estimate 1RM and track PRs</li>
      </ul>
      <div className="text-sm text-gray-600">Athlete: <b>{p?.firstName || '—'}</b></div>
    </div>
  );
}
