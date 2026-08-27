import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: '/lat.md', destination: '/lat.md/index.html' },
      {
        source: '/lat.md/docs/:path*',
        destination: '/lat.md/docs/:path*/index.html',
      },
      {
        source: '/lat.md/code/:path*',
        destination: '/lat.md/code/:path*/index.html',
      },
      { source: '/lat.md/graph', destination: '/lat.md/graph/index.html' },
    ];
  },
};

export default nextConfig;
