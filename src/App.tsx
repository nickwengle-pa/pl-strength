import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import Nav from "./components/Nav";
import Home from "./routes/Home";
import Session from "./routes/Session";
import Roster from "./routes/Roster";
import Calculator from "./routes/Calculator";
import Summary from "./routes/Summary";
import Sheets from "./routes/Sheets";
import Admin from "./routes/Admin";
import Profile from "./routes/Profile";
import SignIn from "./routes/SignIn";
import { useAuth } from "./lib/auth";

export default function App() {
  const { user, initializing, signingInWithLink } = useAuth();

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
    <div className="min-h-full flex flex-col">
      <Nav />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/session" element={<Session />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
