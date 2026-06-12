import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  createUserWithEmailAndPassword,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
import {
  COACH_AUTH_VIA_FUNCTION,
  CoachAuthRateLimitError,
  CoachPasscodeError,
  claimCoachRole,
} from "../lib/coachAuth";
import {
  AthleteAuthError,
  TEAM_DEFINITIONS,
  buildAthleteEmail,
  ensureAdminRole,
  ensureAnon,
  ensureCoachRoleOnly,
  fb,
  fetchCoachTeamScopes,
  refreshRoles,
  getStoredTeamSelection,
  loadProfileRemote,
  normalizePasscodeDigits,
  saveProfile,
  setStoredTeamSelection,
  setStoredTeamScopes,
  signInOrCreateAthleteAccount,
  updateCoachTeamScope,
  type Team,
  type RolesDocument,
} from "../lib/db";
import { doc, getDoc } from "firebase/firestore";
import { useOrg } from "../context/OrgContext";

// ── Logic forked from SignIn.tsx (v1). V2 diverges: team selection is
//    preserved on failed sign-in attempts, and messages are sentence case. ──

const updateDisplayNameCache = (name: string) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem("pl-strength-display-name", name);
    window.dispatchEvent(new CustomEvent("pl-display-name-change", { detail: name }));
  }
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRoleSync = async (uid: string, expectAdmin: boolean): Promise<void> => {
  const maxAttempts = expectAdmin ? 6 : 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const roles = await refreshRoles(uid);
    const hasRole = expectAdmin ? roles.includes("admin") : roles.includes("coach");
    if (hasRole) return;
    await delay(200 * (attempt + 1));
  }
  throw new Error(expectAdmin ? "admin-sync-failed" : "coach-sync-failed");
};

type Mode = "athlete" | "coach";
type StatusMessage = { kind: "success" | "error"; text: string } | null;

function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const coachPasscodeFromEnv = (import.meta.env.VITE_COACH_PASSCODE ?? "2468").toString().trim();
const adminCoachPasscodeFromEnv = (import.meta.env.VITE_ADMIN_COACH_PASSCODE ?? "1357").toString().trim();
const normalizeCoachPasscode = (value: string) => value.trim().toUpperCase();
const coachPassword = (code: string) => `${code}coach!`;
const buildCoachEmail = (firstName: string, lastName: string): string => {
  const canonical = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, "");
  return `coach-${canonical}@pl.strength`;
};
const TEAM_OPTIONS: Array<{ label: string; value: Team | "" }> = [
  { label: "Select a team", value: "" },
  ...TEAM_DEFINITIONS.map((definition) => ({
    label: definition.label,
    value: definition.id,
  })),
];

