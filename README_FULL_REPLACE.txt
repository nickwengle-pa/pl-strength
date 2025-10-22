FULL REPLACE PATCH — PL Strength PWA
------------------------------------
What this patch fixes:
- Router nesting (App has no Router; root uses HashRouter).
- Service worker only caches GET (no POST caching errors).
- Summary page DOM nesting warning fixed.
- Roster uses collectionGroup('profile') to satisfy coach read rules and avoid permission errors.
- Sessions queries avoid composite indexes (filter in memory).

Files included (drop into project root, overwrite):
- src/firebase.ts
- src/lib/{db.ts, storage.ts, tm.ts, plan.ts}
- src/components/{CoachTips.tsx, TrendMini.tsx}
- src/routes/{Session.tsx, Roster.tsx, Admin.tsx, Profile.tsx, Guide.tsx, Summary.tsx, Sheets.tsx, Calculator.tsx}
- src/App.tsx
- src/main.tsx
- public/sw.js
- public/docs/README.txt (add your PDF as public/docs/531-lifting.pdf)

After copying:
1) npm run dev
2) Hard refresh (Ctrl+Shift+R)
3) Verify routes: /session, /calculator, /guide, /summary, /sheets, /roster (coach), /admin (coach), /profile

Firestore rules needed:
- Use the rules I sent earlier (roles, profiles, sessions, plans). Publish them.

Auth domain:
- Ensure your Cloudflare *.pages.dev domain is in Firebase Auth → Settings → Authorized domains.
