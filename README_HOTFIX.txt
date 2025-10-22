
HOTFIX — Fix blank app + restore roster
---------------------------------------
Files to copy into your project (overwrite where noted):
  - src/lib/db.ts          (OVERWRITE)
  - src/routes/Roster.tsx  (OVERWRITE)
  - index.html             (OVERWRITE)
  - public/sw.js           (OVERWRITE, bumps cache to v2)

Then:
  1) Stop and restart dev server: npm run dev
  2) In the browser, hard refresh (Ctrl+Shift+R)
  3) If the page is still blank once, clear SW + caches in DevTools Console:
     (async () => {
       for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
       for (const k of await caches.keys()) await caches.delete(k);
       location.reload();
     })();

Why this helps:
  - Restores listRoster() export that /roster imports.
  - Keeps Sessions helpers intact (saveSession, recentSessions, bestEst1RM).
  - Adds localhost SW guard and bumps cache name to avoid stale assets.
