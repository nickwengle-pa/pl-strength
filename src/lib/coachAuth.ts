import { getFunctions, httpsCallable } from "firebase/functions";
import { tryInitFirebase } from "./firebase";

/**
 * KILLSWITCH for the server-verified coach sign-in path.
 *
 * `true`  — SignInV2 calls the `claimCoachRole` Cloud Function first. A
 *           "wrong passcode" answer from the server is authoritative, but if
 *           the function is unreachable (not deployed, outage, offline) the
 *           client silently falls back to the legacy bundle-passcode flow,
 *           so a function problem can never lock a coach out.
 * `false` — the legacy flow runs exclusively, exactly as before.
 *
 * Flip to `false`, bump APP_VERSION (src/App.tsx) and CACHE_NAME
 * (public/sw.js), and deploy to revert the rollout in one step.
 */
export const COACH_AUTH_VIA_FUNCTION = true;

export type ClaimCoachRoleResult = {
  token: string;
  roles: string[];
  teamScopes: string[];
  teamAnchor: string | null;
};

/** The server checked the passcode and it does not match. Authoritative — do not fall back. */
export class CoachPasscodeError extends Error {
  constructor() {
    super("wrong-passcode");
    this.name = "CoachPasscodeError";
  }
}

/** Too many failed attempts for this coach identity. Authoritative — do not fall back. */
export class CoachAuthRateLimitError extends Error {
  constructor() {
    super("Too many passcode attempts. Wait a few minutes and try again.");
    this.name = "CoachAuthRateLimitError";
  }
}

/**
 * Ask the Cloud Function to verify the coach passcode and grant the role.
 * Resolves with a custom token to sign in with. Throws CoachPasscodeError /
 * CoachAuthRateLimitError for authoritative rejections; any other error means
 * "function unavailable" and the caller should fall back to the legacy flow.
 */
export async function claimCoachRole(input: {
  firstName: string;
  lastName: string;
  passcode: string;
}): Promise<ClaimCoachRoleResult> {
  const handles = tryInitFirebase();
  if (!handles) throw new Error("firebase-unavailable");

  const callable = httpsCallable<typeof input, ClaimCoachRoleResult>(
    getFunctions(handles.app),
    "claimCoachRole"
  );

  try {
    const result = await callable(input);
    if (!result.data?.token) throw new Error("claim-missing-token");
    return {
      token: result.data.token,
      roles: Array.isArray(result.data.roles) ? result.data.roles : [],
      teamScopes: Array.isArray(result.data.teamScopes) ? result.data.teamScopes : [],
      teamAnchor: result.data.teamAnchor ?? null,
    };
  } catch (err: any) {
    const code: string = err?.code ?? "";
    if (code === "functions/permission-denied") throw new CoachPasscodeError();
    if (code === "functions/resource-exhausted") throw new CoachAuthRateLimitError();
    throw err; // unavailable / not deployed / network — caller falls back
  }
}
