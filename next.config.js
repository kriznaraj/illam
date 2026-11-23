/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server for the Docker image (Dockerfile).
  output: 'standalone',
  // Type errors are checked by `pnpm exec tsc --noEmit` (CI), not during the build.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Pages that moved: keep old links and bookmarks working.
  async redirects() {
    return [{ source: '/expenses/income', destination: '/cash-flow/income', permanent: true }];
  },
  webpack: (config, { dev }) => {
    // Avoid frequent "Cannot find module './vendor-chunks/...'" in dev by
    // disabling persistent filesystem cache (uses in-memory cache instead).
    if (dev) {
      config.cache = false;
    }
    return config;
  },
};

module.exports = nextConfig;
