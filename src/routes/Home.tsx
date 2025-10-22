
import Tile from '../components/Tile';
import { loadProfile } from '../lib/storage';

export default function Home() {
  const p = loadProfile();
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Hi {p?.firstName || 'Athlete'}</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <Tile to="/session" title="Train Today">
          Warm-ups, work sets, and AMRAP logging with PR tracking.
        </Tile>
        <Tile to="/summary" title="Quick Summary">
          See what to do this week and today based on your Training Max.
        </Tile>
        <Tile to="/calculator" title="Calculator / Table">
          Auto-calc warm-ups and work sets with plate rounding.
        </Tile>
        <Tile to="/sheets" title="Printable / Fillable Sheets">
          Week 1–4 logs: print or fill on device and save.
        </Tile>
      </div>
    </div>
  );
}