export default function SignInV2() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { org } = useOrg();
  const [mode, setMode] = useState<Mode | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [team, setTeam] = useState<Team | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);

  const auth = fb.auth;

  useEffect(() => {
    const initial = searchParams.get("mode");
    if (initial === "athlete" || initial === "coach") {
      chooseSignInMode(initial as Mode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    if (!org) {
      setMessage({ kind: "error", text: "Select your school or team first." });
      navigate("/", { replace: true });
    } else if (message?.kind === "error" && message.text.includes("Select your school")) {
      setMessage(null);
    }
  }, [org, message, navigate]);

  const athleteEmail = useMemo(() => {
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    if (!safeFirst || !safeLast) return "";
    return buildAthleteEmail(safeFirst, safeLast);
  }, [firstName, lastName]);

  const coachEmail = useMemo(() => {
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    if (!safeFirst || !safeLast) return "";
    return buildCoachEmail(safeFirst, safeLast);
  }, [firstName, lastName]);

  const selectedTeamLabel = useMemo(() => {
    if (!team) return "No Team Selected Yet";
    return TEAM_DEFINITIONS.find((definition) => definition.id === team)?.label ?? team;
  }, [team]);

  const disabled = submitting;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = getStoredTeamSelection();
    if (stored) setTeam(stored);
  }, []);

  useEffect(() => {
    if (mode === null) {
      setTeam("");
    } else {
      setTeam(getStoredTeamSelection());
    }
    setPasscode("");
  }, [mode]);

  const resetSharedState = () => {
    setMessage(null);
    setSubmitting(false);
    setPasscode("");
  };

  const chooseSignInMode = (nextMode: Mode) => {
    resetSharedState();
    setFirstName("");
    setLastName("");
    setTeam(getStoredTeamSelection());
    setMode(nextMode);
  };

  const backToChooser = () => {
    resetSharedState();
    setFirstName("");
    setLastName("");
    setTeam("");
    setMode(null);
  };

  const persistProfile = async (
    uid: string | undefined,
    first: string,
    last: string,
    teamSelection: Team | ""
  ) => {
    if (!uid) return;
    const base = await loadProfileRemote(uid);
    const resolvedTeam = teamSelection ? teamSelection : base?.team;
    await saveProfile({
      uid,
      firstName: first,
      lastName: last,
      unit: base?.unit ?? "lb",
      team: resolvedTeam,
      tm: base?.tm ?? {},
      oneRm: base?.oneRm ?? {},
      accessCode: base?.accessCode ?? null,
      equipment: base?.equipment,
      liftWeeks: base?.liftWeeks,
      liftCycles: base?.liftCycles,
      currentWeek: base?.currentWeek ?? 1,
      currentCycle: base?.currentCycle ?? 1,
    }, { requireRemote: true });
    setStoredTeamSelection(resolvedTeam ?? "");
    updateDisplayNameCache(`${first} ${last}`);
  };

  const handleAthleteSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) { setMessage({ kind: "error", text: "Sign-in is unavailable right now. Check your connection and try again." }); return; }
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    const digits = normalizePasscodeDigits(passcode);
    if (!safeFirst || !safeLast) { setMessage({ kind: "error", text: "Enter your first and last name." }); return; }
    if (digits.length !== 4) {
      setMessage({ kind: "error", text: "Your passcode must be 4 digits. Ask your coach if you forgot it." });
      return;
    }
    if (!team) { setMessage({ kind: "error", text: "Select your team before signing in." }); return; }
    setSubmitting(true);
    setMessage(null);
    try {
      const { profile } = await signInOrCreateAthleteAccount({ firstName: safeFirst, lastName: safeLast, passcodeDigits: digits, team });
      const resolvedTeam = (team || profile.team) as Team | "";
      setStoredTeamSelection(resolvedTeam ?? "");
      if (profile.teamScopes && profile.teamScopes.length > 0) {
        setStoredTeamScopes(profile.teamScopes);
      } else if (resolvedTeam) {
        setStoredTeamScopes([resolvedTeam]);
      }
      updateDisplayNameCache(`${profile.firstName} ${profile.lastName}`.trim());
      setMessage({ kind: "success", text: "Signed in! You're ready to train." });
      navigate("/", { replace: true });
    } catch (err: any) {
      if (err instanceof AthleteAuthError) {
        if (err.code === "auth/wrong-password") {
          setMessage({ kind: "error", text: "That passcode doesn't match. Ask your coach if you need help." });
        } else if (err.code === "athlete-code/taken") {
          setMessage({ kind: "error", text: "That code is already being used by another athlete. Ask your coach for a unique code." });
        } else if (err.code === "athlete-code/unavailable") {
          setMessage({ kind: "error", text: "We couldn't verify that code. Try again in a moment." });
        } else if (err.code === "auth/unavailable") {
          setMessage({ kind: "error", text: "Sign-in is unavailable right now. Check your connection and try again." });
        } else {
          setMessage({ kind: "error", text: err.message || "We couldn't sign you in." });
        }
      } else {
        const code = (err as AuthError)?.code;
        const text = code === "auth/email-already-in-use"
          ? "That athlete already exists. Double-check spelling or the passcode."
          : (err?.message ?? "We couldn't sign you in.");
        setMessage({ kind: "error", text });
      }
    } finally {
      // Clear the passcode for retry, but KEEP the team selection —
      // resetting it after a typo'd passcode forced athletes to re-pick
      // their team and hit a confusing second error.
      setPasscode("");
      setSubmitting(false);
    }
  };

  // Shared tail of both coach sign-in paths: resolve team scopes, persist
  // the profile, and land on the dashboard.
  const completeCoachSignIn = async (
    userUid: string,
    allowedTeamsSeed: Team[],
    safeFirst: string,
    safeLast: string
  ) => {
    let allowedTeams = allowedTeamsSeed;
    if (allowedTeams.length === 0 && team) allowedTeams = [team as Team];
    try {
      const freshTeamScopes = await fetchCoachTeamScopes(userUid);
      if (freshTeamScopes.length > 0) allowedTeams = freshTeamScopes;
    } catch (err) { console.warn("Failed to fetch coach team scopes", err); }
    setStoredTeamScopes(allowedTeams);
    const resolvedActiveTeam = team && allowedTeams.includes(team as Team)
      ? (team as Team)
      : allowedTeams[0] ?? team ?? "";
    setStoredTeamSelection(resolvedActiveTeam ?? "");
    try {
      await persistProfile(userUid, safeFirst, safeLast, team);
    } catch (err) {
      console.warn("Failed to persist coach profile", err);
    } finally {
      setPasscode("");
      setSubmitting(false);
    }
    navigate("/", { replace: true });
  };

  const handleCoachSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) { setMessage({ kind: "error", text: "Sign-in is unavailable right now. Check your connection and try again." }); return; }
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    if (!safeFirst || !safeLast) { setMessage({ kind: "error", text: "Enter your first and last name." }); return; }
    if (!team) { setMessage({ kind: "error", text: "Select your team before signing in." }); return; }
    const email = buildCoachEmail(safeFirst, safeLast);
    const entered = normalizeCoachPasscode(passcode);
    if (!entered) { setMessage({ kind: "error", text: "Enter the coach passcode." }); return; }

    // ── Server-verified path (preferred). The Cloud Function checks the
    //    passcode against Secret Manager, grants the role with the Admin SDK,
    //    and returns a custom token. Wrong passcode is authoritative; an
    //    unreachable function falls through to the legacy flow below.
    if (COACH_AUTH_VIA_FUNCTION) {
      setSubmitting(true);
      setMessage(null);
      try {
        const claim = await claimCoachRole({
          firstName: safeFirst,
          lastName: safeLast,
          passcode: entered,
        });
        const credential = await signInWithCustomToken(auth, claim.token);
        try { await refreshRoles(credential.user.uid); } catch (err) {
          console.warn("Failed to refresh roles after server claim", err);
        }
        let seedScopes = claim.teamScopes.filter(Boolean) as Team[];
        if (team && !seedScopes.includes(team as Team)) {
          seedScopes = [...seedScopes, team as Team];
        }
        await completeCoachSignIn(credential.user.uid, seedScopes, safeFirst, safeLast);
        return;
      } catch (err: any) {
        if (err instanceof CoachPasscodeError) {
          setMessage({ kind: "error", text: "That passcode doesn't match. Check with your admin for the current coach code." });
          setSubmitting(false);
          return;
        }
        if (err instanceof CoachAuthRateLimitError) {
          setMessage({ kind: "error", text: err.message });
          setSubmitting(false);
          return;
        }
        console.warn("Server coach sign-in unavailable; using legacy sign-in", err);
        setSubmitting(false);
      }
    }

    // ── Legacy path (fallback during rollout; killswitch target) ──────────
    if (!coachPasscodeFromEnv) {
      setMessage({ kind: "error", text: "The coach passcode is not configured. Ask an admin to set VITE_COACH_PASSCODE." });
      return;
    }
    const expected = normalizeCoachPasscode(coachPasscodeFromEnv);
    const adminExpected = adminCoachPasscodeFromEnv ? normalizeCoachPasscode(adminCoachPasscodeFromEnv) : null;
    const isAdminOverride = adminExpected ? entered === adminExpected : false;
    if (entered !== expected && !isAdminOverride) {
      setMessage({ kind: "error", text: "That passcode doesn't match. Check with your admin for the current coach code." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    const standardPassword = coachPassword(expected);
    const enteredPassword = coachPassword(entered);
    const password = isAdminOverride ? standardPassword : enteredPassword;
    let userUid: string | undefined;
    try {
      await signInWithEmailAndPassword(auth, email, password);
      userUid = auth.currentUser?.uid ?? undefined;
    } catch (err: any) {
      const error = err as AuthError;
      const shouldCreate = error.code === "auth/user-not-found" || error.code === "auth/invalid-credential";
      if (shouldCreate) {
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          userUid = cred.user.uid;
        } catch (createErr: any) {
          const code = (createErr as AuthError)?.code;
          if (code === "auth/email-already-in-use") {
            try {
              const cred = await signInWithEmailAndPassword(auth, email, password);
              userUid = cred.user.uid;
            } catch (retryErr: any) {
              setMessage({ kind: "error", text: (retryErr as AuthError)?.message ?? "We couldn't sign you in with the existing coach account. Ask an admin to reset the coach passcode." });
              setSubmitting(false);
              return;
            }
          } else {
            setMessage({ kind: "error", text: createErr?.message ?? "We couldn't create the account." });
            setSubmitting(false);
            return;
          }
        }
      } else if (error.code === "auth/wrong-password") {
        setMessage({ kind: "error", text: "That passcode doesn't match. Ask your admin for the current coach code." });
        setSubmitting(false);
        return;
      } else {
        setMessage({ kind: "error", text: error.message ?? "We couldn't sign you in." });
        setSubmitting(false);
        return;
      }
    }
    if (!userUid) { setSubmitting(false); return; }
    try { await ensureAnon(); } catch (err) { console.warn("Failed to confirm Firebase auth state", err); }
    try {
      if (isAdminOverride) {
        await ensureAdminRole();
      } else {
        await ensureCoachRoleOnly();
      }
      await waitForRoleSync(userUid, isAdminOverride);
    } catch (err: any) {
      console.warn("Failed to ensure coach/admin role", err);
      setMessage({
        kind: "error",
        text: isAdminOverride
          ? "Signed in, but we couldn't confirm admin access. Try the admin code again or contact support."
          : "Signed in, but we couldn't update coach permissions. Ask an admin to confirm the Firebase configuration.",
      });
      setSubmitting(false);
      return;
    }
    let allowedTeams: Team[] = [];
    try {
      const database = fb.db;
      if (!database) throw new Error("Firebase not available");
      const ref = doc(database, "roles", userUid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as RolesDocument;
        const history = data.accessHistory?.[entered];
        if (history && history.teamScopes && history.teamScopes.length > 0) {
          allowedTeams = history.teamScopes as Team[];
          if (team && !allowedTeams.includes(team as Team)) {
            allowedTeams = [...allowedTeams, team as Team];
          }
        }
      }
    } catch (err) { console.warn("Failed to check previous team scopes", err); }
    await completeCoachSignIn(userUid, allowedTeams, safeFirst, safeLast);
  };

  // ── V2 JSX ─────────────────────────────────────────────────────────────────

  // field-v2 defaults to light bg; this screen is always dark-first so force with !important
  const fieldCls =
    "field-v2 !bg-v2-surface-900 !border-v2-surface-700 !text-v2-ink-100 placeholder:!text-v2-ink-600";

  return (
    <div className="min-h-screen flex flex-col bg-v2-surface-950 overflow-y-auto">
      {/* Subtle radial glow matching Welcome screen */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(122,15,24,0.16) 0%, transparent 65%)",
        }}
      />

      <div className="relative z-10 flex flex-col flex-1 w-full max-w-md mx-auto px-gutter-mobile">
        {/* ── Mode Chooser ──────────────────────────────────────────── */}
        {mode === null ? (
          <div className="flex flex-col flex-1 justify-center gap-8 py-14">
            {/* Brand header */}
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-v2-xl bg-v2-surface-900 border border-v2-surface-700 mx-auto">
                <img src="/assets/dragon.png" alt="" className="w-11 h-11 object-contain opacity-80" />
              </div>
              <div className="space-y-1">
                <h1 className="font-v2-heading text-v2-2xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none">
                  Purchase Line Strength
                </h1>
                <p className="font-v2-body text-v2-sm text-v2-ink-500">
                  Choose how you want to log in
                </p>
              </div>
            </div>

            {/* Mode buttons */}
            <div className="space-y-3">
              {/* Athlete — primary audience, accent-primary */}
              <button
                type="button"
                onClick={() => chooseSignInMode("athlete")}
                className="btn-v2-primary w-full min-h-touch-lg font-v2-heading text-v2-lg uppercase tracking-widest"
              >
                Athlete Login
              </button>

              {/* Coach — secondary, surface treatment */}
              <button
                type="button"
                onClick={() => chooseSignInMode("coach")}
                className="inline-flex items-center justify-center gap-2 w-full min-h-touch-lg rounded-v2-lg bg-v2-surface-900 text-v2-ink-200 border border-v2-surface-700 font-v2-heading text-v2-lg uppercase tracking-widest font-semibold transition-colors duration-v2-quick hover:bg-v2-surface-800 hover:text-v2-ink-50 hover:border-v2-surface-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-accent-500 focus-visible:ring-offset-2 focus-visible:ring-offset-v2-surface-950"
              >
                Coach Login
              </button>
            </div>
          </div>
        ) : (
          /* ── Form View ──────────────────────────────────────────────── */
          <div className="flex flex-col flex-1 gap-5 py-8">
            {/* Top bar: back + mode badge */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={backToChooser}
                disabled={disabled}
                className="inline-flex items-center gap-1.5 font-v2-body text-v2-sm font-semibold text-v2-ink-400 hover:text-v2-ink-100 transition-colors duration-v2-quick disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v2-accent-500 rounded-v2-sm px-1"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>

              <span
                className={`font-v2-body text-v2-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-v2-full border ${
                  mode === "athlete"
                    ? "bg-v2-accent-900/40 text-v2-accent-300 border-v2-accent-800/60"
                    : "bg-v2-surface-800 text-v2-ink-400 border-v2-surface-600"
                }`}
              >
                {mode === "athlete" ? "Athlete" : "Coach"}
              </span>
            </div>

            {/* Heading */}
            <div className="space-y-1">
              <h2 className="font-v2-heading text-v2-2xl font-bold text-v2-ink-50 uppercase tracking-tight leading-none">
                {mode === "athlete" ? "Let's Train" : "Welcome Back, Coach"}
              </h2>
              <p className="font-v2-body text-v2-sm text-v2-ink-500">
                {mode === "athlete"
                  ? "Enter your info to access your program"
                  : "Enter your credentials to manage your team"}
              </p>
            </div>

            {/* Status message */}
            {message && (
              <div
                className={`flex items-start gap-3 px-4 py-3 rounded-v2-lg border-l-[3px] font-v2-body text-v2-sm font-medium ${
                  message.kind === "success"
                    ? "bg-v2-success-950/60 text-v2-success-300 border-v2-success-600 ring-1 ring-v2-success-900/60"
                    : "bg-v2-danger-950/60 text-v2-danger-300 border-v2-danger-600 ring-1 ring-v2-danger-900/60"
                }`}
              >
                {message.text}
              </div>
            )}

            {/* ── Athlete Form ── */}
            {mode === "athlete" ? (
              <form className="flex flex-col gap-4 flex-1" onSubmit={handleAthleteSignIn}>
                {/* Name row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="athlete-first-name" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                      First Name
                    </label>
                    <input
                      id="athlete-first-name"
                      className={fieldCls}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jordan"
                      autoComplete="given-name"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="athlete-last-name" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                      Last Name
                    </label>
                    <input
                      id="athlete-last-name"
                      className={fieldCls}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Taylor"
                      autoComplete="family-name"
                      disabled={disabled}
                    />
                  </div>
                </div>

                {/* Team */}
                <div className="space-y-1.5">
                  <label htmlFor="athlete-team" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                    Team
                  </label>
                  <select
                    id="athlete-team"
                    className={fieldCls}
                    value={team}
                    onChange={(e) => setTeam(e.target.value as Team | "")}
                    disabled={disabled}
                  >
                    {TEAM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value} style={{ background: "#0F172A", color: "#F1F5F9" }}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Passcode */}
                <div className="space-y-1.5">
                  <label htmlFor="athlete-passcode" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                    4-Digit Team Code
                  </label>
                  <input
                    id="athlete-passcode"
                    className={`${fieldCls} font-v2-mono tracking-[0.35em] text-center text-v2-xl v2-tabular`}
                    type="tel"
                    value={passcode}
                    onChange={(e) => setPasscode(normalizePasscodeDigits(e.target.value))}
                    placeholder="· · · ·"
                    inputMode="numeric"
                    maxLength={4}
                    disabled={disabled}
                  />
                </div>

                {/* Email preview */}
                {athleteEmail && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-v2-md bg-v2-surface-900/50 border border-v2-surface-800">
                    <span className="font-v2-body text-v2-xs text-v2-ink-500 shrink-0">Login email:</span>
                    <span className="font-v2-mono text-v2-xs text-v2-ink-300 truncate">{athleteEmail}</span>
                  </div>
                )}

                <div className="mt-auto pt-2">
                  <button
                    type="submit"
                    className="btn-v2-primary w-full min-h-touch-lg font-v2-heading text-v2-lg uppercase tracking-widest"
                    disabled={disabled}
                  >
                    {submitting ? "Signing In…" : "Sign In"}
                  </button>
                </div>
              </form>
            ) : (
              /* ── Coach Form ── */
              <form className="flex flex-col gap-4 flex-1" onSubmit={handleCoachSignIn}>
                {/* Name row */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label htmlFor="coach-first-name" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                      First Name
                    </label>
                    <input
                      id="coach-first-name"
                      className={fieldCls}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jordan"
                      autoComplete="given-name"
                      disabled={disabled}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="coach-last-name" className="font-v2-body text-v2-ink-400 text-v2-xs uppercase tracking-wider font-semibold block">
                      Last Name
                    </label>
                    <input
                      id="coach-last-name"
                      className={fieldCls}
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Taylor"
                      autoComplete="family-name"
                      disabled={disabled}
                    />
                  </div>
                </div>

                {/* Team */}
                <div className="space-y-1.5">
                  <label htmlFor="coach-team" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                    Team
                  </label>
                  <select
                    id="coach-team"
                    className={fieldCls}
                    value={team}
                    onChange={(e) => setTeam(e.target.value as Team | "")}
                    disabled={disabled}
                  >
                    {TEAM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value} style={{ background: "#0F172A", color: "#F1F5F9" }}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Coach passcode */}
                <div className="space-y-1.5">
                  <label htmlFor="coach-passcode" className="font-v2-body text-v2-xs text-v2-ink-400 uppercase tracking-wider font-semibold block">
                    Coach Passcode
                  </label>
                  <input
                    id="coach-passcode"
                    className={`${fieldCls} font-v2-mono tracking-[0.25em] text-center text-v2-xl`}
                    value={passcode}
                    onChange={(e) => setPasscode(normalizeCoachPasscode(e.target.value))}
                    placeholder="FIREUP"
                    maxLength={16}
                    disabled={disabled}
                  />
                  <p className="font-v2-body text-v2-xs text-v2-ink-600 text-center">
                    Ask your program admin for the coach passcode
                  </p>
                </div>

                {/* Email preview */}
                {coachEmail && (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-v2-md bg-v2-surface-900/50 border border-v2-surface-800">
                    <span className="font-v2-body text-v2-xs text-v2-ink-500 shrink-0">Coach email:</span>
                    <span className="font-v2-mono text-v2-xs text-v2-ink-300 truncate">{coachEmail}</span>
                  </div>
                )}

                <div className="mt-auto pt-2" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}>
                  <button
                    type="submit"
                    className="btn-v2-primary w-full min-h-touch-lg font-v2-heading text-v2-lg uppercase tracking-widest"
                    disabled={disabled}
                  >
                    {submitting ? "Signing In…" : "Sign In as Coach"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
