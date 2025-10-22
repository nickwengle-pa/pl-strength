PHASE 4 — Coach Tips + Trend Chart
----------------------------------
Copy these files into your project (overwrite where noted):

  NEW:
    src/components/CoachTips.tsx
    src/components/TrendMini.tsx

  OVERWRITE:
    src/routes/Session.tsx

Then restart dev:
  npm run dev
Hard refresh the browser (Ctrl+Shift+R).

What you get:
- Live Coach Tips (contextual to week, lift, AMRAP result, TM, and PR status).
- Mini trend chart (SVG sparkline) of estimated 1RM for the selected lift.
- Deload protection (Week 4 disables AMRAP save).
- Zero new dependencies; pure TS/React.

No index required changes:
- Sessions queries use createdAt DESC + in-memory filter (already patched).
