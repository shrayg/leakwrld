/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./client/index.html', './client/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        'bg-card': 'var(--color-bg-card)',
        'bg-elevated': 'var(--color-bg-elevated)',
        primary: 'var(--color-primary)',
        'primary-soft': 'var(--color-pink-soft)',
        text: 'var(--color-text)',
        'text-muted': 'var(--color-text-muted)',
        lock: 'var(--color-lock)',
        premium: 'var(--color-premium-border)',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
