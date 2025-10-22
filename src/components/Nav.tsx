import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Nav() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="container h-14 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <img src="/assets/dragon.png" alt="Dragon" className="h-7 w-7 object-contain" />
          <span className="text-xl font-bold tracking-tight">PL Strength</span>
        </div>
        <nav className="flex items-center gap-3">
          {['session','roster','calculator','guide','pdf','summary','sheets','admin','profile'].map((p) => (
            <NavLink
              key={p}
              to={`/${p === 'pdf' ? 'pdf' : p}`}
              className={({ isActive }) => isActive ? 'nav-link nav-link-active' : 'nav-link'}
            >
              {label(p)}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
  );
}

function label(key: string) {
  switch (key) {
    case 'session': return 'Session';
    case 'roster': return 'Roster';
    case 'calculator': return 'Calculator';
    case 'guide': return 'Guide';
    case 'pdf': return 'PDF';
    case 'summary': return 'Quick Summary';
    case 'sheets': return 'Printable Sheets';
    case 'admin': return 'Admin';
    case 'profile': return 'Profile';
    default: return key;
  }
}
