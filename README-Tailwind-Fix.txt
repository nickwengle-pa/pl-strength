PATCH CONTENTS
==============
- postcss.config.cjs
- tailwind.config.cjs
- src/index.css            (Tailwind layers + small helpers)
- src/main.tsx             (imports index.css and ensures only one router)
- src/ErrorBoundary.tsx    (visible error UI instead of white screen)

INSTALL STEPS
=============
1) Copy these files into your project root, preserving the same paths.
2) Install Tailwind toolchain if not present:
   npm i -D tailwindcss postcss autoprefixer
3) Restart dev server:
   Ctrl+C
   npm run dev
4) Hard refresh the browser (Ctrl+Shift+R).

TROUBLESHOOTING
===============
- If styles still don't render, open DevTools > Network and verify /src/index.css is loaded.
- Ensure tailwind.config.cjs 'content' globs include: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"].
- If a service worker was previously installed, the provided main.tsx auto-unregisters it in dev.
