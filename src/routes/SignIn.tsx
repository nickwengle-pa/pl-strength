import React, { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
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

type Mode = "athlete" | "coach";

type StatusMessage = { kind: "success" | "error"; text: string } | null;

function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

const coachPasscodeFromEnv = (
  import.meta.env.VITE_COACH_PASSCODE ?? "2468"
)
  .toString()
  .trim();
const adminCoachPasscodeFromEnv = (
  import.meta.env.VITE_ADMIN_COACH_PASSCODE ?? "1357"
)
  .toString()
  .trim();
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitForRoleSync = async (uid: string, expectAdmin: boolean) => {
  const maxAttempts = expectAdmin ? 6 : 4;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const roles = await refreshRoles(uid);
    const hasRole = expectAdmin ? roles.includes("admin") : roles.includes("coach");
    if (hasRole) {
      return roles;
    }
    await delay(150 * (attempt + 1));
  }
  throw new Error(expectAdmin ? "admin-sync-failed" : "coach-sync-failed");
};

const updateDisplayNameCache = (name: string | null) => {
  if (typeof window === "undefined") return;
  if (name && name.trim()) {
    window.localStorage.setItem("pl-strength-display-name", name.trim());
  } else {
    window.localStorage.removeItem("pl-strength-display-name");
  }
  window.dispatchEvent(
    new CustomEvent<string | null>("pl-display-name-change", { detail: name?.trim() ?? null })
  );
};

export default function SignIn() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [team, setTeam] = useState<Team | "">("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);

  const auth = fb.auth;

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


  const disabled = submitting;

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = getStoredTeamSelection();
    if (stored) {
      setTeam(stored);
    }
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
    });

    setStoredTeamSelection(resolvedTeam ?? "");

    updateDisplayNameCache(`${first} ${last}`);
  };

  const handleAthleteSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) {
      setMessage({ kind: "error", text: "Firebase auth is unavailable." });
      return;
    }
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    const digits = normalizePasscodeDigits(passcode);

    if (!safeFirst || !safeLast) {
      setMessage({ kind: "error", text: "Enter first and last name." });
      return;
    }
    if (digits.length !== 4) {
      setMessage({
        kind: "error",
        text: "Passcode must be 4 digits. Ask your coach if you forgot it.",
      });
      return;
    }

    if (!team) {
      setMessage({ kind: "error", text: "Select your team before signing in." });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const { profile } = await signInOrCreateAthleteAccount({
        firstName: safeFirst,
        lastName: safeLast,
        passcodeDigits: digits,
        team,
      });

      setStoredTeamSelection(profile.team ?? "");
      updateDisplayNameCache(`${profile.firstName} ${profile.lastName}`.trim());
      setMessage({
        kind: "success",
        text: "Signed in! You're ready to train.",
      });
    } catch (err: any) {
      if (err instanceof AthleteAuthError) {
        if (err.code === "auth/wrong-password") {
          setMessage({
            kind: "error",
            text: "Passcode does not match. Ask your coach if you need help.",
          });
        } else if (err.code === "athlete-code/taken") {
          setMessage({
            kind: "error",
            text: "That code is already being used by another athlete. Ask your coach for a unique code.",
          });
        } else if (err.code === "athlete-code/unavailable") {
          setMessage({
            kind: "error",
            text: "We couldn't verify that code. Try again in a moment.",
          });
        } else if (err.code === "auth/unavailable") {
          setMessage({
            kind: "error",
            text: "Firebase auth is unavailable.",
          });
        } else {
          setMessage({
            kind: "error",
            text: err.message || "We could not sign you in.",
          });
        }
      } else {
        const code = (err as AuthError)?.code;
        const text =
          code === "auth/email-already-in-use"
            ? "That athlete already exists. Double-check spelling or the passcode."
            : (err?.message ?? "We could not sign you in.");
        setMessage({ kind: "error", text });
      }
    } finally {
      setPasscode("");
      setTeam("");
      setSubmitting(false);
    }
  };

