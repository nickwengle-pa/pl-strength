import React, { useEffect, useState } from "react";
import { loadProfileRemote } from "../lib/db";
import { loadProfile } from "../lib/storage";

export default function Profile() {
  const [p, setP] = useState<any|null>(null);

  useEffect(() => {
    (async () => {
      const remote = await loadProfileRemote();
      setP(remote || loadProfile());
    })();
  }, []);

  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-2">Profile</h3>
      {!p ? (
        <div className="text-sm text-gray-600">No profile saved yet.</div>
      ) : (
        <pre className="text-xs bg-gray-50 p-3 rounded-xl border overflow-x-auto">{JSON.stringify(p, null, 2)}</pre>
      )}
    </div>
  );
}
