
import { Route, Routes, Navigate, Link } from 'react-router-dom';
import { useEffect } from 'react';
import Login from './routes/Login';
import Home from './routes/Home';
import Session from './routes/Session';
import Calculator from './routes/Calculator';
import QuickSummary from './routes/QuickSummary';
import Sheets from './routes/Sheets';
import PdfPage from './routes/PdfPage';
import Admin from './routes/Admin';
import Roster from './routes/Roster';
import Profile from './routes/Profile';
import StatusBadge from './components/StatusBadge';
import { initAuth } from './lib/auth';

export default function App() {
  useEffect(() => {
    initAuth();
  }, []);

  return (
    <div className="min-h-screen bg-white text-plblack">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-plgray/50">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <img src="/icons/icon-96.png" alt="PL" className="w-8 h-8 rounded" />
          <Link to="/home" className="font-bold text-lg">PL Strength</Link>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <StatusBadge />
            <Link to="/session" className="underline">Session</Link>
            <Link to="/calculator" className="underline">Calculator</Link>
            <Link to="/sheets" className="underline">Sheets</Link>
            <Link to="/pdf" className="underline">PDF</Link>
            <Link to="/profile" className="underline">Profile</Link>
            <Link to="/roster" className="underline">Roster</Link>
            <Link to="/admin" className="underline">Admin</Link>
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<Navigate to="/login" />} />
          <Route path="/login" element={<Login />} />
          <Route path="/home" element={<Home />} />
          <Route path="/session" element={<Session />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/summary" element={<QuickSummary />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/pdf" element={<PdfPage />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/roster" element={<Roster />} />
        </Routes>
      </main>
    </div>
  );
}
