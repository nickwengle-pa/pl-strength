
PHASE 2 PATCH — Firestore persistence (Training Max) + minimal Coach Roster
---------------------------------------------------------------------------
Copy these files into your project, overwriting where noted:
  - src/lib/db.ts                (new)
  - src/routes/Calculator.tsx    (overwrite)
  - src/routes/Roster.tsx        (new)
  - src/App.tsx                  (overwrite)

After copying:
  1) Ensure your header shows "Connected to Firebase".
  2) In the app, go to Calculator, compute a TM, click "Save as TM".
     - This saves locally AND to Firestore at: athletes/{uid}/profile/(meta|tm)
  3) As a coach (you created roles/{yourUID}), open /roster to list all athlete profiles.
     - It uses a collectionGroup('profile') query and filters the 'meta' docs.

Firestore structure used:
  - athletes/{uid}/profile/meta  -> { firstName, unit, updatedAt }
  - athletes/{uid}/profile/tm    -> { bench, squat, deadlift, press, updatedAt }
