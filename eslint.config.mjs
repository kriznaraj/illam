import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    // Fail on any warning too: unused disable directives, hook dependency lists, etc.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'coverage/**'] },
];

export default config;
