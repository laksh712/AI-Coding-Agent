/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0d0f12',
        surface: '#16191f',
        primary: '#3b82f6',
        sidebar: '#0f1115',
        border: '#222730',
        chatbg: '#1a1f26',
        textMain: '#f3f4f6',
        textMuted: '#9ca3af',
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
