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

export default function AdminV2() {
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

  const SectionCard: React.FC<{
    eyebrow: string;
    title?: string;
    action?: React.ReactNode;
    children: React.ReactNode;
  }> = ({ eyebrow, title, action, children }) => (
    <section className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-1">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-v2-surface-800 px-5 py-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="h-px w-5 bg-v2-warn-600" />
            <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-warn-300">
              {eyebrow}
            </span>
          </div>
          {title && (
            <h3 className="font-v2-heading text-lg uppercase tracking-tight text-v2-ink-50">
              {title}
            </h3>
          )}
        </div>
        {action}
      </header>
      <div className="px-5 py-4 font-v2-body text-sm text-v2-ink-300">
        {children}
      </div>
    </section>
  );

  return (
    <div className="min-h-screen bg-v2-surface-950">
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

      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        {/* Page header */}
        <header className="space-y-3 border-b border-v2-surface-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-px w-5 bg-v2-warn-600" />
            <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-warn-300">
              Privileged Surface
            </span>
          </div>
          <h1 className="font-v2-heading text-3xl uppercase tracking-tight text-v2-ink-50">
            Team Admin
          </h1>
          <p className="font-v2-body text-sm text-v2-ink-300">
            Quick status of your account and instructions for managing coach access.
          </p>
        </header>

        {!configured && (
          <div className="rounded-v2-md border border-v2-danger-600/60 bg-v2-danger-600/10 px-5 py-4 font-v2-body text-sm text-v2-ink-50 shadow-v2-elev-1">
            <div className="flex items-center gap-3">
              <div className="h-px w-5 bg-v2-danger-600" />
              <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-ink-50">
                Configuration Error
              </span>
            </div>
            <p className="mt-2">
              Firebase isn't configured. Set env vars or window.__FBCONFIG__ and reload.
            </p>
          </div>
        )}

        {/* Identity */}
        <SectionCard eyebrow="Identity" title="Signed-In User">
          <div className="flex flex-col gap-1">
            <span className="font-v2-heading text-[10px] uppercase tracking-[0.22em] text-v2-ink-500">
              UID
            </span>
            <code className="break-all font-v2-mono tabular-nums text-sm text-v2-ink-50">
              {uid}
            </code>
          </div>
        </SectionCard>

        {/* Roles */}
        <SectionCard eyebrow="Access" title="Current Roles">
          {loading ? (
            <div className="flex items-center gap-3 text-v2-ink-500">
              <div className="h-px w-5 bg-v2-warn-600" />
              <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em]">
                Loading
              </span>
            </div>
          ) : roles.length ? (
            <ul className="space-y-2">
              {roles.map((role) => (
                <li
                  key={role}
                  className="flex items-center gap-3 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 px-3 py-2"
                >
                  <div className="h-1.5 w-1.5 rounded-full bg-v2-warn-600" />
                  <span className="font-v2-mono text-sm text-v2-ink-50">{role}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-v2-ink-500">No roles assigned yet.</div>
          )}
          <p className="mt-4 border-t border-v2-surface-800 pt-4 text-xs text-v2-ink-500">
            Coaches automatically get the{" "}
            <code className="font-v2-mono text-v2-ink-300">coach</code> role when they sign in
            with the shared passcode. Admins have both{" "}
            <code className="font-v2-mono text-v2-ink-300">admin</code> and{" "}
            <code className="font-v2-mono text-v2-ink-300">coach</code>.
          </p>
        </SectionCard>

        {/* Access history */}
        <SectionCard
          eyebrow="Audit Log"
          title="Access History"
          action={
            accessHistory.length > 0 && (
              <button
                onClick={() => setClearHistoryConfirm(true)}
                className="min-h-touch rounded-v2-sm border border-v2-danger-600/60 bg-v2-danger-600/10 px-3 py-1.5 font-v2-heading text-[11px] uppercase tracking-[0.18em] text-v2-ink-50 transition duration-v2-quick hover:bg-v2-danger-600 hover:text-v2-ink-50 focus:outline-none focus:ring-2 focus:ring-v2-warn-500 focus:ring-offset-2 focus:ring-offset-v2-surface-950"
              >
                Clear History
              </button>
            )
          }
        >
          <div className="space-y-3">
            {accessHistory.map((entry) => (
              <div
                key={entry.code}
                className="rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950 p-4"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-px w-4 bg-v2-warn-600" />
                    <span className="font-v2-heading text-xs uppercase tracking-[0.18em] text-v2-ink-50">
                      {entry.code === "1357" ? "Admin Access" : "Coach Access"}
                    </span>
                  </div>
                  <span className="font-v2-mono tabular-nums text-xs text-v2-ink-500">
                    Last used:{" "}
                    {new Date(entry.lastUsed.toMillis()).toLocaleDateString()}
                  </span>
                </div>
                <div className="mt-2 font-v2-body text-xs text-v2-ink-300">
                  <span className="font-v2-heading uppercase tracking-[0.18em] text-v2-ink-500">
                    Roles:
                  </span>{" "}
                  <span className="font-v2-mono">{entry.roles.join(", ")}</span>
                </div>
                {entry.teamScopes.length > 0 && (
                  <div className="mt-1 font-v2-body text-xs text-v2-ink-300">
                    <span className="font-v2-heading uppercase tracking-[0.18em] text-v2-ink-500">
                      Team Scopes:
                    </span>{" "}
                    <span className="font-v2-mono">
                      {entry.teamScopes.map((team) => formatTeamLabel(team)).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            ))}
            {!accessHistory.length && (
              <div className="text-v2-ink-500">No access history found.</div>
            )}
          </div>
        </SectionCard>

        {/* Status callout */}
        {admin ? (
          <div className="rounded-v2-md border border-v2-warn-600/60 bg-v2-warn-600/10 p-5 shadow-v2-elev-1">
            <div className="flex items-center gap-3">
              <div className="h-px w-5 bg-v2-warn-600" />
              <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-warn-300">
                Admin Rights Granted
              </span>
            </div>
            <p className="mt-3 font-v2-body text-sm text-v2-ink-300">
              You have admin rights. If you need to elevate another adult to admin, add their
              UID to Firestore at{" "}
              <code className="font-v2-mono text-v2-ink-50">{"roles/{uid}"}</code> with{" "}
              <code className="font-v2-mono text-v2-ink-50">
                {"{ roles: [\"admin\",\"coach\"] }"}
              </code>
              .
            </p>
          </div>
        ) : coach ? (
          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 p-5 shadow-v2-elev-1">
            <div className="flex items-center gap-3">
              <div className="h-px w-5 bg-v2-warn-600" />
              <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-warn-300">
                Coach Access
              </span>
            </div>
            <p className="mt-3 font-v2-body text-sm text-v2-ink-300">
              You have coach access. Reach out to an admin if you need higher privileges.
            </p>
          </div>
        ) : (
          <div className="rounded-v2-md border border-v2-surface-800 bg-v2-surface-900 p-5 shadow-v2-elev-1">
            <div className="flex items-center gap-3">
              <div className="h-px w-5 bg-v2-warn-600" />
              <span className="font-v2-heading text-[11px] uppercase tracking-[0.22em] text-v2-warn-300">
                Athlete Mode
              </span>
            </div>
            <p className="mt-3 font-v2-body text-sm text-v2-ink-300">
              You're currently in athlete mode. Have an admin share the coach passcode so you
              can log in via the coach tab.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
