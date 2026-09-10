/**
 * Tells Convex which JWT issuer to trust. With Convex Auth the deployment itself
 * issues tokens, so the domain is the deployment's site URL.
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
