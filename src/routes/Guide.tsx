import React from 'react';

export default function Guide() {
  return (
    <div className="card">
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
