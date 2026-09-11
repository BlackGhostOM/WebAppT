import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentry";

Sentry.init(sentryOptions("client"));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
