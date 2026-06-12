import React, { Suspense, lazy, useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Nav from "./components/Nav";
import NavV2 from "./components/NavV2";
import ActiveAthleteBanner from "./components/ActiveAthleteBanner";
import V2Switch from "./components/V2Switch";
import { isV2 } from "./lib/uiVersion";
import { useAuth } from "./lib/auth";
import { ActiveAthleteProvider } from "./context/ActiveAthleteContext";
import { ToastProvider } from "./context/ToastContext";

// App version - keep in sync with CACHE_NAME in public/sw.js
export const APP_VERSION = '3.1.0';

// Each route lazy-loads ONLY the active UI version's chunk. UI_VERSION is
// resolved once at module load (see lib/uiVersion.ts), so the inactive
// version's code is never downloaded — previously every user shipped both
// v1 and v2 of all surfaces in a single bundle. The navs stay eager so the
// header never flashes.
const pick = (
  v1: () => Promise<{ default: React.ComponentType }>,
  v2: () => Promise<{ default: React.ComponentType }>
) => lazy(isV2() ? v2 : v1);

const HomePage = pick(() => import("./routes/Home"), () => import("./routes/HomeV2"));
const SessionPage = pick(() => import("./routes/Session"), () => import("./routes/SessionV2"));
const SummaryPage = pick(() => import("./routes/Summary"), () => import("./routes/SummaryV2"));
const ProgressPage = pick(() => import("./routes/Progress"), () => import("./routes/ProgressV2"));
const CalculatorPage = pick(() => import("./routes/Calculator"), () => import("./routes/CalculatorV2"));
const SheetsPage = pick(() => import("./routes/Sheets"), () => import("./routes/SheetsV2"));
const ProgramOutlinePage = pick(() => import("./routes/ProgramOutline"), () => import("./routes/ProgramOutlineV2"));
const ExercisesPage = pick(() => import("./routes/Exercises"), () => import("./routes/ExercisesV2"));
const TurfPage = pick(() => import("./routes/Turf"), () => import("./routes/TurfV2"));
const AccessoryPage = pick(() => import("./routes/Accessory"), () => import("./routes/AccessoryV2"));
const RosterPage = pick(() => import("./routes/Roster"), () => import("./routes/RosterV2"));
const AttendancePage = pick(() => import("./routes/Attendance"), () => import("./routes/AttendanceV2"));
const AdminPage = pick(() => import("./routes/Admin"), () => import("./routes/AdminV2"));
const FootballSimulatorPage = pick(() => import("./routes/FootballSimulator"), () => import("./routes/FootballSimulatorV2"));
const ProfilePage = pick(() => import("./routes/Profile"), () => import("./routes/ProfileV2"));
const SignInPage = pick(() => import("./routes/SignIn"), () => import("./routes/SignInV2"));
const WelcomePage = pick(() => import("./routes/Welcome"), () => import("./routes/WelcomeV2"));

const routeFallback = (
  <div
    className={
      isV2()
        ? "min-h-screen flex items-center justify-center bg-v2-surface-950 text-v2-ink-400"
        : "min-h-screen flex items-center justify-center bg-gray-50 text-gray-600"
    }
  >
    Loading...
  </div>
);

export default function App() {
  const { user, initializing, signingInWithLink } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const authStateRef = useRef<"signed-in" | "signed-out" | null>(null);

  // Allow /welcome route without auth redirect (handle optional trailing slash)
  const isWelcomePage = location.pathname.replace(/\/$/, "") === "/welcome";

  useEffect(() => {
    if (initializing || signingInWithLink) return;
    if (isWelcomePage) return; // Don't redirect from welcome page
    const nextState = user ? "signed-in" : "signed-out";
    if (authStateRef.current === nextState) return;
    authStateRef.current = nextState;
    if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [user, initializing, signingInWithLink, location.pathname, navigate, isWelcomePage]);

  // Welcome page is always accessible (NFC landing)
  if (isWelcomePage) {
    return (
      <Suspense fallback={routeFallback}>
        <WelcomePage />
      </Suspense>
    );
  }

  if (initializing || signingInWithLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">
        Loading Your Account...
      </div>
    );
  }

  if (!user) {
    return (
      <Suspense fallback={routeFallback}>
        <SignInPage />
      </Suspense>
    );
  }

  return (
    <ToastProvider>
    <ActiveAthleteProvider>
      <div className="min-h-full flex flex-col">
        <div className="print:hidden">
          <V2Switch v1={<Nav />} v2={<NavV2 />} />
          <ActiveAthleteBanner />
        </div>
        <main className={isV2() ? "flex-1 pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-0" : "flex-1"}>
          <Suspense fallback={routeFallback}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/session" element={<SessionPage />} />
              <Route path="/summary" element={<SummaryPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/calculator" element={<CalculatorPage />} />
              <Route path="/sheets" element={<SheetsPage />} />
              <Route path="/program-outline" element={<ProgramOutlinePage />} />
              <Route path="/exercises" element={<ExercisesPage />} />
              <Route path="/turf" element={<TurfPage />} />
              <Route path="/accessory" element={<AccessoryPage />} />
              <Route path="/roster" element={<RosterPage />} />
              <Route path="/attendance" element={<AttendancePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/football" element={<FootballSimulatorPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </main>
        <footer className="py-2 text-center text-xs text-gray-400 print:hidden">
          v{APP_VERSION}
        </footer>
      </div>
    </ActiveAthleteProvider>
    </ToastProvider>
  );
}
