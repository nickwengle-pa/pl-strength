HOTFIX v2 — Stop SW POST errors + remove Firestore index requirement
-------------------------------------------------------------------
Overwrite these files:
  - src/lib/db.ts   (updates queries to avoid composite index requirement)
  - public/sw.js    (caches only same-origin GET navigations/assets; bumps to v3)

Then:
  1) Restart dev: npm run dev
  2) Hard refresh: Ctrl+Shift+R
  3) In DevTools Console, one-time cleanup if needed:
     (async () => {
       for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
       for (const k of await caches.keys()) await caches.delete(k);
       location.reload();
     })();

Why this fixes your errors:
  - "Cache put unsupported for POST": the SW no longer intercepts POST/PUT and ignores cross-origin, so Firebase network calls won't get cached.
  - "The query requires an index": we now fetch the latest 50 sessions ordered by createdAt and filter by lift in memory. That's tiny for our scale and avoids needing a composite index.
  
Prefer the indexed query later? Create a composite index:
  Collection ID: sessions
  Fields: lift ASC, createdAt DESC
  (You can also click the auto-generated link from the console error to create it.)
