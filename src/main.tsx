import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './index.css';
import App, { APP_VERSION } from './App';
import ErrorBoundary from './ErrorBoundary';
import { AuthProvider } from './lib/auth';
import { DeviceProvider } from './lib/device';
import { syncLocalSessionsToFirebase } from './lib/db';

const THEME_STORAGE_KEY = "pl-strength-theme";
try {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark") {
    document.documentElement.classList.add("theme-dark");
  } else {
    document.documentElement.classList.remove("theme-dark");
  }
} catch {}

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

// Version key for localStorage
const VERSION_KEY = 'pl-strength-app-version';

// Check if this is a new version and clear caches if needed
const checkAndClearCacheOnVersionChange = async () => {
  const storedVersion = localStorage.getItem(VERSION_KEY);
  if (storedVersion !== APP_VERSION) {
    console.log(`Version changed from ${storedVersion} to ${APP_VERSION}, clearing caches...`);
    // Clear all caches
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key)));
    }
    // Unregister service workers
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    // Store new version
    localStorage.setItem(VERSION_KEY, APP_VERSION);
    // Reload to get fresh content
    if (storedVersion !== null) {
      window.location.reload();
      return true;
    }
    localStorage.setItem(VERSION_KEY, APP_VERSION);
  }
  return false;
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

// Sync any orphaned local sessions to Firebase on startup
// This handles cases where sessions were saved offline and need to sync
syncLocalSessionsToFirebase().then((count) => {
  if (count > 0) {
    console.log(`Startup sync: pushed ${count} local session(s) to Firebase`);
  }
}).catch((err) => {
  console.warn('Startup sync failed:', err);
});

// Register SW only in production; purge in dev to prevent CSS/JS from being served stale.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // Check for version changes first
    checkAndClearCacheOnVersionChange().then((reloaded) => {
      if (reloaded) return; // Page is reloading, don't register SW yet
      
      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          
          // Check for updates periodically (every 60 seconds)
          setInterval(() => {
            registration.update();
          }, 60000);
          
          // Listen for new service worker
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (!newWorker) return;
            
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                // New content is available, show update prompt
                showUpdatePrompt();
              }
            });
          });
          
          // Listen for broadcast messages from service worker
          const broadcast = new BroadcastChannel('sw-updates');
          broadcast.addEventListener('message', (event) => {
            if (event.data?.type === 'SW_UPDATED') {
              showUpdatePrompt();
            }
          });
          
          // Also handle controllerchange - when new SW takes over
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            // Don't reload automatically, but could show a subtle notification
            console.log('New service worker activated');
          });
          
        } catch (e) {
          console.warn('SW registration failed', e);
        }
      });
    });
  } else {
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
    caches?.keys?.().then(keys => keys.forEach(k => caches.delete(k)));
  }
}

// Show update prompt to user
function showUpdatePrompt() {
  // Don't show multiple prompts
  if (document.getElementById('update-prompt')) return;
  
  const prompt = document.createElement('div');
  prompt.id = 'update-prompt';
  prompt.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%);
      color: white;
      padding: 16px 24px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 16px;
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 90vw;
      animation: slideUp 0.3s ease-out;
    ">
      <style>
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(100px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      </style>
      <span style="font-size: 14px;">🎉 A New Version Is Available!</span>
      <button id="update-btn" style="
        background: white;
        color: #1e40af;
        border: none;
        padding: 8px 16px;
        border-radius: 8px;
        font-weight: 600;
        cursor: pointer;
        font-size: 14px;
        transition: transform 0.1s;
      ">Update Now</button>
      <button id="dismiss-btn" style="
        background: transparent;
        color: rgba(255,255,255,0.8);
        border: none;
        padding: 4px;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      ">✕</button>
    </div>
  `;
  
  document.body.appendChild(prompt);
  
  document.getElementById('update-btn')?.addEventListener('click', () => {
    // Clear caches and reload
    if ('caches' in window) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
        window.location.reload();
      });
    } else {
      window.location.reload();
    }
  });
  
  document.getElementById('dismiss-btn')?.addEventListener('click', () => {
    prompt.remove();
  });
}
