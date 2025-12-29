
import { loadProfile } from '../lib/storage';

export default function QuickSummary() {
  const p = loadProfile();
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Quick Summary</h3>
      <p className="text-sm">This Page Will Show “What To Do Today” Once Cycles And Sessions Are Added. For Now, Set Your Training Maxes In The Calculator, Then Return Here.</p>
      <ul className="list-disc pl-5 text-sm">
        <li>Warm‑ups First: 40%, 50%, 60% × 5/5/3</li>
        <li>Three Work Sets Based On Your Week</li>
        <li>Last Set = AMRAP (Don’t Hit Failure—Save 1–2 Reps)</li>
        <li>Record Reps; We’ll Estimate 1RM And Track PRs</li>
      </ul>
      <div className="text-sm text-gray-600">Athlete: <b>{p?.firstName || '—'}</b></div>
    </div>
  );
}
