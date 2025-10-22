import React, { useEffect, useState } from "react";
import { listRoster } from "../lib/db";

type Row = { uid:string; firstName?:string; lastName?:string; unit?:'lb'|'kg' };

export default function Roster() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string|undefined>();

  useEffect(() => {
    (async () => {
      try {
        const data = await listRoster();
        setRows(data);
      } catch (e:any) {
        setErr(e?.message || String(e));
      }
    })();
  }, []);

  if (err) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-2">Roster</h3>
        <div className="text-sm text-red-700">Error: {err}</div>
        <p className="text-sm mt-2">
          If this says “Missing or insufficient permissions”, ensure your account has coach role:
          create <code>{'roles/{uid}'}</code> with <code>{"{ role: \"coach\" }"}</code>, then publish rules.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-2">Roster</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-2 text-left">UID</th>
              <th className="p-2 text-left">First</th>
              <th className="p-2 text-left">Last</th>
              <th className="p-2 text-left">Unit</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.uid} className="border-t">
                <td className="p-2 text-xs">{r.uid}</td>
                <td className="p-2">{r.firstName || "—"}</td>
                <td className="p-2">{r.lastName || "—"}</td>
                <td className="p-2">{r.unit || "—"}</td>
              </tr>
            ))}
            {rows.length===0 && (
              <tr><td className="p-2 text-gray-500" colSpan={4}>No athletes yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
