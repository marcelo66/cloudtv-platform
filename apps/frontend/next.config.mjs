/** @type {import('next').NextConfig} */
const nextConfig = {
  // Necesario para el Dockerfile de producción
  output: 'standalone',

  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.r2.dev' },
      { protocol: 'https', hostname: '**.cloudflare.com' },
      { protocol: 'https', hostname: '**.easypanel.host' },
      { protocol: 'https', hostname: '**.mfdesarrollos.com' },
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: 'minio' },
      { protocol: 'http', hostname: '*' },
    ],
  },
};

export default nextConfig;
