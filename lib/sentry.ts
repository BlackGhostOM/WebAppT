/**
 * Shared Sentry options for the three Next.js runtimes (client, server, edge).
 * Reporting is enabled only when a DSN is present (`NEXT_PUBLIC_SENTRY_DSN`;
 * the server may also use `SENTRY_DSN`). No session replay, no default PII,
 * every outgoing string redacted, expected application errors dropped.
 */
import type * as Sentry from "@sentry/nextjs";
import { isExpectedErrorText, redactDeep, redactPii } from "./observability";

type Options = NonNullable<Parameters<typeof Sentry.init>[0]>;

export function sentryOptions(runtime: "client" | "server" | "edge"): Options {
  const dsn = (runtime === "client" ? undefined : process.env.SENTRY_DSN) || process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn: dsn || undefined,
    enabled: !!dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    initialScope: { tags: { runtime: `nextjs-${runtime}` } },
    beforeSend(event) {
      const values = event.exception?.values ?? [];
      if (values.some((v) => isExpectedErrorText(v.value))) return null;
      for (const v of values) if (v.value) v.value = redactPii(v.value);
      if (event.message) event.message = redactPii(event.message);
      if (event.extra) event.extra = redactDeep(event.extra);
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url) event.request.url = redactPii(event.request.url);
        if (event.request.query_string) delete event.request.query_string;
      }
      delete event.user;
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.category === "console") return null;
      if (crumb.message) crumb.message = redactPii(crumb.message);
      if (crumb.data) crumb.data = redactDeep(crumb.data);
      return crumb;
    },
  };
}
