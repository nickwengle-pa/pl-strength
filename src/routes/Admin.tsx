import React from "react";
import { fb } from "../lib/db";

export default function Admin() {
  const uid = fb.auth.currentUser?.uid || "—";
  return (
    <div className="card space-y-3">
      <h3 className="text-lg font-semibold">Admin</h3>
      <p className="text-sm">Current UID: <code>{uid}</code></p>
      <div className="text-sm">
        <div className="font-medium mb-1">Make this user a coach</div>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Copy the UID above.</li>
          <li>Create Firestore document <code>{'roles/{uid}'}</code> with data <code>{"{ role: \"coach\" }"}</code>.</li>
          <li>Reload this page to see coach-only routes.</li>
        </ol>
      </div>
    </div>
  );
}
