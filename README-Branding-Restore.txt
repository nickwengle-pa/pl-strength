WHAT THIS PATCH DOES
--------------------
- Restores your original branded look: dragon logo in the navbar, maroon brand color, card layout.
- Adds a Home page with the four big cards (PDF, Quick Summary, Calculator, Sheets).
- Ensures Tailwind uses a custom 'brand' palette (primary maroon = #7a0f18).

HOW TO APPLY
------------
1) Copy the contents of this zip into your project root, preserving paths.
   - public/assets/dragon.png (and pl.png if you want the school mark somewhere)
   - src/components/Nav.tsx
   - src/routes/Home.tsx
   - src/App.tsx
   - src/index.css (updates)
   - tailwind.config.cjs (adds brand color)
2) Restart the dev server: Ctrl+C then `npm run dev` and hard refresh (Ctrl+Shift+R).

NOTES
-----
- If you want to tweak the brand color, edit tailwind.config.cjs -> theme.extend.colors.brand. 
- Use classes like `bg-brand-600`, `hover:bg-brand-700`, `text-brand-600` in your components.
- Logos are served from /assets/*.png under /public.
