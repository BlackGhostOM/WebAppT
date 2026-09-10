/**
 * Next.js 16 proxy (formerly middleware): every route except the auth pages
 * requires a signed-in user. This is a UX guard only; the real protection is
 * `ctx.auth` inside every Convex function.
 */
import { convexAuthNextjsMiddleware, createRouteMatcher, nextjsMiddlewareRedirect } from "@convex-dev/auth/nextjs/server";

const isPublicRoute = createRouteMatcher(["/login", "/reset-password"]);

export default convexAuthNextjsMiddleware(
  async (request, { convexAuth }) => {
    const authenticated = await convexAuth.isAuthenticated();
    if (isPublicRoute(request)) {
      if (authenticated) return nextjsMiddlewareRedirect(request, "/dashboard");
      return;
    }
    if (!authenticated) return nextjsMiddlewareRedirect(request, "/login");
  },
  { cookieConfig: { maxAge: 7 * 24 * 60 * 60 } },
);

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
