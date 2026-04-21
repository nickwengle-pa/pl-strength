import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  defaultEquipment,
  ensureAnon,
  loadProfileRemote,
  saveProfile,
  recentSessions,
  getStoredTeamSelection,
  type Team,
  type Profile,
  type Unit,
  type SessionRecord,
} from "../lib/db";
import { roundToPlate, weekPercents, warmupPercents } from "../lib/tm";
import { useActiveAthlete } from "../context/ActiveAthleteContext";
import { useToast } from "../context/ToastContext";

type Lift = "bench" | "squat" | "deadlift";
type Week = 1 | 2 | 3;

const LIFTS: Lift[] = ["squat", "bench", "deadlift"];

const cycleIncrement = (lift: Lift, unit: Unit): number => {
  const upperIncrement = unit === "kg" ? 2.5 : 5;
  const lowerIncrement = unit === "kg" ? 5 : 10;
  return lift === "bench" ? upperIncrement : lowerIncrement;
};

const deriveBaseTm = (profile: Profile | null, lift: Lift): number => {
  const fromTm = profile?.tm?.[lift];
  if (typeof fromTm === "number" && Number.isFinite(fromTm) && fromTm > 0) {
    return fromTm;
  }
  const fromOneRm = profile?.oneRm?.[lift];
  if (typeof fromOneRm === "number" && Number.isFinite(fromOneRm) && fromOneRm > 0) {
    return fromOneRm * 0.9;
  }
  return 100;
};

const PCT: Record<Week, Array<[number, string]>> = {
  1: [[0.65, "x5"], [0.75, "x5"], [0.85, "x5+"]],
  2: [[0.70, "x3"], [0.80, "x3"], [0.90, "x3+"]],
  3: [[0.75, "x5"], [0.85, "x3"], [0.95, "x1+"]],
};

function roundWeight(x: number, unit: Unit) {
  const step = unit === "lb" ? 5 : 2.5;
  return Math.round(x / step) * step;
}

const LIFT_COLORS: Record<Lift, { border: string; accent: string; text: string; bg: string }> = {
  squat: {
    border: "border-v2-accent-700",
    accent: "bg-v2-accent-700",
    text: "text-v2-accent-300",
    bg: "bg-v2-accent-950/40",
  },
  bench: {
    border: "border-v2-info-700",
    accent: "bg-v2-info-700",
    text: "text-v2-info-300",
    bg: "bg-v2-info-950/40",
  },
  deadlift: {
    border: "border-v2-warn-700",
    accent: "bg-v2-warn-700",
    text: "text-v2-warn-300",
    bg: "bg-v2-warn-950/40",
  },
};

