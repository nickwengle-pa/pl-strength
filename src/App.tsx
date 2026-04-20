import React, { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Nav from "./components/Nav";
import ActiveAthleteBanner from "./components/ActiveAthleteBanner";
import Home from "./routes/Home";
import Session from "./routes/Session";
import Roster from "./routes/Roster";
import Calculator from "./routes/Calculator";
import CalculatorV2 from "./routes/CalculatorV2";
import Summary from "./routes/Summary";
import Progress from "./routes/Progress";
import Sheets from "./routes/Sheets";
import Admin from "./routes/Admin";
import Profile from "./routes/Profile";
import ProfileV2 from "./routes/ProfileV2";
import Exercises from "./routes/Exercises";
import ProgramOutline from "./routes/ProgramOutline";
import Attendance from "./routes/Attendance";
import SignIn from "./routes/SignIn";
import SignInV2 from "./routes/SignInV2";
import Welcome from "./routes/Welcome";
import WelcomeV2 from "./routes/WelcomeV2";
import V2Switch from "./components/V2Switch";
import Turf from "./routes/Turf";
import Accessory from "./routes/Accessory";
import FootballSimulator from "./routes/FootballSimulator";
import { useAuth } from "./lib/auth";
import { ActiveAthleteProvider } from "./context/ActiveAthleteContext";
import { ToastProvider } from "./context/ToastContext";

// App version - keep in sync with main.tsx
export const APP_VERSION = '2.3.0';

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
          <Nav />
          <ActiveAthleteBanner />
        </div>
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/session" element={<Session />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/calculator" element={<V2Switch v1={<Calculator />} v2={<CalculatorV2 />} />} />
            <Route path="/sheets" element={<Sheets />} />
            <Route path="/program-outline" element={<ProgramOutline />} />
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/turf" element={<Turf />} />
            <Route path="/accessory" element={<Accessory />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/football" element={<FootballSimulator />} />
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
