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

export default nextConfig;
