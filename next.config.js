/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server for the Docker image (Dockerfile).
  output: 'standalone',
  // Type errors are checked by `pnpm exec tsc --noEmit` (CI), not during the build.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Illam doesn't use next/image; images are served as they are (the optimizer at
  // /_next/image is also blocked in docker/Caddyfile).
  images: {
    unoptimized: true,
  },
  // Pages that moved: keep old links and bookmarks working.
  async redirects() {
    return [{ source: '/expenses/income', destination: '/cash-flow/income', permanent: true }];
  },
};

module.exports = nextConfig;
