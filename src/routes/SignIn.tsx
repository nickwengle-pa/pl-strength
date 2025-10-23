import React, { useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type AuthError,
} from "firebase/auth";
import { fb, saveProfile, ensureCoachRole } from "../lib/db";

type Mode = "athlete" | "coach";

type StatusMessage = { kind: "success" | "error"; text: string } | null;

const actionCodeSettings = () => ({
  url: `${window.location.origin}/#/sign-in`,
  handleCodeInApp: true,
});

function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function buildAthleteEmail(firstName: string, lastName: string): string {
  const canonical = `${firstName}${lastName}`
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return `${canonical}@pl.strength`;
}

function normalizeDigits(code: string): string {
  return code.replace(/\D+/g, "").slice(0, 4);
}

const passcodeToPassword = (code: string) => `${code}pl!`;
const coachPasscodeFromEnv = (
  import.meta.env.VITE_COACH_PASSCODE ?? "2468"
)
  .toString()
  .trim();
const normalizeCoachPasscode = (value: string) => value.trim().toUpperCase();
const coachPassword = (code: string) => `${code}coach!`;
const inferCoachName = (email: string) => {
  const base = email.split("@")[0] ?? "";
  const cleaned = base.replace(/[\.\-_]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export default function SignIn() {
  const [mode, setMode] = useState<Mode>("athlete");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [passcode, setPasscode] = useState("");
  const [coachEmail, setCoachEmail] = useState("");
  const [coachPass, setCoachPass] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<StatusMessage>(null);

  const auth = fb.auth;

  const athleteEmail = useMemo(() => {
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    if (!safeFirst || !safeLast) return "";
    return buildAthleteEmail(safeFirst, safeLast);
  }, [firstName, lastName]);

  const disabled = submitting;

  const handleAthleteSignIn = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth) {
      setMessage({ kind: "error", text: "Firebase auth is unavailable." });
      return;
    }
    const safeFirst = sanitizeName(firstName);
    const safeLast = sanitizeName(lastName);
    const digits = normalizeDigits(passcode);

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

    setSubmitting(true);
    setMessage(null);
    const email = buildAthleteEmail(safeFirst, safeLast);
    const password = passcodeToPassword(digits);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      window.localStorage.setItem(
        "pl-strength-display-name",
        `${safeFirst} ${safeLast}`
      );
    } catch (err: any) {
      const error = err as AuthError;
      const shouldAttemptCreate =
        error.code === "auth/user-not-found" ||
        error.code === "auth/invalid-credential";

      if (shouldAttemptCreate) {
        try {
          const cred = await createUserWithEmailAndPassword(
            auth,
            email,
            password
          );
          await saveProfile({
            uid: cred.user.uid,
            firstName: safeFirst,
            lastName: safeLast,
            unit: "lb",
          });
          window.localStorage.setItem(
            "pl-strength-display-name",
            `${safeFirst} ${safeLast}`
          );
        } catch (createErr: any) {
          const code = (createErr as AuthError)?.code;
          const text =
            code === "auth/email-already-in-use"
              ? "That athlete already exists. Double-check spelling or the passcode."
              : (createErr?.message ?? "We could not create the account.");
          setMessage({ kind: "error", text });
          setSubmitting(false);
          return;
        }
      } else if (error.code === "auth/wrong-password") {
        setMessage({
          kind: "error",
          text: "Passcode does not match. Ask your coach if you need help.",
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
  } finally {
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
  const email = coachEmail.trim().toLowerCase();
  if (!email) {
    setMessage({ kind: "error", text: "Enter your team email address." });
    return;
  }
  const entered = normalizeCoachPasscode(coachPass);
  if (!entered) {
    setMessage({ kind: "error", text: "Enter the coach passcode." });
    return;
  }
  const expected = normalizeCoachPasscode(coachPasscodeFromEnv);
  if (entered !== expected) {
    setMessage({
      kind: "error",
      text: "That passcode doesn’t match. Check with your admin for the current coach code.",
    });
    return;
  }

  setSubmitting(true);
  setMessage(null);
  const password = coachPassword(entered);
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err: any) {
    const error = err as AuthError;
    const shouldCreate =
      error.code === "auth/user-not-found" || error.code === "auth/invalid-credential";

    if (shouldCreate) {
      try {
        await createUserWithEmailAndPassword(auth, email, password);
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
        text: "Passcode doesn’t match. Ask your admin for the current coach code.",
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

  try {
    await ensureCoachRole();
  } catch (err) {
    console.warn("Failed to ensure coach role", err);
  }

  const friendly = inferCoachName(email);
  if (friendly) {
    window.localStorage.setItem("pl-strength-display-name", friendly);
  } else {
    window.localStorage.removeItem("pl-strength-display-name");
  }
  setCoachPass("");
  setMessage({
    kind: "success",
    text: "Signed in as coach. Loading the app…",
  });
  setSubmitting(false);
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
            Coaches sign in with their email and the shared coach passcode.
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
                4-digit team code
                <input
                  className="field tracking-widest text-center text-base"
                  value={passcode}
                  onChange={(e) => setPasscode(normalizeDigits(e.target.value))}
                  placeholder="1234"
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  disabled={disabled}
                />
              </label>

              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                Team email we will use:{" "}
                <span className="font-semibold text-gray-900">
                  {athleteEmail || "firstlast@pl.strength"}
                </span>
                . No real inbox required—coaches manage the codes.
              </div>

              <button
                type="submit"
                className="btn btn-primary w-full justify-center py-3 text-base"
                disabled={disabled}
              >
                {submitting && mode === "athlete" ? "Signing in…" : "Sign in"}
              </button>
            </form>
          ) : (
            <form className="space-y-4" onSubmit={handleCoachSignIn}>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                Coach email
                <input
                  className="field"
                  value={coachEmail}
                  onChange={(e) => setCoachEmail(e.target.value)}
                  placeholder="coach@school.org"
                  autoComplete="email"
                  type="email"
                  disabled={disabled}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-gray-700">
                Coach passcode
                <input
                  className="field tracking-widest text-center text-base"
                  value={coachPass}
                  onChange={(e) => setCoachPass(normalizeCoachPasscode(e.target.value))}
                  placeholder="****"
                  maxLength={16}
                  disabled={disabled}
                />
              </label>
              <p className="text-xs text-gray-500">
                Ask your program admin for the current passcode. (Configured via <code>VITE_COACH_PASSCODE</code>)
              </p>
              <button
                type="submit"
                className="btn btn-primary w-full justify-center py-3 text-base"
                disabled={disabled}
              >
                {submitting && mode === "coach" ? "Signing in…" : "Sign in as coach"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
