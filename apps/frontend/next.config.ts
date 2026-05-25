import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Necesario para el Dockerfile de producción
  output: 'standalone',

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.cloudflare.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '*' },
    ],
  },
};

export default nextConfig;
