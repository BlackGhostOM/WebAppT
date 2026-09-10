/**
 * Product-specific operations beyond generic CRUD: components, costing,
 * itinerary, activation and versioning.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { activateProduct, addProductComponent, archiveProductComponent, createProductVersion, productCosting, upsertItineraryDay } from "./services/commercial";

export const costing = query({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await requireUser(ctx);
    const product = await ctx.db.get(productId);
    if (!product) return null;
    const c = await productCosting(ctx, productId);
    const itineraries = await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", productId)).take(60);
    const family = await ctx.db.query("products").withIndex("by_family", (q) => q.eq("productFamilyId", product.productFamilyId)).take(20);
    const enriched = [];
    for (const comp of c.components) {
      const rate = comp.rateId ? await ctx.db.get(comp.rateId) : null;
      enriched.push({ ...comp, rate: rate ? { businessId: rate.businessId, rateTrust: rate.rateTrust, freshness: rate.freshness, source: rate.source, validTo: rate.validTo } : null });
    }
    return {
      product,
      components: enriched,
      pricing: c.pricing,
      margin: c.margin,
      estimatedComponents: c.estimatedComponents,
      itineraries: itineraries.sort((a, b) => a.dayNumber - b.dayNumber),
      family: family.map((f) => ({ _id: f._id, businessId: f.businessId, version: f.version, status: f.status })),
    };
  },
});

/** Reference pickers for the product detail page. */
export const pickers = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const suppliers = (await ctx.db.query("suppliers").take(300)).filter((s) => !s.archivedAt).map((s) => ({ id: s._id, label: `${s.name} (${s.businessId})` }));
    const hotels = (await ctx.db.query("hotels").take(300)).filter((h) => !h.archivedAt).map((h) => ({ id: h._id, label: `${h.name} (${h.businessId})`, supplierId: h.supplierId, destinationId: h.destinationId }));
    const destinations = (await ctx.db.query("destinations").take(100)).filter((d) => !d.archivedAt).map((d) => ({ id: d._id, label: d.name }));
    const attractions = (await ctx.db.query("attractions").take(300)).filter((a) => !a.archivedAt).map((a) => ({ id: a._id, label: a.name, destinationId: a.destinationId }));
    const rates = (await ctx.db.query("rates").take(500))
      .filter((r) => !r.archivedAt && (r.status === "ACTIVE" || r.status === "PROPOSED"))
      .map((r) => ({ id: r._id, label: `${r.serviceDescription} — ${r.amount.amount} ${r.amount.currency} (${r.rateTrust})`, supplierId: r.supplierId, hotelId: r.hotelId, rateTrust: r.rateTrust, componentType: r.componentType }));
    return { suppliers, hotels, destinations, attractions, rates };
  },
});

export const addComponent = mutation({
  args: {
    productId: v.id("products"),
    componentType: v.string(),
    description: v.string(),
    dayNumber: v.optional(v.number()),
    quantity: v.number(),
    unit: v.string(),
    supplierId: v.optional(v.id("suppliers")),
    hotelId: v.optional(v.id("hotels")),
    experienceId: v.optional(v.id("experiences")),
    rateId: v.optional(v.id("rates")),
    supplierCost: v.optional(v.object({ amount: v.number(), currency: v.string() })),
    internalCost: v.optional(v.object({ amount: v.number(), currency: v.string() })),
    minSellingPrice: v.optional(v.object({ amount: v.number(), currency: v.string() })),
    recommendedSellingPrice: v.optional(v.object({ amount: v.number(), currency: v.string() })),
    customerSellingPrice: v.optional(v.object({ amount: v.number(), currency: v.string() })),
  },
  handler: async (ctx, { productId, ...input }) => {
    const user = await requireUser(ctx);
    return await addProductComponent(ctx, ownerActor(user), productId, input as Parameters<typeof addProductComponent>[3]);
  },
});

export const removeComponent = mutation({
  args: { componentId: v.id("productComponents") },
  handler: async (ctx, { componentId }) => {
    const user = await requireUser(ctx);
    await archiveProductComponent(ctx, ownerActor(user), componentId);
    return null;
  },
});

export const activate = mutation({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    const user = await requireOwner(ctx);
    return await activateProduct(ctx, ownerActor(user), productId);
  },
});

export const newVersion = mutation({
  args: { productId: v.id("products"), kind: v.union(v.literal("minor"), v.literal("major")) },
  handler: async (ctx, { productId, kind }) => {
    const user = await requireUser(ctx);
    return await createProductVersion(ctx, ownerActor(user), productId, kind, {});
  },
});

export const saveItineraryDay = mutation({
  args: {
    productId: v.id("products"),
    dayNumber: v.number(),
    title: v.string(),
    description: v.string(),
    destinationId: v.optional(v.id("destinations")),
    attractionIds: v.optional(v.array(v.id("attractions"))),
    meals: v.optional(v.object({ breakfast: v.boolean(), lunch: v.boolean(), dinner: v.boolean() })),
    overnightHotelId: v.optional(v.id("hotels")),
  },
  handler: async (ctx, { productId, ...day }) => {
    const user = await requireUser(ctx);
    return await upsertItineraryDay(ctx, ownerActor(user), productId, day);
  },
});
