import React from 'react';
import { Link } from 'react-router-dom';

export default function Guide() {
  return (
    <div className="card">
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-900 text-sm">
          <strong>New to the app?</strong> Visit your{" "}
          <Link to="/profile" className="text-brand-600 underline font-medium">
            Profile page
          </Link>{" "}
          and click "Show Tutorial Again" to see the interactive walkthrough.
        </p>
      </div>
      
      <h3 className="text-lg font-semibold mb-2">Program Guide (PDF)</h3>
      <div className="flex gap-2 mb-3">
        <a className="btn-primary" href="/docs/531-lifting.pdf" target="_blank" rel="noreferrer">Open PDF in new tab</a>
      </div>
      <div className="border rounded-xl overflow-hidden" style={{height: '80vh'}}>
        <iframe
          title="Program PDF"
          src="/docs/531-lifting.pdf#view=FitH"
          style={{width: '100%', height: '100%'}}
        />
      </div>
    </div>
  );
}