const handleCoachSignIn = async (event: React.FormEvent) => {
  event.preventDefault();
  if (!auth) {
    setMessage({ kind: "error", text: "Firebase auth is unavailable." });
    return;
  }
  if (!coachPasscodeFromEnv) {
    setMessage({
      kind: "error",
      text: "Coach passcode is not configured. Ask an admin to set VITE_COACH_PASSCODE.",
    });
    return;
  }

  const safeFirst = sanitizeName(firstName);
  const safeLast = sanitizeName(lastName);
  if (!safeFirst || !safeLast) {
    setMessage({ kind: "error", text: "Enter first and last name." });
    return;
  }
  if (!team) {
    setMessage({ kind: "error", text: "Select your team before signing in." });
    return;
  }

  const email = buildCoachEmail(safeFirst, safeLast);
  const entered = normalizeCoachPasscode(passcode);
  if (!entered) {
    setMessage({ kind: "error", text: "Enter the coach passcode." });
    return;
  }
  const expected = normalizeCoachPasscode(coachPasscodeFromEnv);
  const adminExpected = adminCoachPasscodeFromEnv
    ? normalizeCoachPasscode(adminCoachPasscodeFromEnv)
    : null;
  const isAdminOverride = adminExpected ? entered === adminExpected : false;

  if (entered !== expected && !isAdminOverride) {
    setMessage({
      kind: "error",
      text: "That passcode does not match. Check with your admin for the current coach code.",
    });
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
    const shouldCreate =
      error.code === "auth/user-not-found" || error.code === "auth/invalid-credential";

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
            const text =
              (retryErr as AuthError)?.message ??
              "We could not sign you in with the existing coach account. Ask an admin to reset the coach passcode.";
            setMessage({ kind: "error", text });
            setSubmitting(false);
            return;
          }
        } else {
          const text = createErr?.message ?? "We could not create the account.";
          setMessage({ kind: "error", text });
          setSubmitting(false);
          return;
        }
      }
    } else if (error.code === "auth/wrong-password") {
      setMessage({
        kind: "error",
        text: "Passcode does not match. Ask your admin for the current coach code.",
      });
      setSubmitting(false);
      return;
    } else {
      setMessage({
        kind: "error",
        text: error.message ?? "We could not sign you in.",
      });
      setSubmitting(false);
      return;
    }
  }

  if (!userUid) {
    setSubmitting(false);
    return;
  }

  try {
    await ensureAnon();
  } catch (err) {
    console.warn("Failed to confirm Firebase auth state", err);
  }

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
        ? "Signed in, but we could not confirm admin access. Try the admin code again or contact support."
        : "Signed in, but we could not update coach permissions in Firestore. Ask an admin to confirm Firebase configuration.",
    });
  }

  let allowedTeams: Team[] = [];

  // First check if this access code has previous team scopes
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
        // If current team is valid, add it if not present
        if (team && !allowedTeams.includes(team as Team)) {
          allowedTeams = [...allowedTeams, team as Team];
        }
      }
    }
  } catch (err) {
    console.warn("Failed to check previous team scopes", err);
  }

  // If no history, use current team
  if (allowedTeams.length === 0 && team) {
    allowedTeams = [team as Team];
  }

  // NOTE: updateCoachTeamScope disabled - team scopes validation removed from Firestore rules
  // try {
  //   await updateCoachTeamScope(team, entered);
  // } catch (err) {
  //   console.warn("Failed to update coach team scope", err);
  // }

  try {
    const freshTeamScopes = await fetchCoachTeamScopes(userUid);
    if (freshTeamScopes.length > 0) {
      allowedTeams = freshTeamScopes;
    }
  } catch (err) {
    console.warn("Failed to fetch coach team scopes", err);
  }

  setStoredTeamScopes(allowedTeams);
  const resolvedActiveTeam =
    team && allowedTeams.includes(team as Team)
      ? (team as Team)
      : allowedTeams[0] ?? team ?? "";
  setStoredTeamSelection(resolvedActiveTeam ?? "");

  try {
    await persistProfile(userUid, safeFirst, safeLast, team);
  } catch (err) {
    console.warn("Failed to persist coach profile", err);
  } finally {
    setPasscode("");
    setTeam("");
    setSubmitting(false);
  }
};

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-4xl space-y-8">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <img
              src="/assets/dragon.png"
              alt="PL Strength logo"
              className="h-24 w-24 rounded-full border border-gray-200 bg-white object-contain shadow-soft"
            />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">PL Strength Sign In</h1>
          <p className="text-sm text-gray-600">Choose how you want to log in to start training.</p>
        </div>

        {mode === null ? (
          <div className="grid gap-6 md:grid-cols-2">
            <button
              type="button"
              onClick={() => chooseSignInMode("athlete")}
              disabled={disabled}
              className="group flex flex-col items-center justify-center gap-1 rounded-3xl border border-rose-200 bg-rose-100/80 p-12 text-center transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="text-3xl font-extrabold uppercase tracking-wide text-rose-700">
                Athlete
              </span>
              <span className="text-3xl font-extrabold uppercase tracking-wide text-rose-700">
                Login
              </span>
            </button>
            <button
              type="button"
              onClick={() => chooseSignInMode("coach")}
              disabled={disabled}
              className="group flex flex-col items-center justify-center gap-1 rounded-3xl border border-rose-200 bg-rose-100/80 p-12 text-center transition hover:-translate-y-1 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500 disabled:pointer-events-none disabled:opacity-60"
            >
              <span className="text-3xl font-extrabold uppercase tracking-wide text-rose-700">
                Coach
              </span>
              <span className="text-3xl font-extrabold uppercase tracking-wide text-rose-700">
                Login
              </span>
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-3xl shadow-soft p-6 md:p-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:text-brand-900 disabled:opacity-50"
                onClick={backToChooser}
                disabled={disabled}
              >
                <span aria-hidden="true">?</span>
                Choose a different login
              </button>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {mode === "athlete" ? "Athlete Sign In" : "Coach Sign In"}
                </p>
                <p className="text-sm text-gray-700">
                  {mode === "athlete"
                    ? "Use your team code to get started."
                    : "Use the shared passcode from your program admin."}
                </p>
              </div>
            </div>

            {message && (
              <div
                className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
                  message.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {message.text}
              </div>
            )}

            {mode === "athlete" ? (
              <form className="space-y-4" onSubmit={handleAthleteSignIn}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                    First name
                    <input
                      className="field"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jordan"
                      autoComplete="given-name"
                      disabled={disabled}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                    Last name
                    <input
                      className="field"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Taylor"
                      autoComplete="family-name"
                      disabled={disabled}
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  Team
                  <select
                    className="field"
                    value={team}
                    onChange={(e) => setTeam(e.target.value as Team | "")}
                    disabled={disabled}
                  >
                    {TEAM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  4-digit team code
                  <input
                    className="field tracking-widest text-center text-base"
                    type="tel"
                    value={passcode}
                    onChange={(e) => setPasscode(normalizePasscodeDigits(e.target.value))}
                    placeholder="1234"
                    inputMode="numeric"
                    maxLength={4}
                    disabled={disabled}
                  />
                </label>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  Team email we will use:{" "}
                  <span className="font-semibold text-gray-900">
                    {athleteEmail || "firstlast@pl.strength"}
                  </span>
                  . No real inbox required - coaches manage the codes.
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-full justify-center py-3 text-base"
                  disabled={disabled}
                >
                  {submitting && mode === "athlete" ? "Signing in..." : "Sign in"}
                </button>
              </form>
            ) : (
              <form className="space-y-4" onSubmit={handleCoachSignIn}>
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                    First name
                    <input
                      className="field"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="Jordan"
                      autoComplete="given-name"
                      disabled={disabled}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                    Last name
                    <input
                      className="field"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Taylor"
                      autoComplete="family-name"
                      disabled={disabled}
                    />
                  </label>
                </div>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  Team
                  <select
                    className="field"
                    value={team}
                    onChange={(e) => setTeam(e.target.value as Team | "")}
                    disabled={disabled}
                  >
                    {TEAM_OPTIONS.map((opt) => (
                      <option key={opt.label} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                  Coach passcode
                  <input
                    className="field tracking-widest text-center text-base"
                    value={passcode}
                    onChange={(e) => setPasscode(normalizeCoachPasscode(e.target.value))}
                    placeholder="FIREUP"
                    maxLength={16}
                    disabled={disabled}
                  />
                </label>

                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                  Coach email we will use:{" "}
                  <span className="font-semibold text-gray-900">
                    {coachEmail || "coach-firstlast@pl.strength"}
                  </span>
                  . Share the passcode only with trusted staff.
                </div>
                <p className="text-xs text-gray-500">
                  Ask your program admin for the current passcode (configured via{" "}
                  <code>VITE_COACH_PASSCODE</code>).
                </p>
                <button
                  type="submit"
                  className="btn btn-primary w-full justify-center py-3 text-base"
                  disabled={disabled}
                >
                  {submitting && mode === "coach" ? "Signing in..." : "Sign in as coach"}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}




































