/**
 * Public HTTP endpoints (section 3.4):
 *   GET  /webhooks/instagram  — Meta verification handshake
 *   POST /webhooks/instagram  — Instagram messaging events (X-Hub-Signature-256 verified)
 *   POST /api/contact         — website contact form (rate limited, honeypot)
 *
 * Mock mode: without META_APP_SECRET the webhook accepts unsigned payloads and
 * logs that fact, so development can run before the Meta app is connected.
 */
import { type ActionCtx, httpAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { errorMessage } from "../lib/errors";
import { captureException } from "../lib/sentry";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** Public endpoint wrapper: an unexpected failure is reported (Sentry) and answered with a generic 500, never a stack trace. */
function guarded(opts: { name: string; headers?: Record<string, string> }, handler: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction(async (ctx, request) => {
    try {
      return await handler(ctx, request);
    } catch (e) {
      console.error(`[${opts.name}]`, errorMessage(e));
      await captureException(e, { tags: { area: "http", endpoint: opts.name }, extra: { method: request.method, path: new URL(request.url).pathname } });
      return json({ error: "internal" }, 500, opts.headers);
    }
  });
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("cf-connecting-ip") || "unknown";
}

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const instagramVerify = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
});

interface MetaMessagingEvent {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: { type?: string }[] };
}

export const instagramWebhook = guarded({ name: "instagram_webhook" }, async (ctx, request) => {
  const raw = await request.text();
  const secret = process.env.META_APP_SECRET;
  if (secret) {
    const header = request.headers.get("x-hub-signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(secret, raw)}`;
    if (!header || !timingSafeEqual(header, expected)) return new Response("invalid signature", { status: 401 });
  } else {
    console.warn("[instagram webhook] META_APP_SECRET not set — accepting unsigned payload (mock mode)");
  }
  let payload: { object?: string; entry?: { id?: string; time?: number; messaging?: MetaMessagingEvent[] }[] };
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (payload.object !== "instagram" && payload.object !== "page") return new Response("ignored", { status: 200 });
  let received = 0;
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const text = event.message?.text?.trim();
      if (!text || event.message?.is_echo || !event.sender?.id) continue;
      await ctx.runMutation(internal.inbound.pipeline.receive, {
        channel: "INSTAGRAM",
        body: text,
        externalId: event.message?.mid ?? `${event.sender.id}-${event.timestamp ?? Date.now()}`,
        externalSenderId: event.sender.id,
        handle: event.sender.username,
        receivedAt: event.timestamp ? (event.timestamp < 1e12 ? event.timestamp * 1000 : event.timestamp) : undefined,
        source: "webhook",
      });
      received += 1;
    }
  }
  return json({ received });
});

export const contactOptions = httpAction(async () => new Response(null, { status: 204, headers: CORS }));

export const contactForm = guarded({ name: "contact_form", headers: CORS }, async (ctx, request) => {
  const allowed = await ctx.runMutation(internal.inbound.pipeline.rateLimit, { key: `contact:${clientKey(request)}`, limit: 10, windowMs: 60_000 });
  if (!allowed) return json({ error: "rate_limited" }, 429, CORS);
  let body: Record<string, unknown> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    if (type.includes("application/json")) body = (await request.json()) as Record<string, unknown>;
    else {
      const form = await request.formData();
      form.forEach((value, key) => {
        body[key] = typeof value === "string" ? value : "";
      });
    }
  } catch {
    return json({ error: "bad_request" }, 400, CORS);
  }
  // Honeypot: bots fill the hidden field.
  if (typeof body.website === "string" && body.website.trim() !== "") return json({ ok: true }, 200, CORS);
  const name = String(body.name ?? "").trim();
  const message = String(body.message ?? "").trim();
  const phone = typeof body.phone === "string" ? body.phone.trim() : undefined;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined;
  if (name.length < 2 || message.length < 5) return json({ error: "validation", fields: { name: name.length < 2, message: message.length < 5 } }, 422, CORS);
  if (!phone && !email) return json({ error: "validation", fields: { contact: true } }, 422, CORS);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "validation", fields: { email: true } }, 422, CORS);
  const result = await ctx.runMutation(internal.inbound.pipeline.receive, {
    channel: "WEBSITE",
    body: message.slice(0, 5000),
    senderName: name.slice(0, 120),
    phone: phone?.slice(0, 40),
    email: email?.slice(0, 120),
    subject: typeof body.subject === "string" ? body.subject.slice(0, 200) : undefined,
    language: body.language === "en" ? "en" : body.language === "ar" ? "ar" : undefined,
    externalId: typeof body.requestId === "string" ? `web-${body.requestId.slice(0, 64)}` : undefined,
    source: "website",
  });
  return json({ ok: true, reference: result.interactionId }, 200, CORS);
});