export default function SummaryV2() {
  const navigate = useNavigate();
  const showToast = useToast();
  const [uid, setUid] = useState<string>("");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [lift, setLift] = useState<Lift>("bench");
  const [week, setWeek] = useState<Week>(1);
  const [cycle, setCycle] = useState<number>(1);
  const [tm, setTm] = useState<number | "">("");
  const [completedLifts, setCompletedLifts] = useState<Set<Lift>>(new Set());
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [teamSelection, setTeamSelection] = useState<Team | "">(() => getStoredTeamSelection());

  const { activeAthlete, isCoach, loading: coachLoading, notifyProfileChange, version } = useActiveAthlete();
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
      if (event.key === "pl-strength-team") {
        readTeam();
      }
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
          const profileData: Profile = remote
            ? { ...remote, equipment: remote.equipment ?? defaultEquipment() }
            : ({
                uid: targetUid,
                firstName: activeAthlete?.firstName ?? "",
                lastName: activeAthlete?.lastName ?? "",
                unit: (activeAthlete?.unit as Unit) || "lb",
                accessCode: null,
                tm: {},
                oneRm: {},
                equipment: defaultEquipment(),
                team: activeAthlete?.team ?? undefined,
              } as Profile);
          setUid(targetUid);
          setProfile(profileData);
          return;
        }
        const u = await ensureAnon();
        setUid(u);
        const remote = await loadProfileRemote(u);
        const profileData: Profile = remote
          ? { ...remote, equipment: remote.equipment ?? defaultEquipment() }
          : {
              uid: u,
              firstName: "",
              lastName: "",
              unit: "lb",
              accessCode: null,
              tm: {},
              oneRm: {},
              equipment: defaultEquipment(),
            };
        setProfile(profileData);
      } catch (err) {
        console.debug("Summary: Could not load profile (user may be signing out)", err);
      }
    })();
  }, [targetUid, activeAthlete, version, teamSelection]);

  useEffect(() => {
    if (!profile) {
      setTm("");
      return;
    }
    const existing = profile.tm?.[lift];
    setTm(existing ?? "");
  }, [lift, profile]);

  useEffect(() => {
    if (!uid) return;

    (async () => {
      setLoadingSessions(true);
      try {
        const allLifts: Lift[] = ["bench", "squat", "deadlift"];
        const completed = new Set<Lift>();

        await Promise.all(
          allLifts.map(async (liftName) => {
            const sessions = await recentSessions(
              liftName,
              5,
              targetUid || uid,
              sessionTeam
            );
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayTimestamp = today.getTime();

            const hasCompletedToday = sessions.some((s) => {
              const sessionDate = s.createdAt || 0;
              return sessionDate >= todayTimestamp && s.week === week;
            });

            if (hasCompletedToday) {
              completed.add(liftName);
            }
          })
        );

        setCompletedLifts(completed);
      } catch (err) {
        console.debug("Could not load sessions for completion status", err);
      } finally {
        setLoadingSessions(false);
      }
    })();
  }, [uid, week, targetUid, sessionTeam]);

  const unit = profile?.unit || "lb";

  const saveTM = async () => {
    if (!profile || tm === "") return;
    const updated: Profile = {
      ...profile,
      tm: { ...(profile.tm || {}), [lift]: Number(tm) },
    };
    try {
      await saveProfile(updated, { skipLocal: Boolean(targetUid), requireRemote: true });
      setProfile(updated);
      notifyProfileChange();
    } catch (err) {
      console.warn("Failed to save training max", err);
      showToast("Unable to save training max right now. Please try again.", "error");
    }
  };

  const sessionPlan =
    typeof tm === "number"
      ? (() => {
          const increment = cycleIncrement(lift, unit);
          const cycleTm = tm + (cycle - 1) * increment;
          const warmups = warmupPercents().map((p) => ({
            pct: Math.round(p * 100),
            weight: roundWeight(cycleTm * p, unit),
            reps: "5",
          }));
          const work = PCT[week].map(([p, reps]) => ({
            pct: Math.round(p * 100),
            weight: roundWeight(cycleTm * p, unit),
            reps,
          }));
          return { warmups, work };
        })()
      : { warmups: [], work: [] };

  if (coachLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-v2-surface-950">
        <span className="font-v2-heading uppercase tracking-[0.2em] text-v2-ink-500 animate-pulse">
          Loading coach tools…
        </span>
      </div>
    );
  }

  const liftLabel = cap(lift);
  const currentLiftColors = LIFT_COLORS[lift];

  return (
    <div className="min-h-screen bg-v2-surface-950 text-v2-ink-50 pb-10">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 90% 60% at 50% 0%, rgba(122,15,24,0.12) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                5/3/1 · Summary
              </span>
            </div>
            <h1 className="font-v2-heading text-v2-2xl sm:text-v2-3xl font-bold uppercase tracking-tight leading-none mt-1">
              Quick Summary
            </h1>
          </div>
          {targetUid ? (
            <span className="inline-flex items-center gap-2 rounded-v2-full bg-v2-accent-950/50 border border-v2-accent-800 px-3 py-1 text-v2-xs font-v2-body font-semibold text-v2-accent-300 uppercase tracking-[0.18em]">
              Viewing {activeAthleteName}
            </span>
          ) : null}
        </header>

        {isCoach && !targetUid ? (
          <div className="rounded-v2-md border border-v2-warn-800 bg-v2-warn-950/50 px-4 py-3 text-v2-sm text-v2-warn-300">
            No athlete selected. You can still review the template numbers, or pick an athlete from the roster for personalized data.
          </div>
        ) : null}

        <section className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 shadow-v2-elev-2 overflow-hidden">
          <div className="px-5 py-4 border-b border-v2-surface-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-px w-5 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-300 uppercase tracking-[0.22em]">
                Today's Workout
              </span>
            </div>
            <span className="font-v2-mono tabular-nums text-v2-xs text-v2-ink-300 uppercase tracking-[0.18em]">
              Week {week}
            </span>
          </div>

          <div className="p-4 sm:p-5 space-y-4">
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(["bench", "squat", "deadlift"] as Lift[]).map((liftName) => {
                const isCompleted = completedLifts.has(liftName);
                const hasTM = profile?.tm?.[liftName];
                const isActive = lift === liftName;
                const colors = LIFT_COLORS[liftName];
                return (
                  <button
                    key={liftName}
                    className={`relative min-h-touch-lg rounded-v2-md border transition-colors duration-v2-quick py-3 px-2 ${
                      isActive
                        ? `${colors.border} ${colors.bg}`
                        : "border-v2-surface-800 bg-v2-surface-950 hover:border-v2-surface-700"
                    }`}
                    onClick={() => setLift(liftName)}
                    disabled={loadingSessions}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span
                        className={`font-v2-heading text-v2-sm font-semibold uppercase tracking-[0.14em] ${
                          isActive ? colors.text : "text-v2-ink-300"
                        }`}
                      >
                        {cap(liftName)}
                      </span>
                      {isCompleted ? (
                        <span className="font-v2-body text-v2-xs text-v2-success-300 uppercase tracking-[0.18em] font-semibold">
                          ✓ Done
                        </span>
                      ) : !hasTM ? (
                        <span className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.18em]">
                          Set TM
                        </span>
                      ) : (
                        <span className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.18em]">
                          Ready
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {profile?.tm?.[lift] ? (
              <button
                className="w-full min-h-touch-lg py-4 bg-v2-accent-700 hover:bg-v2-accent-800 active:bg-v2-accent-900 text-v2-ink-50 font-v2-heading text-v2-lg font-bold uppercase tracking-widest transition-colors duration-v2-quick rounded-v2-md shadow-v2-elev-2"
                onClick={() => {
                  const tmValue = profile.tm?.[lift];
                  if (!tmValue) return;
                  const params = new URLSearchParams({
                    lift,
                    week: String(week),
                    tm: String(tmValue),
                  });
                  navigate(`/session?${params.toString()}`);
                }}
              >
                Start {liftLabel}
              </button>
            ) : (
              <div className="rounded-v2-md border border-dashed border-v2-surface-700 py-4 text-center text-v2-sm text-v2-ink-500">
                Set a training max for {liftLabel} below to start your workout.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-4 sm:p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <div className="h-px w-5 bg-v2-info-700" />
              <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-300 uppercase tracking-[0.22em]">
                Week & Cycle
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] mb-1.5">
                Week
              </div>
              <div className="grid grid-cols-3 gap-2">
                {([1, 2, 3] as Week[]).map((w) => (
                  <button
                    key={w}
                    onClick={() => setWeek(w)}
                    className={`min-h-touch rounded-v2-sm border font-v2-heading font-semibold uppercase tracking-[0.14em] transition-colors duration-v2-quick ${
                      week === w
                        ? "border-v2-accent-600 bg-v2-accent-700 text-v2-ink-50"
                        : "border-v2-surface-800 bg-v2-surface-950 text-v2-ink-300 hover:border-v2-surface-700"
                    }`}
                  >
                    {w}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em] mb-1.5">
                Cycle
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCycle(c)}
                    className={`min-h-touch rounded-v2-sm border font-v2-heading font-semibold uppercase tracking-[0.14em] transition-colors duration-v2-quick ${
                      cycle === c
                        ? "border-v2-accent-600 bg-v2-accent-700 text-v2-ink-50"
                        : "border-v2-surface-800 bg-v2-surface-950 text-v2-ink-300 hover:border-v2-surface-700"
                    }`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className={`h-px w-5 ${currentLiftColors.accent}`} />
            <span className="font-v2-body text-v2-xs font-semibold text-v2-ink-300 uppercase tracking-[0.22em]">
              Training Max · {liftLabel}
            </span>
          </div>
          <div className="flex items-stretch gap-2">
            <input
              className="flex-1 min-h-touch rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 px-3 font-v2-mono tabular-nums text-v2-lg text-v2-ink-50 focus:border-v2-accent-600 focus:outline-none focus:ring-2 focus:ring-v2-accent-700/30"
              type="number"
              min={0}
              step="1"
              value={tm as any}
              onChange={(e) => setTm(e.target.value === "" ? "" : Number(e.target.value))}
              placeholder={`TM in ${unit}`}
            />
            <button
              className="min-h-touch px-5 bg-v2-accent-700 hover:bg-v2-accent-800 active:bg-v2-accent-900 text-v2-ink-50 font-v2-heading font-bold uppercase tracking-[0.18em] rounded-v2-sm transition-colors duration-v2-quick"
              onClick={saveTM}
            >
              Save
            </button>
            <div className="inline-flex items-center justify-center rounded-v2-sm border border-v2-surface-700 bg-v2-surface-950 px-3 font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-[0.2em]">
              {unit}
            </div>
          </div>
          <p className="font-v2-body text-v2-xs text-v2-ink-500">
            TM = heavy single you could hit for ~2–3 reps. Plate math rounds automatically.
          </p>
        </section>

        {typeof tm === "number" && (
          <section className="grid md:grid-cols-2 gap-4">
            <div className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-4 sm:p-5">
              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-px w-5 bg-v2-info-700" />
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-info-300 uppercase tracking-[0.22em]">
                    Warm Up
                  </span>
                </div>
              </div>
              <ul className="space-y-1.5 mb-5">
                {sessionPlan.warmups.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-v2-sm border border-v2-info-800 bg-v2-info-950/30 px-3 py-2"
                  >
                    <div className="font-v2-mono tabular-nums text-v2-xs text-v2-info-300">{s.pct}%</div>
                    <div className="font-v2-body text-v2-xs text-v2-ink-400">× {s.reps}</div>
                    <div className="font-v2-mono tabular-nums text-v2-lg font-bold text-v2-ink-50">
                      {s.weight} <span className="text-v2-xs text-v2-ink-500 font-v2-body">{unit}</span>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mb-3">
                <div className="flex items-center gap-2">
                  <div className="h-px w-5 bg-v2-accent-700" />
                  <span className="font-v2-body text-v2-xs font-semibold text-v2-accent-300 uppercase tracking-[0.22em]">
                    Work Sets
                  </span>
                </div>
              </div>
              <ul className="space-y-1.5">
                {sessionPlan.work.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded-v2-sm border border-v2-accent-800 bg-v2-accent-950/40 px-3 py-2"
                  >
                    <div className="font-v2-mono tabular-nums text-v2-xs text-v2-accent-300">{s.pct}%</div>
                    <div className="font-v2-body text-v2-xs font-bold text-v2-accent-300">× {s.reps}</div>
                    <div className="font-v2-mono tabular-nums text-v2-lg font-bold text-v2-ink-50">
                      {s.weight} <span className="text-v2-xs text-v2-ink-500 font-v2-body">{unit}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <div className="h-px w-5 bg-v2-warn-600" />
                <span className="font-v2-body text-v2-xs font-semibold text-v2-warn-300 uppercase tracking-[0.22em]">
                  Coach Tips
                </span>
              </div>
              <ul className="space-y-2 font-v2-body text-v2-sm text-v2-ink-200">
                <li className="flex gap-2">
                  <span className="text-v2-warn-500 font-bold">·</span>
                  Move fast. Rest 2–3 min on the big sets.
                </li>
                <li className="flex gap-2">
                  <span className="text-v2-warn-500 font-bold">·</span>
                  "+" means stop with 1–2 reps in the tank. No grinders.
                </li>
                <li className="flex gap-2">
                  <span className="text-v2-warn-500 font-bold">·</span>
                  After week 3, adjust TMs and start the next cycle.
                </li>
              </ul>
            </div>
          </section>
        )}

        {profile && (
          <section className="space-y-4 pt-4">
            <div className="flex items-center gap-2">
              <div className="h-px w-6 bg-v2-accent-700" />
              <span className="font-v2-body text-v2-xs text-v2-accent-300 uppercase tracking-[0.24em] font-semibold">
                Projection
              </span>
            </div>
            <h2 className="font-v2-heading text-v2-xl font-bold uppercase tracking-tight text-v2-ink-50">
              Program Projection
            </h2>

            {LIFTS.map((liftKey) => {
              const baseTm = deriveBaseTm(profile, liftKey);
              const increment = cycleIncrement(liftKey, unit);
              const roundStep = unit === "kg" ? 2.5 : 5;
              const colors = LIFT_COLORS[liftKey];

              return (
                <div
                  key={liftKey}
                  className="rounded-v2-lg border border-v2-surface-800 bg-v2-surface-900 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-v2-surface-800 flex items-center gap-2">
                    <div className={`h-px w-5 ${colors.accent}`} />
                    <span
                      className={`font-v2-heading text-v2-sm font-bold uppercase tracking-[0.22em] ${colors.text}`}
                    >
                      {cap(liftKey)}
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="border-b border-v2-surface-800">
                          <th className="px-3 sm:px-4 py-2 font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em]">
                            Cycle
                          </th>
                          <th className="px-3 sm:px-4 py-2 font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em]">
                            TM
                          </th>
                          <th className="px-3 sm:px-4 py-2 font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em]">
                            W1 (5+)
                          </th>
                          <th className="px-3 sm:px-4 py-2 font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em]">
                            W2 (3+)
                          </th>
                          <th className="px-3 sm:px-4 py-2 font-v2-body text-v2-xs text-v2-ink-500 uppercase tracking-[0.2em]">
                            W3 (1+)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3].map((cycleN) => {
                          const cycleTm = baseTm + (cycleN - 1) * increment;
                          const w1Top = roundToPlate(cycleTm * 0.85, unit, roundStep);
                          const w2Top = roundToPlate(cycleTm * 0.90, unit, roundStep);
                          const w3Top = roundToPlate(cycleTm * 0.95, unit, roundStep);

                          return (
                            <tr key={cycleN} className="border-b border-v2-surface-800 last:border-b-0">
                              <td className="px-3 sm:px-4 py-2.5 font-v2-body text-v2-sm font-semibold text-v2-ink-100">
                                C{cycleN}
                              </td>
                              <td className="px-3 sm:px-4 py-2.5 font-v2-mono tabular-nums text-v2-sm text-v2-ink-300">
                                {Math.round(cycleTm)}
                              </td>
                              <td className="px-3 sm:px-4 py-2.5 font-v2-mono tabular-nums text-v2-sm font-bold text-v2-ink-50">
                                {w1Top}{" "}
                                <span className="font-v2-body font-normal text-v2-ink-500 text-v2-xs">
                                  ×5+
                                </span>
                              </td>
                              <td className="px-3 sm:px-4 py-2.5 font-v2-mono tabular-nums text-v2-sm font-bold text-v2-ink-50">
                                {w2Top}{" "}
                                <span className="font-v2-body font-normal text-v2-ink-500 text-v2-xs">
                                  ×3+
                                </span>
                              </td>
                              <td className="px-3 sm:px-4 py-2.5 font-v2-mono tabular-nums text-v2-sm font-bold text-v2-ink-50">
                                {w3Top}{" "}
                                <span className="font-v2-body font-normal text-v2-ink-500 text-v2-xs">
                                  ×1+
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}

function cap(s: string) {
  return s[0].toUpperCase() + s.slice(1);
}
