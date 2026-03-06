import React, { useEffect, useState } from "react";
import {
  getCurrentRoles,
  hasFirebase,
  isAdmin,
  isCoach,
  subscribeToRoleChanges,
  getAccessHistory,
  clearAccessHistory,
  formatTeamLabel,
  type AccessHistory,
} from "../lib/db";
import { useAuth } from "../lib/auth";
import { ConfirmModal } from "../components/ConfirmModal";

export default function Admin() {
  const configured = hasFirebase();
  const { user } = useAuth();
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);

  const uid = user?.uid ?? "unknown";
  const [roles, setRoles] = useState<string[]>([]);
  const [coach, setCoach] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accessHistory, setAccessHistory] = useState<AccessHistory[]>([]);

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

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((nextRoles) => {
      setRoles(nextRoles);
      const adminFlag = nextRoles.includes("admin");
      setAdmin(adminFlag);
      setCoach(adminFlag || nextRoles.includes("coach"));
    });
    return unsubscribe;
  }, []);

  // Load access history
  useEffect(() => {
    let active = true;
    if (!user) {
      setAccessHistory([]);
      return;
    }

    (async () => {
      try {
        const history = await getAccessHistory();
        if (active) setAccessHistory(history);
      } catch (err) {
        console.warn("Failed to load access history", err);
        if (active) setAccessHistory([]);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  return (
    <div className="card space-y-4 p-4 sm:space-y-5 sm:p-6">
      <ConfirmModal
        isOpen={clearHistoryConfirm}
        title="Clear Access History"
        message={`Clear all ${accessHistory.length} access history entries? This cannot be undone.`}
        confirmLabel="Clear All"
        onConfirm={async () => {
          setClearHistoryConfirm(false);
          await clearAccessHistory();
          setAccessHistory([]);
        }}
        onCancel={() => setClearHistoryConfirm(false)}
        variant="danger"
      />
      <div className="space-y-1">
        <h3 className="text-xl font-semibold">Team Admin</h3>
        <p className="text-sm text-gray-600">
          Quick Status Of Your Account And Instructions For Managing Coach Access.
        </p>
      </div>

      {!configured && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Firebase Isn't Configured. Set Env Vars Or window.__FBCONFIG__ And Reload.
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
        Signed-In User UID: <code className="break-all">{uid}</code>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 space-y-2">
        <div className="font-medium text-gray-700">Current Roles</div>
        {loading ? (
          <div>Loading</div>
        ) : roles.length ? (
          <ul className="list-disc pl-5 space-y-1">
            {roles.map((role) => (
              <li key={role}>{role}</li>
            ))}
          </ul>
        ) : (
          <div>No Roles Assigned Yet.</div>
        )}
        <div className="text-xs text-gray-500">
          Coaches Automatically Get The <code>coach</code> Role When They Sign In With The Shared Passcode.
          Admins Have Both <code>admin</code> And <code>coach</code>.
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="font-medium text-gray-700">Access History</div>
          {accessHistory.length > 0 && (
            <button
              onClick={() => setClearHistoryConfirm(true)}
              className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 transition hover:bg-red-50 hover:text-red-700"
            >
              Clear History
            </button>
          )}
        </div>
        <div className="space-y-3">
          {accessHistory.map((entry) => (
            <div key={entry.code} className="rounded-xl border border-gray-200 bg-white p-3 space-y-1">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-gray-900">
                  {entry.code === "1357" ? "Admin Access" : "Coach Access"}
                </span>
                <span className="text-xs text-gray-500">
                  Last Used: {new Date(entry.lastUsed.toMillis()).toLocaleDateString()}
                </span>
              </div>
              <div className="text-xs text-gray-600">
                Roles: {entry.roles.join(", ")}
              </div>
              {entry.teamScopes.length > 0 && (
                <div className="text-xs text-gray-600">
                  Team Scopes: {entry.teamScopes.map(team => formatTeamLabel(team)).join(", ")}
                </div>
              )}
            </div>
          ))}
          {!accessHistory.length && (
            <div className="text-gray-500">No Access History Found.</div>
          )}
        </div>
      </div>

      {admin ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          You Have Admin Rights. If You Need To Elevate Another Adult To Admin, Add Their UID To Firestore At{" "}
          <code>{"roles/{uid}"}</code> With <code>{"{ roles: [\"admin\",\"coach\"] }"}</code>.
        </div>
      ) : coach ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
          You Have Coach Access. Reach Out To An Admin If You Need Higher Privileges.
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          You're Currently In Athlete Mode. Have An Admin Share The Coach Passcode So You Can Log In Via The Coach Tab.
        </div>
      )}
    </div>
  );
}






