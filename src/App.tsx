import React, { useEffect, useRef } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import Nav from "./components/Nav";
import ActiveAthleteBanner from "./components/ActiveAthleteBanner";
import Home from "./routes/Home";
import Session from "./routes/Session";
import Roster from "./routes/Roster";
import Calculator from "./routes/Calculator";
import Summary from "./routes/Summary";
import Sheets from "./routes/Sheets";
import Admin from "./routes/Admin";
import Profile from "./routes/Profile";
import Exercises from "./routes/Exercises";
import ProgramOutline from "./routes/ProgramOutline";
import Attendance from "./routes/Attendance";
import SignIn from "./routes/SignIn";
import { useAuth } from "./lib/auth";
import { ActiveAthleteProvider } from "./context/ActiveAthleteContext";

export default function App() {
  const { user, initializing, signingInWithLink } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const authStateRef = useRef<"signed-in" | "signed-out" | null>(null);

  useEffect(() => {
    if (initializing || signingInWithLink) return;
    const nextState = user ? "signed-in" : "signed-out";
    if (authStateRef.current === nextState) return;
    authStateRef.current = nextState;
    if (location.pathname !== "/") {
      navigate("/", { replace: true });
    }
  }, [user, initializing, signingInWithLink, location.pathname, navigate]);

  if (initializing || signingInWithLink) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 text-gray-600">
        Loading your account…
      </div>
    );
  }

  if (!user) {
    return <SignIn />;
  }

  return (
    <ActiveAthleteProvider>
      <div className="min-h-full flex flex-col">
        <Nav />
        <ActiveAthleteBanner />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/session" element={<Session />} />
            <Route path="/summary" element={<Summary />} />
            <Route path="/calculator" element={<Calculator />} />
            <Route path="/sheets" element={<Sheets />} />
            <Route path="/program-outline" element={<ProgramOutline />} />
            <Route path="/exercises" element={<Exercises />} />
            <Route path="/roster" element={<Roster />} />
            <Route path="/attendance" element={<Attendance />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </ActiveAthleteProvider>
  );
}
