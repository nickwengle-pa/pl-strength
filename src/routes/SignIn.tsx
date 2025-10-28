import React, { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
import {
  AthleteAuthError,
  buildAthleteEmail,
  ensureCoachRole,
  fb,
  loadProfileRemote,
  normalizePasscodeDigits,
  saveProfile,
  signInOrCreateAthleteAccount,
  type Team,
} from "../lib/db";

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
const normalizeCoachPasscode = (value: string) => value.trim().toUpperCase();
const coachPassword = (code: string) => `${code}coach!`;
const buildCoachEmail = (firstName: string, lastName: string): string => {
  const canonical = `${firstName}${lastName}`.toLowerCase().replace(/[^a-z]/g, "");
  return `coach-${canonical}@pl.strength`;
};
const TEAM_OPTIONS: Array<{ label: string; value: Team | "" }> = [
  { label: "Select a team", value: "" },
  { label: "Junior High", value: "JH" },
  { label: "Varsity", value: "Varsity" },
];

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
  const [mode, setMode] = useState<Mode>("athlete");
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
    const stored = window.localStorage.getItem("pl-strength-team");
    if (stored === "JH" || stored === "Varsity") {
      setTeam(stored as Team);
    }
  }, []);

  useEffect(() => {
    if (mode === "athlete") {
      const stored = window.localStorage.getItem("pl-strength-team");
      if (stored === "JH" || stored === "Varsity") {
        setTeam(stored as Team);
      } else {
        setTeam("");
      }
    } else {
      setTeam("");
    }
    setPasscode("");
  }, [mode]);

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
      accessCode: base?.accessCode ?? null,
    });

    if (resolvedTeam) {
      window.localStorage.setItem("pl-strength-team", resolvedTeam);
    } else {
      window.localStorage.removeItem("pl-strength-team");
    }

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

      if (profile.team) {
        window.localStorage.setItem("pl-strength-team", profile.team);
      } else {
        window.localStorage.removeItem("pl-strength-team");
      }
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

  const email = buildCoachEmail(safeFirst, safeLast);
  const entered = normalizeCoachPasscode(passcode);
  if (!entered) {
    setMessage({ kind: "error", text: "Enter the coach passcode." });
    return;
  }
  const expected = normalizeCoachPasscode(coachPasscodeFromEnv);
  if (entered !== expected) {
    setMessage({
      kind: "error",
      text: "That passcode does not match. Check with your admin for the current coach code.",
    });
    return;
  }

  setSubmitting(true);
  setMessage(null);
  const password = coachPassword(entered);
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
        const text =
          code === "auth/email-already-in-use"
            ? "That email is already registered with a different passcode."
            : (createErr?.message ?? "We could not create the account.");
        setMessage({ kind: "error", text });
        setSubmitting(false);
        return;
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
    await ensureCoachRole();
  } catch (err) {
    console.warn("Failed to ensure coach role", err);
  }

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
      <div className="w-full max-w-3xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900">
            PL Strength Sign In
          </h1>
          <p className="text-sm text-gray-600">
            Athletes use the team email pattern (firstlast@pl.strength) and your 4-digit code.
            Coaches enter their name and the shared passcode-we build the coach email for you.
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-3xl shadow-soft p-6">
          <div className="flex justify-center mb-6 gap-2">
            <button
              className={`px-4 py-2 rounded-full text-sm font-medium ${
                mode === "athlete"
                  ? "bg-brand-50 text-brand-700 border border-brand-200"
                  : "border border-gray-200 text-gray-600 hover:text-gray-900"
              }`}
              type="button"
              onClick={() => {
                setMode("athlete");
                setMessage(null);
              }}
              disabled={disabled}
            >
              Athlete Sign In
            </button>
            <button
              className={`px-4 py-2 rounded-full text-sm font-medium ${
                mode === "coach"
                  ? "bg-brand-50 text-brand-700 border border-brand-200"
                  : "border border-gray-200 text-gray-600 hover:text-gray-900"
              }`}
              type="button"
              onClick={() => {
                setMode("coach");
                setMessage(null);
              }}
              disabled={disabled}
            >
              Coach Sign In
            </button>
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
                Team email we will use: {" "}
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
                Team (optional)
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
                Coach email we will use: {" "}
                <span className="font-semibold text-gray-900">
                  {coachEmail || "coach-firstlast@pl.strength"}
                </span>
                . Share the passcode only with trusted staff.
              </div>
              <p className="text-xs text-gray-500">
                Ask your program admin for the current passcode (configured via <code>VITE_COACH_PASSCODE</code>).
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
      </div>
    </div>
  );
}



































