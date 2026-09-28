import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  serverExternalPackages: ['pg', 'posthog-node', 'unpdf'],
  async rewrites() {
    // PostHog reverse proxy so ad blockers do not drop events (US cloud).
    return [
      { source: '/ingest/static/:path*', destination: 'https://us-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://us.i.posthog.com/:path*' },
    ]
  },
  // PostHog client library requires trailing slashes to be preserved on /ingest
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
