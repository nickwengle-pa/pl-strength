import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ensureAnon, isAdmin, isCoach, subscribeToRoleChanges } from "../lib/db";

type ActiveAthlete = {
  uid: string;
  firstName?: string;
  lastName?: string;
  team?: string | null;
  unit?: string;
};

type ActiveAthleteContextValue = {
  loading: boolean;
  isCoach: boolean;
  isAdmin: boolean;
  activeAthlete: ActiveAthlete | null;
  setActiveAthlete: (athlete: ActiveAthlete) => void;
  clearActiveAthlete: () => void;
  notifyProfileChange: () => void;
  version: number;
};

const ActiveAthleteContext = createContext<ActiveAthleteContextValue | undefined>(
  undefined
);

const STORAGE_KEY = "pl.coach.activeAthlete";

type ProviderProps = {
  children: React.ReactNode;
};

export function ActiveAthleteProvider({ children }: ProviderProps) {
  const [loading, setLoading] = useState(true);
  const [isCoachFlag, setIsCoachFlag] = useState(false);
  const [isAdminFlag, setIsAdminFlag] = useState(false);
  const [activeAthlete, setActiveAthleteState] = useState<ActiveAthlete | null>(
    () => {
      if (typeof window === "undefined") return null;
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.uid === "string") {
          return parsed;
        }
      } catch (_) {
        // ignore
      }
      return null;
    }
  );
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await ensureAnon();
        const [coachFlag, adminFlag] = await Promise.all([isCoach(), isAdmin()]);
        if (active) {
          setIsCoachFlag(coachFlag);
          setIsAdminFlag(adminFlag);
          if (!coachFlag) {
            setActiveAthleteState(null);
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (err) {
        if (active) {
          console.warn("Failed to resolve coach status", err);
          setIsCoachFlag(false);
          setIsAdminFlag(false);
          setActiveAthleteState(null);
          window.localStorage.removeItem(STORAGE_KEY);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setActiveAthlete = useCallback((athlete: ActiveAthlete) => {
    setActiveAthleteState(athlete);
    setVersion((prev) => prev + 1);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(athlete));
      } catch (_) {
        // ignore storage errors
      }
    }
  }, []);

  const clearActiveAthlete = useCallback(() => {
    setActiveAthleteState(null);
    setVersion((prev) => prev + 1);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch (_) {
        // ignore
      }
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRoleChanges((roles) => {
      const coachAccess = roles.includes("admin") || roles.includes("coach");
      const adminAccess = roles.includes("admin");
      setIsCoachFlag(coachAccess);
      setIsAdminFlag(adminAccess);
      if (!coachAccess) {
        clearActiveAthlete();
      }
    });
    return unsubscribe;
  }, [clearActiveAthlete]);

  const notifyProfileChange = useCallback(() => {
    setVersion((prev) => prev + 1);
  }, []);

  const value = useMemo<ActiveAthleteContextValue>(
    () => ({
      loading,
      isCoach: isCoachFlag,
      isAdmin: isAdminFlag,
      activeAthlete,
      setActiveAthlete,
      clearActiveAthlete,
      notifyProfileChange,
      version,
    }),
    [
      loading,
      isCoachFlag,
      isAdminFlag,
      activeAthlete,
      setActiveAthlete,
      clearActiveAthlete,
      notifyProfileChange,
      version,
    ]
  );

  return (
    <ActiveAthleteContext.Provider value={value}>
      {children}
    </ActiveAthleteContext.Provider>
  );
}

export function useActiveAthlete() {
  const ctx = useContext(ActiveAthleteContext);
  if (!ctx) {
    throw new Error("useActiveAthlete must be used within ActiveAthleteProvider");
  }
  return ctx;
}
