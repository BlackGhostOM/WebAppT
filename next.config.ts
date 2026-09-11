import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

/**
 * The Convex deployment URLs are public (they ship in the client bundle), so the
 * company's cloud deployment is the default when the hosting platform has no
 * environment variables yet. Environment variables always win.
 */
const DEFAULT_CONVEX_URL = "https://quiet-hyena-590.convex.cloud";
const DEFAULT_CONVEX_SITE_URL = "https://quiet-hyena-590.convex.site";
/** Sentry DSN: a public write-only key by design (it ships in every browser bundle). Set NEXT_PUBLIC_SENTRY_DSN="" to disable. */
const DEFAULT_SENTRY_DSN = "https://7b613acbe3619be26d78e021463d05ab@o4512067724836864.ingest.us.sentry.io/4512067731259392";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL ?? DEFAULT_CONVEX_URL,
    NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? DEFAULT_CONVEX_SITE_URL,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN ?? DEFAULT_SENTRY_DSN,
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
