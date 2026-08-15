import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getDownloadURL, ref } from 'firebase/storage';
import { tryInitFirebase } from '../lib/firebase';

/**
 * Storage path for the program PDF. This file deliberately does NOT live in
 * public/ — anything there is served by Cloudflare to anyone with the URL,
 * with no sign-in required. Fetching through Storage means the read is gated
 * by storage.rules (auth required).
 */
const GUIDE_PATH = 'guides/531-lifting.pdf';

export default function Guide() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fb = tryInitFirebase();
    if (!fb) {
      setError('Could not connect to storage. Check your connection and reload.');
      return;
    }

    getDownloadURL(ref(fb.storage, GUIDE_PATH))
      .then((downloadUrl) => {
        if (!cancelled) setUrl(downloadUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        // storage/object-not-found means the PDF hasn't been uploaded yet;
        // storage/unauthorized means rules rejected the read.
        console.warn('Guide PDF load failed', err);
        setError(
          err?.code === 'storage/object-not-found'
            ? 'The program guide has not been uploaded yet. Ask a coach to add it.'
            : 'You do not have access to the program guide, or it failed to load.',
        );
      });

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="card">
      <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-blue-900 text-sm">
          <strong>New To The App?</strong> Visit Your{" "}
          <Link to="/profile" className="text-brand-600 underline font-medium">
            Profile Page
          </Link>{" "}
          And Click "Show Tutorial Again" To See The Interactive Walkthrough.
        </p>
      </div>

      <h3 className="text-lg font-semibold mb-2">Program Guide (PDF)</h3>

      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
          {error}
        </div>
      )}

      {!error && !url && (
        <div className="p-4 text-gray-500 text-sm">Loading the program guide...</div>
      )}

      {url && (
        <>
          <div className="flex gap-2 mb-3">
            <a className="btn-primary" href={url} target="_blank" rel="noreferrer">
              Open PDF In New Tab
            </a>
          </div>
          <div className="border rounded-xl overflow-hidden" style={{ height: '80vh' }}>
            <iframe
              title="Program PDF"
              src={`${url}#view=FitH`}
              style={{ width: '100%', height: '100%' }}
            />
          </div>
        </>
      )}
    </div>
  );
}
