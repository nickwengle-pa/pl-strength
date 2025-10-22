import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div className="container py-8">
      <h1>Hi Athlete</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <Link to="/pdf" className="card hover:shadow-md transition-shadow">
          <h3 className="mb-2">Full PDF (Read)</h3>
          <p className="text-sm text-gray-600">Open your program PDF. Keep it private.</p>
        </Link>

        <Link to="/summary" className="card hover:shadow-md transition-shadow">
          <h3 className="mb-2">Quick Summary</h3>
          <p className="text-sm text-gray-600">See what to do this week based on your Training Max.</p>
        </Link>

        <Link to="/calculator" className="card hover:shadow-md transition-shadow">
          <h3 className="mb-2">Calculator / Table</h3>
          <p className="text-sm text-gray-600">Auto-calc warm-ups and work sets with plate rounding.</p>
        </Link>

        <Link to="/sheets" className="card hover:shadow-md transition-shadow">
          <h3 className="mb-2">Printable / Fillable Sheets</h3>
          <p className="text-sm text-gray-600">Week 1–4 logs: print or fill on device and save.</p>
        </Link>
      </div>
    </div>
  );
}
