PHASE 5 — Guide PDF, Quick Summary, Printable/Fillable Sheets
-------------------------------------------------------------
FILES (add/overwrite):
  NEW routes:
    src/routes/Guide.tsx      (embeds full PDF)
    src/routes/Summary.tsx    (coach-facing quick summary)
    src/routes/Sheets.tsx     (printable/fillable tables, save to Firestore)
  NEW lib:
    src/lib/plan.ts           (plan builder + Firestore save/list)
  PUBLIC asset placeholder:
    public/docs/531-lifting.pdf  <-- Put your actual program PDF here (rename as needed)

ROUTER HOOKUP (add routes & nav):
  In your router (usually src/App.tsx or src/main.tsx where Routes are defined), add:
    import Guide from './routes/Guide';
    import Summary from './routes/Summary';
    import Sheets from './routes/Sheets';

    <Route path="/guide" element={<Guide/>} />
    <Route path="/summary" element={<Summary/>} />
    <Route path="/sheets" element={<Sheets/>} />

  And add links in your navbar/menu:
    <Link to="/guide">Guide PDF</Link>
    <Link to="/summary">Quick Summary</Link>
    <Link to="/sheets">Printable Sheets</Link>

FIRESTORE RULES UPDATE (allow plans storage):
  Add alongside your sessions rules:
    match /athletes/{uid}/plans/{pid} {
      allow read: if isSelf(uid) || isCoach();
      allow create: if isSelf(uid);
      allow update, delete: if isSelf(uid);
    }

DEPLOY NOTES:
  - Ensure your Cloudflare domain is in Firebase Auth → Settings → Authorized domains.
  - PDF is served from /docs/531-lifting.pdf. If you use another name/path, update Guide.tsx accordingly.

PRINTING TO PDF:
  - Click “Print / Save as PDF” → choose “Save as PDF” in the browser print dialog.
  - Inputs typed into the table will render on the PDF.

No new NPM deps. Pure React/TS with your existing Tailwind styles.
