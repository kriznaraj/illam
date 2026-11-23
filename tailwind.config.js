/**
 * Illam's design tokens.
 *
 * Every colour class (bg-gray-50, text-primary-600, border-red-200, ...) resolves to a CSS
 * variable, so one class works in both light and dark mode: dark mode swaps the variables,
 * not the markup. It follows the system setting unless a theme is chosen on the Account page.
 *
 * - `gray` is the neutral scale and `white` is the card surface. In dark mode the neutral
 *   scale is inverted (gray-900 text becomes light, gray-50 page background becomes dark).
 * - `primary` is the brand colour, a calm peacock teal. Use it for actions, links and the
 *   active navigation item.
 * - The status scales (green, red, amber, ...) keep Tailwind's hues; their dark values are
 *   derived below so tinted backgrounds stay subtle on a dark surface.
 *
 * @type {import('tailwindcss').Config}
 */
const defaultColors = require('tailwindcss/colors');
const plugin = require('tailwindcss/plugin');

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Hand-tuned scales. Light first, then dark (dark is the light scale inverted and re-tuned).
const neutral = {
  light: ['#f7f7f5', '#efefec', '#e3e3df', '#cfcfca', '#a2a29c', '#73736d', '#575752', '#42423e', '#2b2b28', '#1c1c1a', '#121211'],
  dark: ['#141413', '#242422', '#30302d', '#3e3e3b', '#6b6b66', '#94948e', '#b0b0aa', '#cacac5', '#e0e0dc', '#ededea', '#f7f7f5'],
};
const primary = {
  light: ['#f0f7f8', '#d9ecef', '#b5d9df', '#86bec8', '#519cab', '#337f8f', '#23687a', '#1e5565', '#1c4654', '#1a3b47', '#0d252e'],
  dark: ['#13262b', '#173239', '#1f4550', '#2c6170', '#45879a', '#5f9fb0', '#74b3c2', '#9bcbd6', '#c0dfe6', '#dcedf1', '#eef7f9'],
};
const surface = { light: '#ffffff', dark: '#1c1c1b' };

// Status hues used across the app. Their dark scales are computed from Tailwind's own values.
const STATUS = ['red', 'green', 'emerald', 'amber', 'yellow', 'orange', 'rose', 'purple', 'violet', 'indigo', 'teal'];

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, weightOfA) =>
  hexToRgb(a).map((c, i) => Math.round(c * weightOfA + hexToRgb(b)[i] * (1 - weightOfA)));
const channels = (rgb) => (Array.isArray(rgb) ? rgb : hexToRgb(rgb)).join(' ');

/** Dark mode reads a status scale backwards; the palest tints are blended into the surface. */
function darkStatusScale(scale) {
  const blend = { 50: 0.45, 100: 0.55, 200: 0.75 };
  return SHADES.map((shade) => {
    const mirrored = scale[1000 - shade] ?? scale[shade];
    return blend[shade] ? mix(mirrored, surface.dark, blend[shade]) : hexToRgb(mirrored);
  });
}

function scaleVars(name, values) {
  return Object.fromEntries(SHADES.map((shade, i) => [`--${name}-${shade}`, channels(values[i])]));
}

function tokens(mode) {
  const vars = {
    '--white': channels(surface[mode]),
    ...scaleVars('gray', neutral[mode]),
    ...scaleVars('primary', primary[mode]),
  };
  for (const name of STATUS) {
    const scale = defaultColors[name];
    Object.assign(vars, scaleVars(name, mode === 'light' ? SHADES.map((s) => scale[s]) : darkStatusScale(scale)));
  }
  return vars;
}

const scaleFromVars = (name) =>
  Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--${name}-${shade}) / <alpha-value>)`]));

module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}', './lib/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      black: '#000000',
      white: 'rgb(var(--white) / <alpha-value>)',
      gray: scaleFromVars('gray'),
      slate: scaleFromVars('gray'),
      primary: scaleFromVars('primary'),
      ...Object.fromEntries(STATUS.map((name) => [name, scaleFromVars(name)])),
    },
    extend: {
      fontFamily: {
        // System fonts: nothing to download at build or run time, and every OS ships a Tamil face.
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'Roboto',
          '"Noto Sans"',
          '"Helvetica Neue"',
          'Arial',
          '"Noto Sans Tamil"',
          '"Tamil Sangam MN"',
          '"Nirmala UI"',
          'sans-serif',
        ],
      },
      borderRadius: {
        // One radius family: controls use lg, cards use xl.
        lg: '0.5rem',
        xl: '0.875rem',
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        // Follows the system unless the viewer picked a theme on the Account page, which sets
        // <html data-theme="light|dark"> (lib/theme.ts).
        ':root': { ...tokens('light'), colorScheme: 'light' },
        '@media (prefers-color-scheme: dark)': {
          ':root:not([data-theme="light"])': { ...tokens('dark'), colorScheme: 'dark' },
        },
        ':root[data-theme="dark"]': { ...tokens('dark'), colorScheme: 'dark' },
      });
    }),
  ],
};
