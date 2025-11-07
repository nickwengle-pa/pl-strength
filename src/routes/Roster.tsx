import React, { useEffect, useMemo, useState } from "react";
import {
  TEAM_DEFINITIONS,
  assignAthleteAccessCode,
  deleteAthlete,
  defaultEquipment,
  fetchAthleteSessions,
  formatTeamLabel,
  getTeamDefinition,
  getStoredTeamSelection,
  isAdmin,
  listRoster,
  loadProfileRemote,
  regenerateAthleteCode,
  saveProfile,
  fb,
  type Profile,
  type RosterEntry,
  type SessionRecord,
  type Team,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";

const LIFT_KEYS = ["bench", "squat", "deadlift", "press"] as const;
type LiftKey = (typeof LIFT_KEYS)[number];

const emptyTmDraft = (): Record<LiftKey, string> => ({
  bench: "",
  squat: "",
  deadlift: "",
  press: "",
});

const formatWeight = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
};

const normalizeRoles = (roles?: string[] | null): string[] =>
  Array.from(
    new Set(
      (roles ?? [])
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter(Boolean)
    )
  );

type RoleBadgesProps = {
  roles?: string[] | null;
};

function RoleBadges({ roles }: RoleBadgesProps) {
  const normalized = normalizeRoles(roles);
  if (!normalized.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {normalized.map((role) => {
        const label = role === "admin" ? "Admin" : role === "coach" ? "Coach" : role;
        const pillClass =
          role === "admin"
            ? "border border-purple-200 bg-purple-50 text-purple-700"
            : role === "coach"
            ? "border border-brand-200 bg-brand-50 text-brand-700"
            : "border border-gray-200 bg-gray-50 text-gray-600";
        return (
          <span
            key={role}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${pillClass}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

export default function Roster() {
  const [rows, setRows] = useState<RosterEntry[]>([]);
  const [err, setErr] = useState<string|undefined>();
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [deleteUid, setDeleteUid] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detailProfile, setDetailProfile] = useState<Profile | null>(null);
  const [detailSessions, setDetailSessions] = useState<SessionRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tmDraft, setTmDraft] = useState<Record<LiftKey, string>>(() => emptyTmDraft());
  const [tmSaving, setTmSaving] = useState<LiftKey | null>(null);
  const { setActiveAthlete, isCoach } = useActiveAthlete();
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [coachTeam, setCoachTeam] = useState<Team | null>(null);
  const [teamFilter, setTeamFilter] = useState<Team | "all">("all");
  const currentUid = fb.auth?.currentUser?.uid ?? null;

  useEffect(() => {
    (async () => {
      try { setRows(await listRoster()); }
      catch (e:any) { setErr(e?.message || String(e)); }
    })();
  }, []);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 5000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const flag = await isAdmin();
        if (active) setIsAdminUser(flag);
      } catch (err) {
        console.warn("Failed to resolve admin status", err);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readTeam = () => {
      const stored = getStoredTeamSelection();
      setCoachTeam(stored || null);
    };
    readTeam();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pl-strength-team") {
        const normalized = getStoredTeamSelection();
        setCoachTeam(normalized || null);
      }
    };
    const handleCustom = (_event: Event) => readTeam();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pl-team-change", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pl-team-change", handleCustom);
    };
  }, []);

  const handleRegenerate = async (row: RosterEntry) => {
    if (!row.uid) return;

    const input = window.prompt(
      `Enter a 4-digit code for ${row.firstName ?? "this athlete"}.\nLeave blank to auto-generate a new code.`,
      ""
    );
    if (input === null) return;

    const trimmed = input.trim();
    if (trimmed && !/^\d{4}$/.test(trimmed)) {
      alert("Codes must be exactly 4 digits (for example, 1234).");
      return;
    }

    setBusyUid(row.uid);
    try {
      let nextCode: string | null = null;
      let source: "remote" | "local" = "remote";

      if (trimmed) {
        const result = await assignAthleteAccessCode(row.uid, trimmed);
        if (result.status === "taken") {
          setFlash({
            kind: "error",
            text: "That code is already used by another athlete. Try a different four-digit code.",
          });
          return;
        }
        if (result.status === "unavailable") {
          setFlash({
            kind: "error",
            text: "We could not reserve that code. Check Firestore permissions and try again.",
          });
          return;
        }
        nextCode = result.code;
        source = result.source;
      } else {
        nextCode = await regenerateAthleteCode(row.uid);
      }

      if (!nextCode) {
        setFlash({
          kind: "error",
          text: "A code was not generated. Try again.",
        });
        return;
      }

      setRows((prev) =>
        prev.map((r) => (r.uid === row.uid ? { ...r, accessCode: nextCode } : r))
      );
      if (detailProfile?.uid === row.uid) {
        setDetailProfile((prev) =>
          prev ? { ...prev, accessCode: nextCode ?? null } : prev
        );
      }
      setFlash({
        kind: "success",
        text:
          source === "local"
            ? `Code ${nextCode} assigned locally. Remote sync will apply once permissions are available.`
            : `Code ${nextCode} assigned.`,
      });
    } catch (e: any) {
      const message =
        e?.message ?? "Could not set a new code. Try again in a moment.";
      console.error("Failed to assign athlete code", e);
      setFlash({ kind: "error", text: message });
    } finally {
      setBusyUid(null);
    }
  };

  const handleDelete = async (row: RosterEntry, kind: "athlete" | "coach" = "athlete") => {
    if (!row.uid) return;

    if (currentUid && row.uid === currentUid) {
      alert("You cannot remove your own account from the roster while signed in.");
      return;
    }

    const label =
      kind === "coach"
        ? `Remove ${row.firstName ?? "this coach"}? This will revoke access and queue account deletion.`
        : `Delete ${row.firstName ?? "this athlete"} from roster? This clears their profile and sessions.`;
    const confirmDelete = window.confirm(label);
    if (!confirmDelete) return;

    setDeleteUid(row.uid);
    try {
      await deleteAthlete(row.uid);
      setRows((prev) => prev.filter((r) => r.uid !== row.uid));
      if (selectedUid === row.uid) {
        setSelectedUid(null);
        setDetailProfile(null);
        setDetailSessions([]);
      }
      setFlash({
        kind: "success",
        text:
          kind === "coach"
            ? `${row.firstName ?? "Coach"} removed. Auth account will be deleted shortly.`
            : `${row.firstName ?? "Athlete"} removed.`,
      });
    } catch (e: any) {
      const message =
        e?.message ?? "Could not delete athlete. Try again in a moment.";
      setFlash({ kind: "error", text: message });
    } finally {
      setDeleteUid(null);
    }
  };

  useEffect(() => {
    if (!selectedUid) {
      setDetailProfile(null);
      setDetailSessions([]);
      setDetailError(null);
      setTmDraft(emptyTmDraft());
      return;
    }
    let active = true;
    setDetailLoading(true);
      setDetailError(null);
    (async () => {
      try {
        const [profile, sessions] = await Promise.all([
          loadProfileRemote(selectedUid),
          fetchAthleteSessions(selectedUid, 12),
        ]);
        if (!active) return;
        const resolvedProfile: Profile = profile
          ? profile
          : {
              uid: selectedUid,
              firstName: selectedRow?.firstName ?? "",
              lastName: selectedRow?.lastName ?? "",
              unit: selectedRow?.unit ?? "lb",
              team: selectedRow?.team,
              accessCode: selectedRow?.accessCode ?? null,
              tm: undefined,
              equipment: defaultEquipment(),
            };
        setDetailProfile(resolvedProfile);
        if (isCoach) {
          setActiveAthlete({
            uid: resolvedProfile.uid,
            firstName: resolvedProfile.firstName ?? undefined,
            lastName: resolvedProfile.lastName ?? undefined,
            team: resolvedProfile.team ?? null,
            unit: resolvedProfile.unit,
          });
        }
        setDetailSessions(sessions);
      } catch (e: any) {
        if (!active) return;
        setDetailError(e?.message ?? "Could not load athlete data.");
        setDetailProfile(null);
        setDetailSessions([]);
      } finally {
        if (active) setDetailLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedUid, selectedRow]);

  useEffect(() => {
    if (!detailProfile) {
      setTmDraft(emptyTmDraft());
      return;
    }
    setTmDraft(() => {
      const draft = emptyTmDraft();
      for (const lift of LIFT_KEYS) {
        const value = detailProfile.tm?.[lift];
        if (typeof value === "number" && Number.isFinite(value)) {
          draft[lift] = String(value);
        }
      }
      return draft;
    });
  }, [detailProfile]);

  const handleTmDraftChange = (lift: LiftKey, value: string) => {
    setTmDraft((prev) => ({ ...prev, [lift]: value }));
  };

  const handleSaveTm = async (lift: LiftKey) => {
    if (!detailProfile) return;
    const raw = (tmDraft[lift] ?? "").trim();
    const nextValue = raw === "" ? null : Number(raw);
    if (nextValue !== null && (!Number.isFinite(nextValue) || Number.isNaN(nextValue) || nextValue < 0)) {
      setFlash({ kind: "error", text: "Enter a valid training max before saving." });
      return;
    }
    setTmSaving(lift);
    try {
      const nextTm: NonNullable<Profile["tm"]> = { ...(detailProfile.tm ?? {}) };
      if (nextValue === null) {
        delete nextTm[lift];
      } else {
        nextTm[lift] = nextValue;
      }
      const hasAny = LIFT_KEYS.some((key) => typeof nextTm[key] === "number" && Number.isFinite(nextTm[key] as number));
      const updatedProfile: Profile = {
        ...detailProfile,
        tm: hasAny ? nextTm : undefined,
      };
      await saveProfile(updatedProfile, { skipLocal: true });
      setDetailProfile(updatedProfile);
      setFlash({
        kind: "success",
        text: nextValue === null
          ? `${lift.charAt(0).toUpperCase() + lift.slice(1)} training max cleared.`
          : `${lift.charAt(0).toUpperCase() + lift.slice(1)} training max saved.`,
      });
    } catch (e: any) {
      setFlash({
        kind: "error",
        text: e?.message ?? "Could not save training max. Try again.",
      });
    } finally {
      setTmSaving(null);
    }
  };

  const liftSummaries = useMemo(() => {
    const buckets: Record<LiftKey, SessionRecord[]> = {
      bench: [],
      squat: [],
      deadlift: [],
      press: [],
    };
    for (const session of detailSessions) {
      const lift = session.lift as LiftKey;
      if (LIFT_KEYS.includes(lift)) {
        buckets[lift].push(session);
      }
    }
    return LIFT_KEYS.map((lift) => {
      const sessions = buckets[lift];
      const latest = sessions[0];
      let bestEst: { value: number; unit: SessionRecord["unit"] } | null = null;
      for (const entry of sessions) {
        if (typeof entry.est1rm === "number" && Number.isFinite(entry.est1rm)) {
          if (!bestEst || entry.est1rm > bestEst.value) {
            bestEst = { value: entry.est1rm, unit: entry.unit };
          }
        }
      }
      return {
        lift,
        label: lift.charAt(0).toUpperCase() + lift.slice(1),
        tm: detailProfile?.tm?.[lift],
        bestEst,
        latest,
        totalSessions: sessions.length,
      };
    });
  }, [detailProfile, detailSessions]);

  const isCoachRow = (row: RosterEntry) => {
    const roles = normalizeRoles(row.roles);
    return roles.includes("coach") || roles.includes("admin");
  };

  const coachRows = useMemo(
    () => rows.filter(isCoachRow),
    [rows]
  );
  const athleteRows = useMemo(
    () => rows.filter((row) => !isCoachRow(row)),
    [rows]
  );
  const allowedTeamDefs = useMemo(() => {
    if (isAdminUser) {
      return TEAM_DEFINITIONS;
    }
    if (coachTeam) {
      const definition = getTeamDefinition(coachTeam);
      if (definition) {
        return TEAM_DEFINITIONS.filter(
          (candidate) =>
            candidate.sport === definition.sport &&
            candidate.program === definition.program
        );
      }
    }
    return TEAM_DEFINITIONS.filter(
      (candidate) => candidate.sport === "football" && candidate.program === "coed"
    );
  }, [coachTeam, isAdminUser]);

  const allowedTeamIds = useMemo(
    () => allowedTeamDefs.map((definition) => definition.id as Team),
    [allowedTeamDefs]
  );

  useEffect(() => {
    setTeamFilter("all");
  }, [coachTeam, isAdminUser]);

  useEffect(() => {
    if (teamFilter !== "all" && !allowedTeamIds.includes(teamFilter)) {
      setTeamFilter("all");
    }
  }, [allowedTeamIds, teamFilter]);

  const allowedTeamSet = useMemo(() => new Set(allowedTeamIds), [allowedTeamIds]);

  const filteredAthleteRows = useMemo(() => {
    let scoped = athleteRows;
    if (!isAdminUser) {
      scoped = scoped.filter(
        (row) => row.team && allowedTeamSet.has(row.team as Team)
      );
    }
    if (teamFilter !== "all") {
      scoped = scoped.filter((row) => row.team === teamFilter);
    }
    return scoped;
  }, [athleteRows, allowedTeamSet, isAdminUser, teamFilter]);

  const selectedRow = useMemo(
    () => filteredAthleteRows.find((row) => row.uid === selectedUid) ?? null,
    [filteredAthleteRows, selectedUid]
  );

  useEffect(() => {
    if (
      selectedUid &&
      !filteredAthleteRows.some((row) => row.uid === selectedUid)
    ) {
      setSelectedUid(null);
      setDetailProfile(null);
      setDetailSessions([]);
      setDetailError(null);
      setDetailLoading(false);
    }
  }, [filteredAthleteRows, selectedUid]);

  if (err) {
    return (
      <div className="container py-6">
        <div className="card">
          <h3 className="text-lg font-semibold mb-2">Roster</h3>
          <div className="text-sm text-red-700">Error: {err}</div>
          <p className="text-sm mt-2">
            If this says "Missing or insufficient permissions", create Firestore <code>{'roles/{uid}'}</code> with <code>{"{ roles: [\"coach\"], updatedAt: serverTimestamp() }"}</code>, then publish rules.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-6 space-y-6">
      {flash && (
        <div
          className={`rounded-2xl border px-3 py-2 text-sm ${
            flash.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {flash.text}
        </div>
      )}

      <div className="card">
        <h3 className="text-lg font-semibold mb-3">Coaches</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">First</th>
                <th className="p-2 text-left">Last</th>
                <th className="p-2 text-left">Access</th>
                <th className="p-2 text-left">Team</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coachRows.map((r) => {
                const rolesList = normalizeRoles(r.roles);
                const admin = rolesList.includes("admin");
                return (
                  <tr
                    key={r.uid}
                    className={`border-t ${admin ? "bg-purple-50/60" : ""}`}
                  >
                    <td className="p-2 font-medium text-gray-800">{r.firstName || "-"}</td>
                    <td className="p-2">{r.lastName || "-"}</td>
                    <td className="p-2">
                      <RoleBadges roles={r.roles} />
                    </td>
                    <td className="p-2">{formatTeamLabel(r.team, "-")}</td>
                    <td className="p-2">
                      {isAdminUser ? (
                        <button
                          type="button"
                          className="btn btn-sm text-xs text-red-700 border-red-300 hover:bg-red-50"
                          onClick={() => handleDelete(r, "coach")}
                          disabled={deleteUid === r.uid}
                        >
                          {deleteUid === r.uid ? "Removing..." : "Remove"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">Admin only</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {coachRows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={5}>
                    No coaches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <h3 className="text-lg font-semibold">Athletes</h3>
          <p className="text-xs text-gray-500">
            Click a row to review recent sessions and TM numbers.
          </p>
        </div>
        {!isAdminUser && (
          <div className="flex flex-wrap gap-2 pb-4">
            <button
              type="button"
              className={[
                "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                teamFilter === "all"
                  ? "border-brand-200 bg-brand-50 text-brand-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-700",
              ].join(" ")}
              onClick={() => setTeamFilter("all")}
            >
              All
            </button>
            {allowedTeamDefs.map((definition) => (
              <button
                key={definition.id}
                type="button"
                className={[
                  "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                  teamFilter === definition.id
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-gray-200 bg-white text-gray-600 hover:border-brand-200 hover:text-brand-700",
                ].join(" ")}
                onClick={() => setTeamFilter(definition.id as Team)}
              >
                {definition.shortLabel || definition.label}
              </button>
            ))}
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border rounded-xl overflow-hidden">
            <thead className="bg-gray-50">
              <tr>
                <th className="p-2 text-left">First</th>
                <th className="p-2 text-left">Last</th>
                <th className="p-2 text-left">Team</th>
                <th className="p-2 text-left">Unit</th>
                <th className="p-2 text-left">Code</th>
                <th className="p-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredAthleteRows.map((r, index) => {
                const selected = selectedUid === r.uid;
                const rowKey = r.uid ? `${r.uid}-${index}` : `row-${index}`;
                return (
                  <tr
                    key={rowKey}
                    className={`border-t cursor-pointer transition ${
                      selected ? "bg-brand-50" : "hover:bg-gray-50"
                    }`}
                    onClick={() => {
                      setSelectedUid(r.uid);
                      if (isCoach && r.uid) {
                        setActiveAthlete({
                          uid: r.uid,
                          firstName: r.firstName ?? undefined,
                          lastName: r.lastName ?? undefined,
                          team: r.team ?? null,
                          unit: r.unit ?? undefined,
                        });
                      }
                    }}
                  >
                    <td className="p-2">{r.firstName || "-"}</td>
                    <td className="p-2">{r.lastName || "-"}</td>
                    <td className="p-2">{formatTeamLabel(r.team, "-")}</td>
                    <td className="p-2">{r.unit || "-"}</td>
                    <td className="p-2 font-mono text-xs">{r.accessCode ?? "-"}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn px-3 py-1 text-xs"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRegenerate(r);
                          }}
                          disabled={busyUid === r.uid || deleteUid === r.uid}
                        >
                          {busyUid === r.uid ? "Working..." : "Set code"}
                        </button>
                        <button
                          type="button"
                          className="btn px-3 py-1 text-xs text-red-700 border-red-300 hover:bg-red-50"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(r);
                          }}
                          disabled={deleteUid === r.uid || busyUid === r.uid}
                        >
                          {deleteUid === r.uid ? "Deleting..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredAthleteRows.length === 0 && (
                <tr>
                  <td className="p-2 text-gray-500" colSpan={6}>
                    No athletes found for the selected team.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedUid && (
        <div className="card space-y-4">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">
              Review: {detailProfile?.firstName} {detailProfile?.lastName}
            </h3>
            {selectedRow?.roles && <RoleBadges roles={selectedRow.roles} />}
          </div>
            <button
              type="button"
              className="btn text-xs md:text-sm"
              onClick={() => setSelectedUid(null)}
            >
              Close
            </button>
          </div>

          {detailLoading && (
            <div className="text-sm text-gray-500">Loading latest numbers…</div>
          )}

          {detailError && !detailLoading && (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {detailError}
            </div>
          )}

          {!detailLoading && !detailError && detailProfile && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm text-gray-600">Team</div>
                  <div className="text-base font-semibold text-gray-900">
                    {formatTeamLabel(detailProfile.team, "-")}
                  </div>
                  <div className="mt-2 text-sm text-gray-600">Unit</div>
                  <div className="text-base font-semibold text-gray-900">
                    {detailProfile.unit}
                  </div>
                  <div className="mt-2 text-sm text-gray-600">Sign-in code</div>
                  <div className="font-mono text-base text-gray-900">
                    {detailProfile.accessCode ?? "-"}
                  </div>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 md:col-span-2">
                  <div className="flex flex-col gap-1 mb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm font-semibold text-gray-700">
                      Lift Summary &amp; Quick Edit
                    </div>
                    <div className="text-xs text-gray-500">
                      Review recent logs and adjust training max numbers on the fly.
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="text-gray-600">
                        <tr>
                          <th className="p-2 text-left">Lift</th>
                          <th className="p-2 text-left">Training Max</th>
                          <th className="p-2 text-left">Best Est 1RM</th>
                          <th className="p-2 text-left">Last Session</th>
                          <th className="p-2 text-left">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {liftSummaries.map((summary) => {
                          const draftValue = tmDraft[summary.lift];
                          const isSaving = tmSaving === summary.lift;
                          const latest = summary.latest;
                          const latestMeta = latest
                            ? [`Week ${latest.week}`, latest.pr ? "PR" : ""].filter(Boolean).join(" / ")
                            : "";
                          return (
                            <tr key={summary.lift} className="border-t">
                              <td className="p-2 capitalize font-medium text-gray-800">
                                {summary.label}
                              </td>
                              <td className="p-2">
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min={0}
                                    step="1"
                                    className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm"
                                    value={draftValue}
                                    onChange={(event) =>
                                      handleTmDraftChange(summary.lift, event.target.value)
                                    }
                                    placeholder="--"
                                  />
                                  <span className="text-xs text-gray-500">
                                    {detailProfile.unit}
                                  </span>
                                </div>
                              </td>
                              <td className="p-2">
                                {summary.bestEst
                                  ? `${formatWeight(summary.bestEst.value)} ${summary.bestEst.unit}`
                                  : "-"}
                              </td>
                              <td className="p-2">
                                {latest ? (
                                  <div className="space-y-0.5 text-xs text-gray-600">
                                    <div className="font-medium text-gray-800">
                                      {latest.createdAt
                                        ? new Date(latest.createdAt).toLocaleDateString()
                                        : "-"}
                                    </div>
                                    <div>
                                      {latest.amrap?.weight ?? 0} {latest.unit} x{" "}
                                      {latest.amrap?.reps ?? 0}
                                    </div>
                                    {latestMeta && (
                                      <div className="text-gray-500">{latestMeta}</div>
                                    )}
                                    <div className="text-gray-400">
                                      Logs: {summary.totalSessions}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="space-y-0.5 text-xs text-gray-400">
                                    <div>No sessions yet</div>
                                    <div>Logs: {summary.totalSessions}</div>
                                  </div>
                                )}
                              </td>
                              <td className="p-2">
                                <button
                                  type="button"
                                  className="btn px-3 py-1 text-xs"
                                  disabled={isSaving || !detailProfile}
                                  onClick={() => handleSaveTm(summary.lift)}
                                >
                                  {isSaving ? "Saving..." : "Save"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-700">
                  Recent Sessions
                </h4>
                {detailSessions.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500">
                    No logged sessions yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="p-2 text-left">Date</th>
                          <th className="p-2 text-left">Lift</th>
                          <th className="p-2 text-left">Week</th>
                          <th className="p-2 text-left">AMRAP</th>
                          <th className="p-2 text-left">Est 1RM</th>
                          <th className="p-2 text-left">PR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailSessions.slice(0, 8).map((session) => (
                          <tr key={session.id ?? session.createdAt} className="border-t">
                            <td className="p-2 text-xs text-gray-600">
                              {session.createdAt
                                ? new Date(session.createdAt).toLocaleDateString()
                                : "-"}
                            </td>
                            <td className="p-2 capitalize">{session.lift}</td>
                            <td className="p-2">Week {session.week}</td>
                            <td className="p-2 text-xs">
                              {session.amrap?.weight ?? 0} {session.unit} x{" "}
                              {session.amrap?.reps ?? 0}
                            </td>
                            <td className="p-2 font-semibold">
                              {session.est1rm
                                ? `${session.est1rm} ${session.unit}`
                                : "-"}
                            </td>
                            <td className="p-2 text-green-600">
                              {session.pr ? "PR" : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
