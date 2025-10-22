
import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        plred: '#8B1C21',
        plgray: '#B9B9B9',
        plblack: '#121212',
      },
      borderRadius: { '2xl': '1.25rem' }
    },
  },
  plugins: [],
} satisfies Config
