import React, { useEffect, useState } from "react";
import {
  getCurrentRoles,
  hasFirebase,
  isAdmin,
  isCoach,
} from "../lib/db";
import { useAuth } from "../lib/auth";

export default function Admin() {
  const configured = hasFirebase();
  const { user } = useAuth();

  const uid = user?.uid ?? "unknown";
  const [roles, setRoles] = useState<string[]>([]);
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!user) {
      setRoles([]);
      setCoach(false);
      setAdmin(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const [roleList, coachFlag, adminFlag] = await Promise.all([
          getCurrentRoles(),
          isCoach(),
          isAdmin(),
        ]);
        if (!active) return;
        setRoles(roleList);
        setCoach(coachFlag);
        setAdmin(adminFlag);
      } catch (err) {
        if (!active) return;
        console.warn("Failed to load role details", err);
        setRoles([]);
        setCoach(false);
        setAdmin(false);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div className="card space-y-5">
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">Team Admin</h3>
        <p className="text-sm text-gray-600">
          Quick status of your account and instructions for managing coach access.
        </p>
      </div>

      {!configured && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Firebase isn't configured. Set env vars or window.__FBCONFIG__ and reload.
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Signed-in user UID: <code>{uid}</code>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 space-y-2">
        <div className="font-medium text-gray-700">Current roles</div>
        {loading ? (
          <div>loading</div>
        ) : roles.length ? (
          <ul className="list-disc pl-5 space-y-1">
            {roles.map((role) => (
              <li key={role}>{role}</li>
            ))}
          </ul>
        ) : (
          <div>No roles assigned yet.</div>
        )}
        <div className="text-xs text-gray-500">
          Coaches automatically get the <code>coach</code> role when they sign in with the shared passcode.
          Admins have both <code>admin</code> and <code>coach</code>.
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-2 text-sm text-gray-600">
        <h4 className="text-lg font-semibold text-gray-800">How coach access works</h4>
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            Share the team email format with adults (e.g., <code>firstname.lastname@pl.strength</code>) and the coach
            passcode you've set in <code>.env</code> (<code>VITE_COACH_PASSCODE</code>).
          </li>
          <li>
            When they sign in on the Coach tab using that passcode, the app creates their account (if needed) and gives
            them the <code>coach</code> role automatically.
          </li>
          <li>
            To rotate the passcode, update <code>VITE_COACH_PASSCODE</code> and redeploy the app, then share the new
            value.
          </li>
        </ol>
      </div>

      {admin ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          You have admin rights. If you need to elevate another adult to admin, add their UID to Firestore at{" "}
          <code>{"roles/{uid}"}</code> with <code>{"{ roles: [\"admin\",\"coach\"] }"}</code>.
        </div>
      ) : coach ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          You have coach access. Reach out to an admin if you need higher privileges.
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          You're currently in athlete mode. Have an admin share the coach passcode so you can log in via the Coach tab.
        </div>
      )}
    </div>
  );
}










