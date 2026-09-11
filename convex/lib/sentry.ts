/**
 * Minimal Sentry reporter for the Convex runtime.
 *
 * Convex functions run in a custom V8 isolate where the official Node/browser
 * SDKs do not load, and Convex's built-in exception-reporting integration is a
 * paid-plan feature. This module speaks the stable envelope protocol directly
 * with `fetch`, so any action (or an HTTP action) can report an exception.
 * Mutations cannot reach the network: they schedule `internal.observability.report`.
 *
 * Explicit no-op mode: without `SENTRY_DSN` nothing is sent and `captureException`
 * resolves to `false`. The reporter never throws — an unreachable Sentry must
 * not turn a recoverable error into a failed task.
 */
import { redactDeep, redactPii } from "../../lib/observability";

export interface SentryDsn {
  protocol: string;
  publicKey: string;
  host: string;
  projectId: string;
}

export interface CaptureContext {
  tags?: Record<string, string | undefined>;
  extra?: Record<string, unknown>;
  level?: "fatal" | "error" | "warning";
  fingerprint?: string[];
}

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

export interface SentryEvent {
  event_id: string;
  timestamp: number;
  platform: "javascript";
  level: "fatal" | "error" | "warning";
  environment: string;
  release?: string;
  server_name?: string;
  tags: Record<string, string>;
  extra?: Record<string, unknown>;
  fingerprint?: string[];
  exception: { values: { type: string; value: string; stacktrace?: { frames: StackFrame[] }; mechanism: { type: string; handled: boolean } }[] };
}

/** `https://<publicKey>@<host>/<projectId>` → parts, or null when malformed. */
export function parseDsn(dsn: string): SentryDsn | null {
  try {
    const url = new URL(dsn.trim());
    const projectId = url.pathname.replace(/\/+$/, "").split("/").pop() ?? "";
    if (!url.username || !/^\d+$/.test(projectId)) return null;
    return { protocol: url.protocol.replace(":", ""), publicKey: url.username, host: url.host, projectId };
  } catch {
    return null;
  }
}

export function envelopeUrl(dsn: SentryDsn): string {
  return `${dsn.protocol}://${dsn.host}/api/${dsn.projectId}/envelope/`;
}

export function authHeader(dsn: SentryDsn): string {
  return `Sentry sentry_version=7, sentry_client=ops-center-convex/1.0, sentry_key=${dsn.publicKey}`;
}

/** V8 stack (`at fn (file:line:col)`) → Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at\s+(?:(.*?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    const filename = m[2];
    frames.push({ function: m[1] || "<anonymous>", filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node_modules|node:internal/.test(filename) });
  }
  return frames.reverse();
}

function eventId(): string {
  try {
    return crypto.randomUUID().replace(/-/g, "");
  } catch {
    return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  }
}

export function buildEvent(err: unknown, ctx: CaptureContext, env: { environment: string; release?: string; serverName?: string }): SentryEvent {
  const error = err instanceof Error ? err : undefined;
  const tags: Record<string, string> = { runtime: "convex" };
  for (const [k, v] of Object.entries(ctx.tags ?? {})) if (v !== undefined) tags[k] = redactPii(String(v)).slice(0, 200);
  const frames = parseStack(error?.stack);
  return {
    event_id: eventId(),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: ctx.level ?? "error",
    environment: env.environment,
    release: env.release,
    server_name: env.serverName,
    tags,
    extra: ctx.extra ? redactDeep(ctx.extra) : undefined,
    fingerprint: ctx.fingerprint,
    exception: {
      values: [
        {
          type: error?.name || "Error",
          value: redactPii(error ? error.message : String(err)).slice(0, 4000),
          stacktrace: frames.length > 0 ? { frames } : undefined,
          mechanism: { type: "generic", handled: true },
        },
      ],
    },
  };
}

/** Envelope = header line + item header line + payload line. */
export function buildEnvelope(event: SentryEvent): string {
  const header = JSON.stringify({ event_id: event.event_id, sent_at: new Date().toISOString() });
  const item = JSON.stringify({ type: "event", content_type: "application/json" });
  return `${header}\n${item}\n${JSON.stringify(event)}\n`;
}

export interface CaptureOptions {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

/**
 * Reports `err` to Sentry when `SENTRY_DSN` is set. Resolves `true` when the
 * event was accepted, `false` when reporting is off or failed. Never throws.
 */
export async function captureException(err: unknown, ctx: CaptureContext = {}, options: CaptureOptions = {}): Promise<boolean> {
  const env = options.env ?? process.env;
  const raw = env.SENTRY_DSN;
  if (!raw) return false;
  const dsn = parseDsn(raw);
  if (!dsn) {
    console.warn("[sentry] SENTRY_DSN is not a valid DSN — reporting disabled");
    return false;
  }
  let serverName: string | undefined;
  try {
    serverName = env.CONVEX_CLOUD_URL ? new URL(env.CONVEX_CLOUD_URL).host : undefined;
  } catch {
    serverName = undefined;
  }
  const event = buildEvent(err, ctx, { environment: env.DEPLOYMENT_STAGE ?? "dev", release: env.SENTRY_RELEASE, serverName });
  try {
    const send = options.fetchImpl ?? fetch;
    const res = await send(envelopeUrl(dsn), {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": authHeader(dsn) },
      body: buildEnvelope(event),
    });
    if (!res.ok) console.warn(`[sentry] envelope rejected: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn("[sentry] send failed:", e instanceof Error ? e.message : String(e));
    return false;
  }
}
