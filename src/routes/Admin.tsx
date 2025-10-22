import { useEffect, useState } from 'react';
import { fb, initAuth } from '../lib/auth';

export default function Admin() {
  const [uid, setUid] = useState<string | null>(null);

  useEffect(() => {
    initAuth().then(() => {
      setUid(fb?.auth.currentUser?.uid ?? null);
    });
  }, []);

  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Admin</h3>
      <p className="text-sm">Use this page to mark your account as a coach.</p>

      <div className="p-3 bg-gray-50 rounded-xl border">
        <div className="text-sm">Current UID:</div>
        <div className="font-mono text-sm break-all">{uid || '— not signed in —'}</div>
      </div>

      <ol className="list-decimal pl-5 text-sm space-y-1">
        <li>Copy the UID above.</li>
        <li>
          In Firestore, create a doc at <code>roles/&lbrace;yourUID&rbrace;</code> with:
          <code> &lbrace; role: "coach" &rbrace;</code>
        </li>
        <li>Reload this page; you’ll have coach access per the rules.</li>
      </ol>
    </div>
  );
}
