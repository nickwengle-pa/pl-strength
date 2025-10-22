import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Nav from './components/Nav';
import Home from './routes/Home';
import Session from './routes/Session';
import Roster from './routes/Roster';
import Calculator from './routes/Calculator';
import Guide from './routes/Guide';
import Summary from './routes/Summary';
import Sheets from './routes/Sheets';
import Admin from './routes/Admin';
import Profile from './routes/Profile';

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <Nav />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/session" element={<Session />} />
          <Route path="/roster" element={<Roster />} />
          <Route path="/calculator" element={<Calculator />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="/pdf" element={<Guide />} />
          <Route path="/summary" element={<Summary />} />
          <Route path="/sheets" element={<Sheets />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
