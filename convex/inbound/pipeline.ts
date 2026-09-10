/**
 * Internal entry points for inbound messages. HTTP handlers in
 * `convex/inbound/http.ts` call `receive`; the owner-facing inbox API lives in
 * `convex/inbox.ts`.
 */
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { consumeRateLimit, receiveInbound } from "../services/inbox";

export const inboundArgs = {
  channel: v.string(),
  body: v.string(),
  externalId: v.optional(v.string()),
  externalSenderId: v.optional(v.string()),
  senderName: v.optional(v.string()),
  handle: v.optional(v.string()),
  phone: v.optional(v.string()),
  email: v.optional(v.string()),
  subject: v.optional(v.string()),
  language: v.optional(v.union(v.literal("ar"), v.literal("en"))),
  receivedAt: v.optional(v.number()),
  source: v.union(v.literal("webhook"), v.literal("website"), v.literal("simulation")),
};

export const receive = internalMutation({
  args: inboundArgs,
  handler: async (ctx, args) => {
    return await receiveInbound(ctx, { ...args, channel: args.channel as Doc<"interactions">["channel"] });
  },
});

export const rateLimit = internalMutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { key, limit, windowMs }) => await consumeRateLimit(ctx, key, limit, windowMs),
});
