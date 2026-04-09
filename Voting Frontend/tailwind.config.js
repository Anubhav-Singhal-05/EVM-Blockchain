// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // <-- Ensures it scans all React components
  ],
  theme: { 
    extend: {
      colors: {
        appBg: '#0f111a',
        cardBg: '#1e2130',
        cardBorder: '#2a2d40',
        textMain: '#e2e8f0',
        textMuted: '#94a3b8',
        accentBlue: '#3b82f6',
        accentGreen: '#10b981',
        accentRed: '#ef4444'
      }
    } 
  },
  plugins: [],
}