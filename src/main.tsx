import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
// Self-hosted fonts (bundled by Vite, cached by the SW — work offline,
// unlike the old Google Fonts @import)
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
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

const EXTENSION_ASYNC_RESPONSE_ERROR =
  "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
const EXTENSION_RUNTIME_LAST_ERROR = "Unchecked runtime.lastError";

const isKnownExtensionMessagingNoise = (value: unknown): boolean => {
  const hasKnownMessage = (message: string): boolean =>
    message.includes(EXTENSION_ASYNC_RESPONSE_ERROR) ||
    message.includes(EXTENSION_RUNTIME_LAST_ERROR);

  if (typeof value === "string") {
    return hasKnownMessage(value);
  }
  if (value instanceof Error) {
    const message = value.message || "";
    return hasKnownMessage(message);
  }
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" && hasKnownMessage(message);
  }
  return false;
};

// Suppress expected Firestore listener termination errors during sign-out
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  // Filter out expected Firestore channel termination errors
  const message = args[0]?.toString() || '';
  if (args.some(isKnownExtensionMessagingNoise)) {
    return;
  }
  if (message.includes('Firestore/Listen/channel') && message.includes('400')) {
    // This is expected when signing out - Firestore listeners are being cleaned up
    return;
  }
  originalConsoleError.apply(console, args);
};

window.addEventListener("error", (event) => {
  if (isKnownExtensionMessagingNoise(event.error ?? event.message)) {
    event.preventDefault();
  }
});

window.addEventListener("unhandledrejection", (event) => {
  if (isKnownExtensionMessagingNoise(event.reason)) {
    event.preventDefault();
  }
});

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
  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
    // Set up BroadcastChannel listener early, before SW registration
    const broadcast = new BroadcastChannel('sw-updates');
    broadcast.addEventListener('message', (event) => {
      if (event.data?.type === 'SW_UPDATED') {
        console.log('Service worker updated via broadcast');
        showUpdatePrompt();
      }
    });

    // Check for version changes first
    checkAndClearCacheOnVersionChange().then((reloaded) => {
      if (reloaded) return; // Page is reloading, don't register SW yet

      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');

          // Check if there's already a waiting service worker
          if (registration.waiting) {
            console.log('Service worker already waiting');
            showUpdatePrompt();
          }

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
                console.log('New service worker installed');
                showUpdatePrompt();
              }
            });
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
  
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const prompt = document.createElement('div');
  prompt.id = 'update-prompt';
  prompt.innerHTML = `
    <div style="
      position: fixed;
      bottom: calc(20px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%);
      background: #0F172A;
      color: #F1F5F9;
      border: 1px solid #334155;
      padding: 14px 16px;
      border-radius: 14px;
      box-shadow: 0 10px 15px rgba(2,6,23,.1), 0 20px 25px rgba(2,6,23,.1);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: Barlow, system-ui, -apple-system, sans-serif;
      max-width: 90vw;
      ${reduceMotion ? '' : 'animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);'}
    ">
      <style>
        @keyframes slideUp {
          from { transform: translateX(-50%) translateY(100px); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      </style>
      <span style="font-size: 14px;">A new version is available</span>
      <button id="update-btn" style="
        background: #7a0f18;
        color: #fff;
        border: none;
        min-height: 44px;
        padding: 8px 16px;
        border-radius: 10px;
        font-family: inherit;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        cursor: pointer;
        font-size: 13px;
        transition: background-color 0.15s;
      " onmouseover="this.style.background='#640d14'" onmouseout="this.style.background='#7a0f18'">Update now</button>
      <button id="dismiss-btn" aria-label="Dismiss" style="
        background: transparent;
        color: #94A3B8;
        border: none;
        min-height: 44px;
        min-width: 44px;
        padding: 4px;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
      ">✕</button>
    </div>
  `;
  
  document.body.appendChild(prompt);
  
  document.getElementById('update-btn')?.addEventListener('click', () => {
    // Clear caches and always reload, even if cache deletion fails.
    caches
      .keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .catch(() => undefined)
      .finally(() => {
        window.location.reload();
      });
  });
  
  document.getElementById('dismiss-btn')?.addEventListener('click', () => {
    prompt.remove();
  });
}
