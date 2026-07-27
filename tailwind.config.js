/** @type {import('tailwindcss').Config} */
// noBS CAD theme tokens are CSS variables defined in src/index.css.
// The `*-rgb` forms allow Tailwind opacity modifiers such as
// `bg-accent/40`; plain `var(--accent)` colors silently drop `/40`.
// (noBS CAD's dark mechanical-design theme).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        panel: 'rgb(var(--panel-rgb) / <alpha-value>)',
        header: 'rgb(var(--header-rgb) / <alpha-value>)',
        edge: 'rgb(var(--edge-rgb) / <alpha-value>)',
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        mute: 'rgb(var(--mute-rgb) / <alpha-value>)',
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        finish: 'rgb(var(--finish-rgb) / <alpha-value>)',
        sketchline: 'rgb(var(--sketchline-rgb) / <alpha-value>)',
        dimgreen: 'rgb(var(--dimgreen-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        vptop: 'rgb(var(--vp-top-rgb) / <alpha-value>)',
        vpbottom: 'rgb(var(--vp-bottom-rgb) / <alpha-value>)',
        viewport: 'rgb(var(--viewport-rgb) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
