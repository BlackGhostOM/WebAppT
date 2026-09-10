/**
 * Booking services: per-service statuses and confirmation evidence (owner UI).
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireUser } from "./lib/actor";
import { addBookingService, changeBookingServiceStatus, confirmBookingService } from "./services/commercial";

export const services = query({
  args: { bookingId: v.id("bookings") },
  handler: async (ctx, { bookingId }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("bookingServices").withIndex("by_booking", (q) => q.eq("bookingId", bookingId)).take(100);
    const out = [];
    for (const s of rows) {
      const evidence = s.confirmationEvidenceId ? await ctx.db.get(s.confirmationEvidenceId) : null;
      out.push({ ...s, evidence });
    }
    return out;
  },
});

export const addService = mutation({
  args: {
    bookingId: v.id("bookings"),
    componentType: v.string(),
    description: v.string(),
    supplierId: v.optional(v.id("suppliers")),
    hotelId: v.optional(v.id("hotels")),
    serviceDateFrom: v.number(),
    serviceDateTo: v.optional(v.number()),
    quantity: v.number(),
    rateId: v.optional(v.id("rates")),
    customerSellingPrice: v.optional(v.object({ amount: v.number(), currency: v.string() })),
    supplierCost: v.optional(v.object({ amount: v.number(), currency: v.string() })),
  },
  handler: async (ctx, { bookingId, ...input }) => {
    const user = await requireUser(ctx);
    return await addBookingService(ctx, ownerActor(user), bookingId, input as Parameters<typeof addBookingService>[3]);
  },
});

export const setServiceStatus = mutation({
  args: { serviceId: v.id("bookingServices"), status: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { serviceId, status, reason }) => {
    const user = await requireUser(ctx);
    await changeBookingServiceStatus(ctx, ownerActor(user), serviceId, status as Parameters<typeof changeBookingServiceStatus>[3], reason);
    return null;
  },
});

export const confirmService = mutation({
  args: {
    serviceId: v.id("bookingServices"),
    supplierReference: v.string(),
    confirmedAt: v.number(),
    confirmedPrice: v.object({ amount: v.number(), currency: v.string() }),
    cancellationTerms: v.string(),
    evidenceKind: v.string(),
    fileStorageId: v.optional(v.id("_storage")),
    messageText: v.optional(v.string()),
  },
  handler: async (ctx, { serviceId, ...evidence }) => {
    const user = await requireUser(ctx);
    return await confirmBookingService(ctx, ownerActor(user), serviceId, evidence as Parameters<typeof confirmBookingService>[3]);
  },
});
