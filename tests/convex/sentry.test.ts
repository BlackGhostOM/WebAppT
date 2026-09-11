import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { internal } from "../../convex/_generated/api";
import { authHeader, buildEnvelope, buildEvent, captureException, envelopeUrl, parseDsn, parseStack } from "../../convex/lib/sentry";
import { isExpectedErrorText, REDACTED, redactDeep, redactPii } from "../../lib/observability";
import { setup } from "./helpers";

const DSN = "https://abc123def@o4507.ingest.de.sentry.io/4509876";

describe("Observability — PII redaction", () => {
  it("removes e-mails, phone numbers and secrets but keeps business ids and dates", () => {
    const text = "Customer khalid@example.om (+968 91234567) on TSK-000008 / SCH-2026-000012 at 2026-09-11T08:30 key sk-ant-api03-abcdefghijklmnop re_cyeiQZG2_71HEmRC";
    const out = redactPii(text);
    expect(out).not.toContain("khalid@example.om");
    expect(out).not.toContain("91234567");
    expect(out).not.toContain("sk-ant-api03");
    expect(out).not.toContain("re_cyeiQZG2");
    expect(out).toContain("TSK-000008");
    expect(out).toContain("SCH-2026-000012");
    expect(out).toContain("2026-09-11T08:30");
    expect(out.split(REDACTED).length - 1).toBe(4);
  });

  it("redacts nested values and drops sensitive keys", () => {
    const out = redactDeep({ user: { email: "a@b.om", password: "hunter22", note: "call 99887766" }, apiKey: "x", list: ["c@d.om", 5] });
    expect(out).toEqual({ user: { email: REDACTED, password: REDACTED, note: `call ${REDACTED}` }, apiKey: REDACTED, list: [REDACTED, 5] });
  });

  it("recognises expected application errors in both message formats", () => {
    expect(isExpectedErrorText("VALIDATION: request: بين 10 و4000 حرف")).toBe(true);
    expect(isExpectedErrorText('ConvexError: {"code":"FORBIDDEN","message":"المالك فقط"}')).toBe(true);
    expect(isExpectedErrorText("Error: APPROVAL_REQUIRED: يحتاج اعتماد")).toBe(true);
    expect(isExpectedErrorText("TypeError: Cannot read properties of undefined")).toBe(false);
    expect(isExpectedErrorText("MODEL_ERROR: 400 tools.0: Country code OM is not supported")).toBe(false);
    expect(isExpectedErrorText(undefined)).toBe(false);
  });
});

describe("Observability — Sentry envelope reporter (Convex runtime)", () => {
  it("parses a DSN into the envelope endpoint and auth header", () => {
    const dsn = parseDsn(DSN)!;
    expect(dsn).toEqual({ protocol: "https", publicKey: "abc123def", host: "o4507.ingest.de.sentry.io", projectId: "4509876" });
    expect(envelopeUrl(dsn)).toBe("https://o4507.ingest.de.sentry.io/api/4509876/envelope/");
    expect(authHeader(dsn)).toContain("sentry_key=abc123def");
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn("https://o4507.ingest.sentry.io/123")).toBeNull();
  });

  it("builds a redacted event with a parsed stack trace and a three-line envelope", () => {
    const err = new Error("Provider rejected khalid@example.om");
    const event = buildEvent(err, { tags: { area: "model_call", agent: "product", model: undefined }, extra: { taskId: "TSK-000008", phone: "+968 99887766" } }, { environment: "prod", serverName: "quiet-hyena-590.convex.cloud" });
    expect(event.exception.values[0].type).toBe("Error");
    expect(event.exception.values[0].value).toBe(`Provider rejected ${REDACTED}`);
    expect(event.exception.values[0].stacktrace!.frames.length).toBeGreaterThan(0);
    expect(event.tags).toEqual({ runtime: "convex", area: "model_call", agent: "product" });
    expect(event.extra).toEqual({ taskId: "TSK-000008", phone: REDACTED });
    expect(event.environment).toBe("prod");
    expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
    const lines = buildEnvelope(event).trimEnd().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0]).event_id).toBe(event.event_id);
    expect(JSON.parse(lines[1]).type).toBe("event");
    expect(JSON.parse(lines[2]).exception.values[0].value).toBe(`Provider rejected ${REDACTED}`);
  });

  it("parses V8 stack lines oldest-first and marks node_modules as not in_app", () => {
    const frames = parseStack(["Error: x", "    at inner (file:///app/convex/agents/loop.ts:10:5)", "    at file:///app/node_modules/convex/dist/index.js:1:1"].join("\n"));
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ function: "<anonymous>", in_app: false, lineno: 1 });
    expect(frames[1]).toMatchObject({ function: "inner", in_app: true, lineno: 10, colno: 5 });
  });

  it("is a no-op without SENTRY_DSN and never throws when the transport fails", async () => {
    const fetchImpl = vi.fn();
    expect(await captureException(new Error("x"), {}, { env: {}, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await captureException(new Error("x"), {}, { env: { SENTRY_DSN: "garbage" }, fetchImpl })).toBe(false);
    const failing = vi.fn().mockRejectedValue(new Error("network down"));
    expect(await captureException(new Error("x"), {}, { env: { SENTRY_DSN: DSN }, fetchImpl: failing })).toBe(false);
    const rejected = vi.fn().mockResolvedValue(new Response("nope", { status: 429 }));
    expect(await captureException(new Error("x"), {}, { env: { SENTRY_DSN: DSN }, fetchImpl: rejected })).toBe(false);
  });

  it("posts a redacted envelope to the DSN's project when configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const ok = await captureException(new Error("Lead khalid@example.om failed"), { tags: { area: "http" } }, { env: { SENTRY_DSN: DSN, DEPLOYMENT_STAGE: "prod", CONVEX_CLOUD_URL: "https://quiet-hyena-590.convex.cloud" }, fetchImpl });
    expect(ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://o4507.ingest.de.sentry.io/api/4509876/envelope/");
    expect((init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=abc123def");
    const body = String(init.body);
    expect(body).not.toContain("khalid@example.om");
    expect(body).toContain("quiet-hyena-590.convex.cloud");
    expect(JSON.parse(body.trimEnd().split("\n")[2]).tags).toEqual({ runtime: "convex", area: "http" });
  });
});

describe("Observability — cron wrapper and report action", () => {
  it("runCron executes the referenced job mutation and surfaces its result", async () => {
    const h = await setup();
    const result = await h.t.action(internal.observability.runCron, { fn: getFunctionName(internal.customSchedules.runDue), args: {}, job: "customSchedules" });
    expect(result).toEqual({ fired: 0, skipped: 0 });
    const digest = await h.t.action(internal.observability.runCron, { fn: getFunctionName(internal.scheduled.run), args: { job: "dailyDigest" }, job: "dailyDigest" });
    expect(digest).toBeTruthy();
  });

  it("runCron re-throws a failing job so Convex still records the failure", async () => {
    const h = await setup();
    await expect(h.t.action(internal.observability.runCron, { fn: "scheduled:run", args: { job: "notAJob" }, job: "broken" })).rejects.toThrow();
  });

  it("report resolves false when no DSN is configured", async () => {
    const h = await setup();
    delete process.env.SENTRY_DSN;
    expect(await h.t.action(internal.observability.report, { message: "test", tags: { area: "test" } })).toBe(false);
  });
});
