import React, { useEffect, useState } from "react";
import {
  ensureAnon,
  loadProfileRemote,
  recentSessions,
  saveSession,
  getStoredTeamSelection,
  type Team,
  type SessionRecord,
  type Profile,
  type Unit,
} from "../lib/db";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { estimate1RM, roundToPlate } from "../lib/tm";
import { useToast } from "../context/ToastContext";

type Lift = "bench" | "squat" | "deadlift";

const roundEstimate = (value: number, unit: Unit): number => {
  if (!Number.isFinite(value)) return 0;
  return roundToPlate(value, unit, unit === "lb" ? 5 : 2.5);
};

export default function ProgressV2() {
  const showToast = useToast();
  const [uid, setUid] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedLift, setSelectedLift] = useState<Lift>("bench");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showQuickPR, setShowQuickPR] = useState(false);
  const [prWeight, setPrWeight] = useState<string>("");
  const [prReps, setPrReps] = useState<string>("");
  const [prNote, setPrNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

  const { activeAthlete, isCoach, loading: coachLoading } = useActiveAthlete();
  const targetUid = isCoach && activeAthlete ? activeAthlete.uid : undefined;
  const activeAthleteName = activeAthlete
    ? [activeAthlete.firstName, activeAthlete.lastName].filter(Boolean).join(" ") || activeAthlete.uid
    : "";

  const sessionTeam = (teamSelection || profile?.team || activeAthlete?.team) as Team | undefined;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readTeam = () => setTeamSelection(getStoredTeamSelection());
    readTeam();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === "pl-strength-team") readTeam();
    };
    const handleCustom = () => readTeam();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pl-team-change", handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pl-team-change", handleCustom);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (targetUid) {
          await ensureAnon();
          const remote = await loadProfileRemote(targetUid);
          setUid(targetUid);
          setProfile(remote || null);
          return;
        }
        const u = await ensureAnon();
        setUid(u);
        const remote = await loadProfileRemote(u);
        setProfile(remote || null);
      } catch (err) {
        console.debug("Progress: Could not load profile", err);
      }
    })();
  }, [targetUid, activeAthlete, teamSelection]);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setLoading(true);
      try {
        const data = await recentSessions(selectedLift, 50, targetUid || uid, sessionTeam);
        setSessions(data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      } catch (err) {
        console.debug("Could not load sessions for progress", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [uid, selectedLift, targetUid, sessionTeam]);

  const unit = (profile?.unit || "lb") as Unit;
  const currentTM = profile?.tm?.[selectedLift] || 0;
  const hasLiftWeekMap = Boolean(profile?.liftWeeks && Object.keys(profile.liftWeeks).length > 0);
  const hasLiftCycleMap = Boolean(profile?.liftCycles && Object.keys(profile.liftCycles).length > 0);
  const liftWeek =
    profile?.liftWeeks?.[selectedLift] ??
    (!hasLiftWeekMap ? profile?.currentWeek : undefined) ?? 1;
  const liftCycle =
    profile?.liftCycles?.[selectedLift] ??
    (!hasLiftCycleMap ? profile?.currentCycle : undefined) ?? 1;

  const prSessions = sessions.filter(s => s.pr);
  const maxEst1RM = sessions.length > 0
    ? Math.max(...sessions.map((s) => roundEstimate(s.est1rm || 0, unit)))
    : 0;
  const avgAMRAP = sessions.length > 0
    ? sessions.reduce((sum, s) => sum + (s.amrap?.reps || 0), 0) / sessions.length
    : 0;

  const handleSaveQuickPR = async () => {
    const weight = Number(prWeight);
    const reps = Number(prReps);
    if (!weight || weight <= 0) { showToast("Please enter a valid weight.", "warning"); return; }
    if (!reps || reps <= 0) { showToast("Please enter a valid number of reps.", "warning"); return; }

    setSaving(true);
    try {
      const est1rm = roundEstimate(estimate1RM(weight, reps), unit);
      const record: SessionRecord = {
        lift: selectedLift,
        week: liftWeek,
        cycle: liftCycle,
        team: sessionTeam,
        unit,
        tm: currentTM,
        est1rm,
        pr: true,
        warmups: [],
        work: [],
        amrap: { weight, reps },
        note: prNote.trim() || "Quick PR Entry",
        createdAt: Date.now(),
      };
      await saveSession(record, targetUid || uid, { requireRemote: true });
      const data = await recentSessions(selectedLift, 50, targetUid || uid, sessionTeam);
      setSessions(data.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      setPrWeight(""); setPrReps(""); setPrNote("");
      setShowQuickPR(false);
    } catch (err) {
      console.error("Failed to save PR", err);
      showToast("Failed to save PR. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (coachLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] animate-pulse">
          Loading…
        </span>
      </div>
    );
  }

  const fieldCls =
    "bg-v2-surface-900 border border-v2-surface-700 text-v2-ink-50 font-v2-body rounded-v2-sm px-3 py-2 text-v2-base focus:border-v2-accent-500 focus:outline-none transition-colors duration-v2-quick placeholder:text-v2-ink-600 w-full";

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-12 relative overflow-hidden">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.15) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-gutter-mobile md:px-6 py-6 space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-7 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                Analytics
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-3xl font-bold uppercase tracking-tight leading-none mt-2">
              Progress
            </h1>
            {targetUid && (
              <div className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wide mt-2">
                Viewing: <span className="text-v2-ink-200">{activeAthleteName}</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowQuickPR(true)}
            className="min-h-touch px-5 py-2 bg-v2-success-600 hover:bg-v2-success-700 text-v2-ink-50 font-v2-heading text-v2-sm font-bold uppercase tracking-widest rounded-v2-sm transition-colors duration-v2-quick"
          >
            Log Quick PR
          </button>
        </div>

        {isCoach && !targetUid && (
          <div className="rounded-v2-sm border-l-[3px] border-v2-warn-500 bg-v2-warn-900/30 px-4 py-3 font-v2-body text-v2-sm text-v2-warn-300">
            No athlete selected. Choose an athlete from the roster to view their progress.
          </div>
        )}

        {/* Lift selector */}
        <div className="grid grid-cols-3 gap-1">
          {(["bench", "squat", "deadlift"] as Lift[]).map((lift) => {
            const isActive = selectedLift === lift;
            return (
              <button
                key={lift}
                onClick={() => setSelectedLift(lift)}
                className={`py-3 font-v2-heading font-bold uppercase tracking-widest text-v2-sm border transition-all duration-v2-quick ${
                  isActive
                    ? "bg-v2-accent-700 border-v2-accent-600 text-v2-ink-50 shadow-v2-elev-1"
                    : "bg-v2-surface-900 border-v2-surface-700 text-v2-ink-400 hover:border-v2-surface-600 hover:text-v2-ink-100"
                }`}
              >
                {lift}
              </button>
            );
          })}
        </div>

        {/* Stats */}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <StatCard label="Current TM" value={currentTM || "—"} suffix={unit} accent="text-v2-accent-300" />
          <StatCard
            label="Max Est. 1RM"
            value={maxEst1RM ? roundEstimate(maxEst1RM, unit) : "—"}
            suffix={unit}
            accent="text-v2-ink-50"
          />
          <StatCard
            label="Total PRs"
            value={prSessions.length}
            suffix="Records"
            accent="text-v2-success-300"
          />
          <StatCard
            label="Avg AMRAP"
            value={avgAMRAP ? avgAMRAP.toFixed(1) : "—"}
            suffix="Reps"
            accent="text-v2-info-300"
          />
        </div>

        {loading ? (
          <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md py-10 text-center font-v2-body text-v2-sm text-v2-ink-500">
            Loading session data…
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md py-10 text-center font-v2-body text-v2-sm text-v2-ink-400">
            No workout sessions recorded yet for {cap(selectedLift)}.
            <div className="mt-1 text-v2-ink-500">
              Complete your first workout to start tracking progress.
            </div>
          </div>
        ) : (
          <>
            <ChartCard label="Training Max Progress">
              <TMChart sessions={sessions} unit={unit} currentTM={currentTM} />
            </ChartCard>
            <ChartCard label="Estimated 1RM Over Time">
              <Est1RMChart sessions={sessions} unit={unit} />
            </ChartCard>
            <ChartCard label="AMRAP Reps Trend">
              <AMRAPChart sessions={sessions} />
            </ChartCard>

            <SectionCard label="PR Timeline" accentClass="bg-v2-success-500">
              {prSessions.length === 0 ? (
                <div className="font-v2-body text-v2-sm text-v2-ink-400 text-center py-4">
                  No PRs yet. Keep pushing.
                </div>
              ) : (
                <div className="space-y-3">
                  {prSessions.slice().reverse().map((session, idx) => {
                    const amrapReps = session.amrap?.reps ?? 0;
                    const amrapWeight = session.amrap?.weight ?? 0;
                    return (
                      <div
                        key={idx}
                        className="rounded-v2-sm border border-v2-surface-800 border-l-[3px] border-l-v2-success-500 bg-v2-success-900/20 px-4 py-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <Field label="Date" value={formatDate(session.createdAt)} />
                          <Field
                            label="Cycle / Week"
                            value={`C${session.cycle ?? 1} / W${session.week}`}
                            align="right"
                          />
                        </div>
                        <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          <Field label="AMRAP" value={`${amrapReps} × ${amrapWeight} ${unit}`} />
                          <Field label="Est 1RM" value={`${roundEstimate(session.est1rm || 0, unit)} ${unit}`} />
                          <Field label="TM" value={`${session.tm || 0} ${unit}`} />
                          <Field label="PR" value="Yes" valueClass="text-v2-success-300" />
                        </div>
                        {session.note && (
                          <div className="mt-2 font-v2-body text-v2-xs text-v2-ink-400">
                            <span className="text-v2-ink-500 uppercase tracking-wide">Note:</span> {session.note}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard label="Recent Sessions" accentClass="bg-v2-accent-700">
              <div className="divide-y divide-v2-surface-800">
                {sessions.slice(-20).reverse().map((s, idx) => {
                  const amrapReps = s.amrap?.reps ?? 0;
                  const amrapWeight = s.amrap?.weight ?? 0;
                  return (
                    <div key={idx} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <Field label="Date" value={formatDate(s.createdAt)} />
                        <Field
                          label="Cycle / Week"
                          value={`C${s.cycle ?? 1} / W${s.week}`}
                          align="right"
                        />
                      </div>
                      <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                        <Field label="TM" value={`${s.tm || 0} ${unit}`} />
                        <Field label="AMRAP" value={`${amrapReps} × ${amrapWeight} ${unit}`} />
                        <Field label="Est 1RM" value={`${roundEstimate(s.est1rm || 0, unit)} ${unit}`} />
                        <Field
                          label="PR"
                          value={s.pr ? "Yes" : "No"}
                          valueClass={s.pr ? "text-v2-success-300" : "text-v2-ink-500"}
                        />
                      </div>
                      {s.note && (
                        <div className="mt-2 font-v2-body text-v2-xs text-v2-ink-400">
                          <span className="text-v2-ink-500 uppercase tracking-wide">Note:</span> {s.note}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </>
        )}
      </div>

      {/* Quick PR modal */}
      {showQuickPR && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowQuickPR(false)}
        >
          <div
            className="w-full max-w-md bg-v2-surface-900 border border-v2-surface-800 border-l-[3px] border-l-v2-success-500 rounded-v2-md shadow-v2-elev-3 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-v2-surface-800 bg-v2-success-900/20">
              <div className="flex items-center gap-2">
                <div className="h-px w-5 bg-v2-success-500" />
                <span className="font-v2-body text-v2-xs text-v2-success-300 uppercase tracking-[0.22em] font-semibold">
                  New Record
                </span>
              </div>
              <h2 className="font-v2-heading text-v2-xl font-bold text-v2-ink-50 uppercase tracking-tight mt-1">
                Log Quick PR
              </h2>
              <p className="font-v2-body text-v2-xs text-v2-ink-400 mt-1">
                Record a personal record for {cap(selectedLift)}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.18em]">
                  Weight ({unit})
                </span>
                <input
                  type="number" min="0" step="1"
                  className={`${fieldCls} font-v2-mono tabular-nums`}
                  placeholder="e.g., 225"
                  value={prWeight}
                  onChange={(e) => setPrWeight(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.18em]">
                  Reps
                </span>
                <input
                  type="number" min="1" step="1"
                  className={`${fieldCls} font-v2-mono tabular-nums`}
                  placeholder="e.g., 5"
                  value={prReps}
                  onChange={(e) => setPrReps(e.target.value)}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-400 uppercase tracking-[0.18em]">
                  Note (Optional)
                </span>
                <input
                  type="text"
                  className={fieldCls}
                  placeholder="e.g., Felt strong today"
                  value={prNote}
                  onChange={(e) => setPrNote(e.target.value)}
                />
              </label>

              {prWeight && prReps && (
                <div className="rounded-v2-sm bg-v2-surface-950 border border-v2-surface-800 px-3 py-2">
                  <span className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.18em]">Est. 1RM:</span>
                  <span className="ml-2 font-v2-mono text-v2-base font-bold text-v2-ink-100 tabular-nums">
                    {roundEstimate(estimate1RM(Number(prWeight), Number(prReps)), unit)} {unit}
                  </span>
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-v2-surface-800 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowQuickPR(false)}
                disabled={saving}
                className="px-4 min-h-touch py-2 rounded-v2-sm border border-v2-surface-700 text-v2-ink-300 hover:border-v2-surface-500 hover:text-v2-ink-100 font-v2-heading text-v2-sm font-bold uppercase tracking-widest transition-colors duration-v2-quick"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveQuickPR}
                disabled={saving}
                className="px-5 min-h-touch py-2 rounded-v2-sm bg-v2-success-600 hover:bg-v2-success-700 text-v2-ink-50 font-v2-heading text-v2-sm font-bold uppercase tracking-widest transition-colors duration-v2-quick disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save PR"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  suffix: string;
  accent: string;
}) {
  return (
    <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md px-4 py-3 shadow-v2-elev-1 text-center">
      <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] font-semibold">
        {label}
      </div>
      <div className={`font-v2-mono text-v2-3xl font-bold tabular-nums mt-1 ${accent}`}>
        {value}
      </div>
      <div className="font-v2-body text-v2-xs text-v2-ink-600 uppercase tracking-wide">
        {suffix}
      </div>
    </div>
  );
}

function ChartCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md p-4 shadow-v2-elev-1">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-px w-5 bg-v2-accent-700" />
        <h2 className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-[0.22em] font-semibold">
          {label}
        </h2>
      </div>
      {children}
    </div>
  );
}

function SectionCard({
  label,
  accentClass,
  children,
}: {
  label: string;
  accentClass: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-v2-surface-900 border border-v2-surface-800 rounded-v2-md overflow-hidden shadow-v2-elev-1">
      <div className="px-4 py-3 border-b border-v2-surface-800 flex items-center gap-2">
        <div className={`h-px w-5 ${accentClass}`} />
        <h2 className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-[0.22em] font-semibold">
          {label}
        </h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  valueClass,
  align,
}: {
  label: string;
  value: React.ReactNode;
  valueClass?: string;
  align?: "right";
}) {
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="font-v2-body text-[10px] font-semibold uppercase tracking-[0.2em] text-v2-ink-500">
        {label}
      </div>
      <div className={`font-v2-mono text-v2-sm font-semibold tabular-nums mt-0.5 ${valueClass || "text-v2-ink-100"}`}>
        {value}
      </div>
    </div>
  );
}

// ── Charts ───────────────────────────────────────────────
type ChartPoint = {
  x: number;
  y: number;
  label: string;
  pointClassName?: string;
};

type ChartScaleOptions = { min?: number; max?: number };

const buildChartPoints = (
  values: number[],
  labels: string[],
  options: ChartScaleOptions = {}
): ChartPoint[] => {
  if (values.length === 0) return [];
  const max = Math.max(...values, options.max ?? -Infinity);
  const min = Math.min(...values, options.min ?? Infinity);
  const range = max - min || 1;
  return values.map((value, idx) => {
    const x = values.length === 1 ? 50 : (idx / (values.length - 1)) * 100;
    const y = 100 - ((value - min) / range) * 80 - 10;
    return { x, y, label: labels[idx] ?? "" };
  });
};

function LineChart({
  points,
  strokeClass,
}: {
  points: ChartPoint[];
  strokeClass: string;
}) {
  if (points.length === 0) return null;
  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <div className="relative h-64 rounded-v2-sm border border-v2-surface-800 bg-v2-surface-950">
      <div className="absolute inset-4">
        <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            points={polylinePoints}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={strokeClass}
          />
        </svg>
        {points.map((point, idx) => (
          <div
            key={idx}
            className="absolute flex items-center gap-2"
            style={{
              left: `${point.x}%`,
              top: `${point.y}%`,
              transform: "translate(-6px, -50%)",
            }}
          >
            <span
              className={`h-3 w-3 rounded-v2-full border border-v2-surface-950 shadow ${
                point.pointClassName ?? "bg-v2-accent-500"
              }`}
            />
            <span className="rounded bg-v2-surface-800/90 px-1.5 py-0.5 font-v2-mono text-[10px] font-semibold text-v2-ink-100 tabular-nums shadow-sm">
              {point.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TMChart({
  sessions, unit, currentTM,
}: {
  sessions: SessionRecord[]; unit: string; currentTM: number;
}) {
  const tmValues = sessions.map((s) => s.tm);
  const uniqueTMs = Array.from(new Set(tmValues));
  if (uniqueTMs.length === 1 && uniqueTMs[0] === currentTM) {
    return (
      <div className="text-center py-8 font-v2-body text-v2-sm text-v2-ink-400">
        Training max has remained constant at{" "}
        <span className="font-v2-mono text-v2-ink-100 tabular-nums">{currentTM} {unit}</span>.
        <div className="mt-1 text-v2-ink-500">Complete more workouts to see progression.</div>
      </div>
    );
  }
  const maxTM = Math.max(...tmValues, currentTM);
  const minTM = Math.min(...tmValues, currentTM);
  const labels = sessions.map((s) => `${formatValue(s.tm)} ${unit}`);
  const points = buildChartPoints(tmValues, labels, { min: minTM, max: maxTM }).map((p) => ({
    ...p,
    pointClassName: "bg-v2-accent-500",
  }));
  return (
    <div className="space-y-2">
      <LineChart points={points} strokeClass="text-v2-accent-500" />
      <div className="flex justify-between font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wide">
        <span>First: <span className="font-v2-mono text-v2-ink-200 tabular-nums">{formatValue(sessions[0]?.tm || 0)} {unit}</span></span>
        <span className="text-v2-success-300">Current: <span className="font-v2-mono tabular-nums">{formatValue(currentTM)} {unit}</span></span>
      </div>
    </div>
  );
}

function Est1RMChart({ sessions, unit }: { sessions: SessionRecord[]; unit: Unit }) {
  const est1RMs = sessions.map((s) => roundEstimate(s.est1rm || 0, unit));
  const max = Math.max(...est1RMs);
  const min = Math.min(...est1RMs);
  const labels = sessions.map((_, idx) => `${formatValue(est1RMs[idx])} ${unit}`);
  const points = buildChartPoints(est1RMs, labels, { min, max }).map((p, idx) => ({
    ...p,
    pointClassName: sessions[idx].pr
      ? "bg-v2-success-500 ring-2 ring-v2-success-800"
      : "bg-v2-info-500",
  }));
  return (
    <div className="space-y-2">
      <LineChart points={points} strokeClass="text-v2-info-500" />
      <div className="flex justify-between font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wide">
        <span>Min: <span className="font-v2-mono text-v2-ink-200 tabular-nums">{roundEstimate(min, unit)} {unit}</span></span>
        <span>Max: <span className="font-v2-mono text-v2-ink-100 tabular-nums">{roundEstimate(max, unit)} {unit}</span></span>
      </div>
    </div>
  );
}

function AMRAPChart({ sessions }: { sessions: SessionRecord[] }) {
  const amrapReps = sessions.map((s) => s.amrap?.reps || 0);
  const max = Math.max(...amrapReps, 10);
  const labels = sessions.map((_, idx) => `${formatValue(amrapReps[idx])} reps`);
  const points = buildChartPoints(amrapReps, labels, { min: 0, max }).map((p, idx) => ({
    ...p,
    pointClassName: sessions[idx].pr
      ? "bg-v2-success-500 ring-2 ring-v2-success-800"
      : "bg-v2-warn-500",
  }));
  return (
    <div className="space-y-2">
      <LineChart points={points} strokeClass="text-v2-warn-500" />
      <div className="flex justify-between font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wide">
        <span>Range: <span className="font-v2-mono text-v2-ink-200 tabular-nums">0–{max}</span> reps</span>
        <span>Avg: <span className="font-v2-mono text-v2-ink-100 tabular-nums">{(amrapReps.reduce((a, b) => a + b, 0) / amrapReps.length).toFixed(1)}</span> reps</span>
      </div>
    </div>
  );
}

function formatDate(timestamp?: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return value.toFixed(1).replace(/\.0$/, "");
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
