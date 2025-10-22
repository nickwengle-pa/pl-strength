
PHASE 3 PATCH — Sessions logging (AMRAP + PR) with history
----------------------------------------------------------
Copy these files into your project (overwrite where noted):
  - src/lib/db.ts                (overwrite; adds sessions helpers)
  - src/routes/Session.tsx       (new)
  - src/routes/Home.tsx          (overwrite; adds Train tile)
  - src/App.tsx                  (overwrite; adds /session route + nav link)

Then restart the dev server:
  npm run dev

Use it:
  1) Ensure Calculator has saved a TM for a lift.
  2) Open /session, pick lift + week, enter AMRAP reps on last set, Save.
  3) A session doc is written to Firestore at athletes/{uid}/sessions/{autoId}.
  4) The history panel shows your last 5 sessions for that lift. New PRs are flagged.
