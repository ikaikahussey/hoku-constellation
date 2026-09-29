import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: '10mb' },
  },
  serverExternalPackages: ['pg', 'posthog-node', 'unpdf'],
  // lib/render/pdf.ts reads the embedded Arimo faces from disk; include them in every function that renders PDFs.
  outputFileTracingIncludes: {
    '/api/reports/**': ['./node_modules/@fontsource/arimo/files/arimo-latin*-{400,700}-*.woff'],
    '/api/briefings/**': ['./node_modules/@fontsource/arimo/files/arimo-latin*-{400,700}-*.woff'],
    '/api/cron/**': ['./node_modules/@fontsource/arimo/files/arimo-latin*-{400,700}-*.woff'],
    '/workspace/**': ['./node_modules/@fontsource/arimo/files/arimo-latin*-{400,700}-*.woff'],
  },
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
