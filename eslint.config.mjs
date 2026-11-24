import nextVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextVitals,
  {
    // New in eslint-config-next 16 (React Compiler checks). The existing code predates them;
    // they warn until it is cleaned up, so new findings stay visible without failing lint.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'public/sw.js', 'coverage/**'] },
];

export default config;
