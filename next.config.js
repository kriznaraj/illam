/** @type {import('next').NextConfig} */
const nextConfig = {
  // A self-contained server for the Docker image (Dockerfile).
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { dev }) => {
    // Avoid frequent "Cannot find module './vendor-chunks/...'" in dev by
    // disabling persistent filesystem cache (uses in-memory cache instead).
    if (dev) {
      config.cache = false;
    }
    return config;
  },
  images: {
    domains: [],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
}

module.exports = nextConfig
