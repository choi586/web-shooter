import type { NextConfig } from 'next';

const nextConfig: NextConfig = {};

if (process.env.GITHUB_PAGES === 'true') {
  const basePath = '/web-shooter';

  nextConfig.output = 'export';
  nextConfig.basePath = basePath;
  nextConfig.assetPrefix = basePath;
  nextConfig.trailingSlash = true;
  nextConfig.images = { unoptimized: true };
}

export default nextConfig;
