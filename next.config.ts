import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * The Convex deployment URLs are public (they ship in the client bundle), so the
 * company's cloud deployment is the default when the hosting platform has no
 * environment variables yet. Environment variables always win.
 */
const DEFAULT_CONVEX_URL = "https://quiet-hyena-590.convex.cloud";
const DEFAULT_CONVEX_SITE_URL = "https://quiet-hyena-590.convex.site";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? DEFAULT_CONVEX_URL,
    NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? DEFAULT_CONVEX_SITE_URL,
  },
};

/**
 * Sentry build plugin. Runtime reporting is switched on by NEXT_PUBLIC_SENTRY_DSN
 * alone; source-map upload additionally needs SENTRY_AUTH_TOKEN + SENTRY_ORG +
 * SENTRY_PROJECT at build time (skipped silently otherwise). The tunnel route
 * lets browser events reach Sentry through our own origin (ad blockers).
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
