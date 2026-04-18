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
        },
        v2: {
          surface: {
            50:  "#F8FAFC", 100: "#F1F5F9", 200: "#E2E8F0", 300: "#CBD5E1",
            400: "#94A3B8", 500: "#64748B", 600: "#475569", 700: "#334155",
            800: "#1E293B", 900: "#0F172A", 950: "#020617"
          },
          ink: {
            50:  "#F8FAFC", 100: "#F1F5F9", 200: "#E5E7EB", 300: "#D1D5DB",
            400: "#9CA3AF", 500: "#6B7280", 600: "#4B5563", 700: "#374151",
            800: "#1F2937", 900: "#111827", 950: "#030712"
          },
          accent: {
            50:  "#FFF1F2", 100: "#FFE4E6", 200: "#FECDD3", 300: "#FDA4AF",
            400: "#F87171", 500: "#DC2626", 600: "#B91C1C", 700: "#7A0F18",
            800: "#640D14", 900: "#4C0A10", 950: "#33070B"
          },
          success: {
            50:  "#ECFDF5", 100: "#D1FAE5", 200: "#A7F3D0", 300: "#6EE7B7",
            400: "#34D399", 500: "#10B981", 600: "#059669", 700: "#047857",
            800: "#065F46", 900: "#064E3B", 950: "#022C22"
          },
          warn: {
            50:  "#FFFBEB", 100: "#FEF3C7", 200: "#FDE68A", 300: "#FCD34D",
            400: "#FBBF24", 500: "#F59E0B", 600: "#D97706", 700: "#B45309",
            800: "#92400E", 900: "#78350F", 950: "#451A03"
          },
          danger: {
            50:  "#FFF1F2", 100: "#FFE4E6", 200: "#FECDD3", 300: "#FDA4AF",
            400: "#FB7185", 500: "#F43F5E", 600: "#E11D48", 700: "#BE123C",
            800: "#9F1239", 900: "#881337", 950: "#4C0519"
          },
          info: {
            50:  "#EFF6FF", 100: "#DBEAFE", 200: "#BFDBFE", 300: "#93C5FD",
            400: "#60A5FA", 500: "#3B82F6", 600: "#2563EB", 700: "#1D4ED8",
            800: "#1E40AF", 900: "#1E3A8A", 950: "#172554"
          }
        }
      },
      fontFamily: {
        "v2-heading": ['"Barlow Condensed"', "system-ui", "sans-serif"],
        "v2-body":    ['Barlow', "system-ui", "sans-serif"],
        "v2-mono":    ['"JetBrains Mono"', "ui-monospace", "monospace"]
      },
      fontSize: {
        "v2-xs":      ["12px", "16px"],
        "v2-sm":      ["14px", "20px"],
        "v2-base":    ["16px", "24px"],
        "v2-lg":      ["18px", "28px"],
        "v2-xl":      ["22px", "28px"],
        "v2-2xl":     ["28px", "32px"],
        "v2-3xl":     ["34px", "36px"],
        "v2-display": ["56px", "56px"]
      },
      spacing: {
        touch: "44px",
        "touch-lg": "56px",
        "gutter-mobile": "16px"
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)",
        "v2-elev-1":   "0 1px 2px rgba(2,6,23,.06), 0 1px 3px rgba(2,6,23,.08)",
        "v2-elev-2":   "0 4px 6px rgba(2,6,23,.05), 0 10px 15px rgba(2,6,23,.08)",
        "v2-elev-3":   "0 10px 15px rgba(2,6,23,.1), 0 20px 25px rgba(2,6,23,.1)",
        "v2-glow-pr":  "0 0 16px rgba(251,191,36,.55), 0 0 40px rgba(251,191,36,.25)"
      },
      borderRadius: {
        '2xl':    '1rem',
        'v2-sm':  '6px',
        'v2-md':  '10px',
        'v2-lg':  '14px',
        'v2-xl':  '20px',
        'v2-2xl': '28px',
        'v2-full': '9999px'
      },
      transitionDuration: {
        "v2-quick": "150ms",
        "v2-base":  "200ms",
        "v2-slow":  "300ms"
      },
      transitionTimingFunction: {
        "v2-standard": "cubic-bezier(0.2, 0, 0, 1)",
        "v2-entrance": "cubic-bezier(0.16, 1, 0.3, 1)"
      }
    }
  },
  plugins: [],
};
