import React, { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Nav from "./components/Nav";
import NavV2 from "./components/NavV2";
import ActiveAthleteBanner from "./components/ActiveAthleteBanner";
import Home from "./routes/Home";
import HomeV2 from "./routes/HomeV2";
import Session from "./routes/Session";
import SessionV2 from "./routes/SessionV2";
import Roster from "./routes/Roster";
import RosterV2 from "./routes/RosterV2";
import Calculator from "./routes/Calculator";
import CalculatorV2 from "./routes/CalculatorV2";
import Summary from "./routes/Summary";
import SummaryV2 from "./routes/SummaryV2";
import Progress from "./routes/Progress";
import ProgressV2 from "./routes/ProgressV2";
import Sheets from "./routes/Sheets";
import SheetsV2 from "./routes/SheetsV2";
import Admin from "./routes/Admin";
import AdminV2 from "./routes/AdminV2";
import Profile from "./routes/Profile";
import ProfileV2 from "./routes/ProfileV2";
import Exercises from "./routes/Exercises";
import ExercisesV2 from "./routes/ExercisesV2";
import ProgramOutline from "./routes/ProgramOutline";
import ProgramOutlineV2 from "./routes/ProgramOutlineV2";
import Attendance from "./routes/Attendance";
import AttendanceV2 from "./routes/AttendanceV2";
import SignIn from "./routes/SignIn";
import SignInV2 from "./routes/SignInV2";
import Welcome from "./routes/Welcome";
import WelcomeV2 from "./routes/WelcomeV2";
import V2Switch from "./components/V2Switch";
import Turf from "./routes/Turf";
import TurfV2 from "./routes/TurfV2";
import Accessory from "./routes/Accessory";
import AccessoryV2 from "./routes/AccessoryV2";
import FootballSimulator from "./routes/FootballSimulator";
import FootballSimulatorV2 from "./routes/FootballSimulatorV2";
import { useAuth } from "./lib/auth";
import { ActiveAthleteProvider } from "./context/ActiveAthleteContext";
import { ToastProvider } from "./context/ToastContext";

// App version - keep in sync with main.tsx
export const APP_VERSION = '3.0.0';

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
    return <V2Switch v1={<Welcome />} v2={<WelcomeV2 />} />;
  }

  if (initializing || signingInWithLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">
        Loading Your Account...
      </div>
    );
  }

  if (!user) {
    return <V2Switch v1={<SignIn />} v2={<SignInV2 />} />;
  }

  return (
    <ToastProvider>
    <ActiveAthleteProvider>
      <div className="min-h-full flex flex-col">
        <div className="print:hidden">
          <V2Switch v1={<Nav />} v2={<NavV2 />} />
          <ActiveAthleteBanner />
        </div>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<V2Switch v1={<Home />} v2={<HomeV2 />} />} />
            <Route path="/session" element={<V2Switch v1={<Session />} v2={<SessionV2 />} />} />
            <Route path="/summary" element={<V2Switch v1={<Summary />} v2={<SummaryV2 />} />} />
            <Route path="/progress" element={<V2Switch v1={<Progress />} v2={<ProgressV2 />} />} />
            <Route path="/calculator" element={<V2Switch v1={<Calculator />} v2={<CalculatorV2 />} />} />
            <Route path="/sheets" element={<V2Switch v1={<Sheets />} v2={<SheetsV2 />} />} />
            <Route path="/program-outline" element={<V2Switch v1={<ProgramOutline />} v2={<ProgramOutlineV2 />} />} />
            <Route path="/exercises" element={<V2Switch v1={<Exercises />} v2={<ExercisesV2 />} />} />
            <Route path="/turf" element={<V2Switch v1={<Turf />} v2={<TurfV2 />} />} />
            <Route path="/accessory" element={<V2Switch v1={<Accessory />} v2={<AccessoryV2 />} />} />
            <Route path="/roster" element={<V2Switch v1={<Roster />} v2={<RosterV2 />} />} />
            <Route path="/attendance" element={<V2Switch v1={<Attendance />} v2={<AttendanceV2 />} />} />
            <Route path="/admin" element={<V2Switch v1={<Admin />} v2={<AdminV2 />} />} />
            <Route path="/football" element={<V2Switch v1={<FootballSimulator />} v2={<FootballSimulatorV2 />} />} />
            <Route path="/profile" element={<V2Switch v1={<Profile />} v2={<ProfileV2 />} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="py-2 text-center text-xs text-gray-400 print:hidden">
          v{APP_VERSION}
        </footer>
      </div>
    </ActiveAthleteProvider>
    </ToastProvider>
  );
}
