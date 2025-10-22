/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  "#fff1f2",
          100: "#ffe4e6",
          200: "#fecdd3",
          300: "#fda4af",
          400: "#fb7185",
          500: "#ef4444",
          600: "#7a0f18", /* Dragons primary */
          700: "#640d14",
          800: "#4c0a10",
          900: "#33070b"
        }
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)"
      },
      borderRadius: {
        '2xl': '1rem',
      }
    }
  },
  plugins: [],
};
