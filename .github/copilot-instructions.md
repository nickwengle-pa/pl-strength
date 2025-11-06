This file gives actionable, repo-specific instructions to AI coding assistants (Copilot/agents) so they can be productive quickly.

Project snapshot
- Framework: React + TypeScript (Vite).
- Router: react-router-dom using HashRouter (see `src/main.tsx`).
- State/Context: `src/lib/auth.tsx`, `context/ActiveAthleteContext.tsx`, `src/lib/device.tsx`.
- Backend: Firebase (optional/defensive). Initialization lives in `src/lib/firebase.ts`; Firestore helpers and domain logic live in `src/lib/db.ts`.
- Styling: Tailwind CSS (`index.css`, `tailwind.config.*`).
- PWA: `public/manifest.webmanifest` and `public/sw.js`. Service worker is registered only in production (see `src/main.tsx`).

Primary developer workflows (how to run & build)
- Start dev server: `npm run dev` (uses Vite). See `package.json` scripts.
- Build for production: `npm run build` and locally preview: `npm run preview`.
- Environment vars: Firebase config can come from a global `__FBCONFIG__` object or Vite env vars prefixed with `VITE_FIREBASE_*` (see `src/lib/firebase.ts`).

Key repository conventions & patterns
- Defensive Firebase: code must handle the absence of Firebase (offline/local mode). Use `tryInitFirebase()` / `fb` from `src/lib/firebase.ts` and `src/lib/db.ts` helpers. Many functions fall back to local storage when Firebase is not available.
- Cached singletons: Firebase handles are cached in module scope; use provided reset helpers carefully (e.g. `resetFirebaseCache()` / `resetRoleCache()` in `src/lib/db.ts`).
- Auth flow: email-link sign-in is implemented (look for `isSignInWithEmailLink` usage and the local storage key `pl-strength-coach-email` in `src/lib/auth.tsx`).
- UID model: code uses a sentinel `LOCAL_UID = "local"` when no Firebase user exists; be careful when assuming a real uid.
- Routes and pages: pages are under `src/routes/*`. Add new pages by adding components and registering routes in `src/App.tsx`.
- Styling: utility-first Tailwind; components expect Tailwind classes in JSX. Global CSS is in `src/index.css` and there are `tailwind.config.*` files at project root.

Integration points and important files to inspect for changes
- Firebase init & detection: `src/lib/firebase.ts` (how env/global config is resolved).
- Firestore models and rules of thumb: `src/lib/db.ts` (profile model, roles doc, equipment normalization). Use this file to understand data shapes and transactions.
- Auth context & sign-out: `src/lib/auth.tsx` (exposes `useAuth()` and `AuthProvider`).
- App shell & routing: `src/App.tsx` (where protected routes are enforced — app returns `<SignIn/>` when unauthenticated).
- PWA and SW behavior: `src/main.tsx` and `public/sw.js` (SW registers only in production; dev clears caches and unregisters SW).

Small examples to follow
- Read profile: call `loadProfileRemote(uid?)` in `src/lib/db.ts` to fetch normalized `Profile` objects.
- Check Firebase presence: `if (!fb.db) { /* fallback to local storage */ }`.
- Add a new route: create `src/routes/YourPage.tsx` and add a `<Route path="/your" element={<YourPage/>} />` in `src/App.tsx`.

Testing, linting, and CI notes
- No test framework or CI configs are present in the repo root. Keep changes small and run the dev server to smoke-test.

Change guidance for contributors/agents
- Preserve the defensive null-safe checks around Firebase when editing `src/lib/*` files.
- If you add new Vite env variables, prefix them with `VITE_` and document them in the repo README.
- Avoid assuming service worker availability during development — use the code in `src/main.tsx` as the canonical behavior.

If something here is unclear or you want more detail (data shapes, typical Firestore document examples, or a recommended dev env for Firebase emulators), tell me which area to expand and I'll iterate.
