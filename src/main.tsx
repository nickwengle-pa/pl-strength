import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { AuthProvider } from './lib/auth';
import { DeviceProvider } from './lib/device';

// Suppress expected Firestore listener termination errors during sign-out
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  // Filter out expected Firestore channel termination errors
  const message = args[0]?.toString() || '';
  if (message.includes('Firestore/Listen/channel') && message.includes('400')) {
    // This is expected when signing out - Firestore listeners are being cleaned up
    return;
  }
  originalConsoleError.apply(console, args);
};

const root = createRoot(document.getElementById('root')!);
root.render(
  <HashRouter>
    <DeviceProvider>
      <AuthProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </DeviceProvider>
  </HashRouter>
);

// Register SW only in production; purge in dev to prevent CSS/JS from being served stale.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('SW registration failed', e));
    });
  } else {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    caches?.keys?.().then(keys => keys.forEach(k => caches.delete(k)));
  }
}
