import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/lat.md', destination: '/lat.md/index.html' },
      {
        source: '/lat.md/:path*',
        destination: '/lat.md/:path*/index.html',
      },
    ];
  },
};

export default nextConfig;
