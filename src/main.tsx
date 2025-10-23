import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';
import { AuthProvider } from './lib/auth';

const root = createRoot(document.getElementById('root')!);
root.render(
  <HashRouter>
    <AuthProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </AuthProvider>
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
