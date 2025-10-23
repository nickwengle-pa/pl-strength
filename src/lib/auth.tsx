import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  signInWithEmailLink,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { fb, resetRoleCache } from "./db";

type AuthContextValue = {
  user: User | null;
  initializing: boolean;
  signingInWithLink: boolean;
  linkError: string | null;
  clearLinkError: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const COACH_EMAIL_STORAGE_KEY = "pl-strength-coach-email";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [signingInWithLink, setSigningInWithLink] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    const auth = fb.auth;
    if (!auth) {
      setInitializing(false);
      return;
    }

    const processEmailLink = async () => {
      if (!isSignInWithEmailLink(auth, window.location.href)) return;
      setSigningInWithLink(true);
      try {
        let email =
          window.localStorage.getItem(COACH_EMAIL_STORAGE_KEY) ?? undefined;
        if (!email) {
          email = window.prompt(
            "Enter the email you used for the sign-in link:"
          )?.trim();
        }
        if (!email) {
          throw new Error("Email is required to finish sign-in.");
        }
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem(COACH_EMAIL_STORAGE_KEY);
      } catch (err: any) {
        console.warn("Email link sign-in failed", err);
        setLinkError(
          err?.message ?? "We could not finish signing you in with the link."
        );
      } finally {
        setSigningInWithLink(false);
        if (window.location.hash.includes("oobCode")) {
          const url = new URL(window.location.href);
          url.search = "";
          window.history.replaceState({}, document.title, url.toString());
        }
      }
    };

    processEmailLink();

    const unsub = onAuthStateChanged(auth, (firebaseUser) => {
      if (!firebaseUser) resetRoleCache();
      setUser(firebaseUser);
      setInitializing(false);
    });
    return () => unsub();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initializing,
      signingInWithLink,
      linkError,
      clearLinkError: () => setLinkError(null),
      signOut: async () => {
        if (!fb.auth) return;
        await firebaseSignOut(fb.auth);
        resetRoleCache();
      },
    }),
    [user, initializing, signingInWithLink, linkError]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return ctx;
}
