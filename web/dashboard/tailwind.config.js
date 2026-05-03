import typography from '@tailwindcss/typography';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:              '#0b0d10',
        surface:         '#14171c',
        'surface-2':     '#1a1e25',
        border:          '#262b33',
        'border-strong': '#3a4150',
        text:            '#e6e8eb',
        'text-muted':    '#9aa3b2',
        'text-dim':      '#7d8694',
        accent:          '#7aa2ff',
        'accent-soft':   '#1f2a44',
        success:         '#4ade80',
        warning:         '#fbbf24',
        danger:          '#f87171',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [typography],
};
