/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx}",
  ],
  theme: {
    extend: {
      colors: {
        dark: '#002147',
        fcc: {
          ink: 'var(--fcc-color-ink)',
          copy: 'var(--fcc-color-copy)',
          accent: 'var(--fcc-color-accent)',
        },
      }
    },
  },
  plugins: [],
}
