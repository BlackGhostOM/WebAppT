/**
 * Product-specific operations beyond generic CRUD: components, costing,
 * activation and versioning.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { activateProduct, addProductComponent, createProductVersion, productCosting } from "./services/commercial";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";

export const costing = query({
  args: { productId: v.id("products") },
  handler: async (ctx, { productId }) => {
    await requireUser(ctx);
    const product = await ctx.db.get(productId);
    if (!product) return null;
    const c = await productCosting(ctx, productId);
    const itineraries = await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", productId)).take(60);
    const family = await ctx.db.query("products").withIndex("by_family", (q) => q.eq("productFamilyId", product.productFamilyId)).take(20);
    return { product, ...c, itineraries: itineraries.sort((a, b) => a.dayNumber - b.dayNumber), family: family.map((f) => ({ _id: f._id, businessId: f.businessId, version: f.version, status: f.status })) };
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
    const component = await ctx.db.get(componentId);
    if (!component) throw appError("NOT_FOUND", "المكوّن غير موجود");
    const product = await ctx.db.get(component.productId);
    if (product?.status === "ACTIVE") throw appError("INVALID_TRANSITION", "لا تُعدَّل مكوّنات منتج فعّال؛ أنشئ إصداراً جديداً");
    await ctx.db.patch(componentId, { archivedAt: Date.now(), updatedAt: Date.now(), updatedBy: ownerActor(user) });
    await appendAudit(ctx, { actor: ownerActor(user), table: "productComponents", recordId: componentId, businessId: component.businessId, event: "ARCHIVE", severity: "D2" });
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

export const upsertItineraryDay = mutation({
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
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const actor = ownerActor(user);
    const product = await ctx.db.get(args.productId);
    if (!product) throw appError("NOT_FOUND", "المنتج غير موجود");
    if (product.status === "ACTIVE") throw appError("INVALID_TRANSITION", "لا يُعدَّل برنامج منتج فعّال؛ أنشئ إصداراً جديداً");
    const existing = (await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", args.productId)).take(60)).find((d) => d.dayNumber === args.dayNumber);
    const now = Date.now();
    const fields = { title: args.title, description: args.description, destinationId: args.destinationId, attractionIds: args.attractionIds ?? [], meals: args.meals ?? { breakfast: false, lunch: false, dinner: false }, overnightHotelId: args.overnightHotelId };
    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, updatedAt: now, updatedBy: actor });
      await appendAudit(ctx, { actor, table: "itineraries", recordId: existing._id, businessId: existing.businessId, event: "UPDATE", newValue: fields, severity: "D2" });
      return existing._id;
    }
    const { nextBusinessId } = await import("./lib/ids");
    const businessId = await nextBusinessId(ctx, "itineraries");
    const id = await ctx.db.insert("itineraries", { businessId, productId: args.productId, dayNumber: args.dayNumber, ...fields, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
    await appendAudit(ctx, { actor, table: "itineraries", recordId: id, businessId, event: "CREATE", newValue: fields, severity: "D2" });
    return id;
  },
});
