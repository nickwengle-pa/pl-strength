import React, { useEffect, useState } from "react";
import { listRoster } from "../lib/db";

type Row = { uid:string; firstName?:string; lastName?:string; unit?:'lb'|'kg'; team?:'JH'|'Varsity' };

export default function Roster() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string|undefined>();

  useEffect(() => {
    (async () => {
      try { setRows(await listRoster()); }
      catch (e:any) { setErr(e?.message || String(e)); }
    })();
  }, []);

  if (err) {
    return (
      <div className="container py-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-2">Roster</h3>
          <div className="text-sm text-red-700">Error: {err}</div>
          <p className="text-sm mt-2">
            If this says “Missing or insufficient permissions”, create Firestore <code>{'roles/{uid}'}</code> with <code>{"{ role: \"coach\" }"}</code>, then publish rules.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6">
      <div className="card">
        <h3 className="text-lg font-semibold mb-2">Roster</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">First</th>
                <th className="p-2 text-left">Last</th>
                <th className="p-2 text-left">Team</th>
                <th className="p-2 text-left">Unit</th>
                <th className="p-2 text-left">UID</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.uid} className="border-t">
                  <td className="p-2">{r.firstName || "—"}</td>
                  <td className="p-2">{r.lastName || "—"}</td>
                  <td className="p-2">{r.team || "—"}</td>
                  <td className="p-2">{r.unit || "—"}</td>
                  <td className="p-2 text-xs">{r.uid}</td>
                </tr>
              ))}
              {rows.length===0 && (
                <tr><td className="p-2 text-gray-500" colSpan={5}>No athletes yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
