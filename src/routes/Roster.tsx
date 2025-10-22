
import { useEffect, useState } from 'react';
import { listRoster } from '../lib/db';

type Row = { uid: string, firstName: string, unit: 'lb'|'kg' };

export default function Roster() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listRoster().then(setRows).catch((e)=>{
      console.error(e);
      setError('Permission denied (are you marked as coach?) or rules missing profile read.');
    });
  }, []);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-3">Coach Roster (read-only)</h3>
      {error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-2 mb-3">{error}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2 pr-3">First Name</th>
              <th className="py-2 pr-3">UID</th>
              <th className="py-2">Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.uid} className="border-b last:border-0">
                <td className="py-2 pr-3">{r.firstName}</td>
                <td className="py-2 pr-3 font-mono text-[11px] break-all">{r.uid}</td>
                <td className="py-2">{r.unit}</td>
              </tr>
            ))}
            {rows.length===0 && !error && <tr><td className="py-2 text-gray-500" colSpan={3}>No athletes found yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
