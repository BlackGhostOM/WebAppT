/**
 * Synthetic Omani seed data for dev/staging (section 4.12). Never run in prod:
 * set DEPLOYMENT_STAGE=prod on the production deployment and this refuses.
 *
 *   npm run seed        (= npx convex run seed:run)
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { ensureDefaultsInternal } from "./bootstrap";
import { agentActor, systemActor, type Actor } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { computeFreshness } from "./lib/freshness";
import { getSetting, setSetting } from "./lib/settings";
import { activateProduct, addBookingService, addProductComponent, confirmBookingService, createProductVersion, createResearchRate } from "./services/commercial";
import { createRecord } from "./services/records";
import { SEED_DOCUMENTS } from "./seedDocuments";

const SEED: Actor = systemActor("seed");
const SEED_OWNER: Actor = { type: "owner", id: "seed-owner" };
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const d = (days: number) => NOW + days * DAY;
const iso = (days: number) => new Date(d(days)).toISOString();

async function create(ctx: MutationCtx, entity: Parameters<typeof createRecord>[2], data: Record<string, unknown>, actor: Actor = SEED) {
  const r = await createRecord(ctx, actor, entity, data, { acknowledgeDuplicates: true });
  return r.id;
}

/** Seed shortcut through the lifecycle (DESIGN → … → READY_FOR_SALE) so activation follows the real rule. */
async function readyForSale(ctx: MutationCtx, productId: Id<"products">) {
  for (const status of ["COSTING", "QA", "APPROVAL", "READY_FOR_SALE"] as const) {
    await ctx.db.patch(productId, { status, updatedAt: Date.now(), updatedBy: SEED_OWNER });
  }
}

const WIPE_TABLES = [
  "knowledgeChunks", "documents", "memories", "taskRuns", "approvals", "usageLog", "tasks", "chatMessages", "conversations", "notifications",
  "dataConflicts", "dataGaps", "knowledgeGaps", "contentCalendar", "campaigns", "confirmationEvidence", "bookingServices", "bookings",
  "quotes", "interactions", "leads", "customerPreferences", "customers", "itineraries", "productComponents", "products", "pricingRules",
  "rates", "contracts", "hotels", "experiences", "attractions", "destinations", "suppliers", "policies", "sops", "decisionRegister", "counters",
] as const;

/** Dev-only: removes synthetic business data (never the audit log, users or settings). */
export const wipe = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.DEPLOYMENT_STAGE === "prod") throw new Error("WIPE_FORBIDDEN_IN_PROD");
    let deleted = 0;
    for (const table of WIPE_TABLES) {
      const rows = await ctx.db.query(table).take(5000);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    const seedFlag = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "seed")).unique();
    if (seedFlag) await ctx.db.delete(seedFlag._id);
    await appendAudit(ctx, { actor: SEED, table: "settings", recordId: "seed", event: "SYSTEM", newValue: { wiped: deleted }, severity: "D2" });
    return { deleted };
  },
});

export const seedReference = internalMutation({
  args: {},
  handler: async (ctx) => {
    const destinations: Record<string, Id<"destinations">> = {};
    const destData = [
      ["muscat", "مسقط", "Muscat", "CITY", "محافظة مسقط", "العاصمة: قصر العلم، جامع السلطان قابوس الأكبر، سوق مطرح، شواطئ القرم.", ["ALL_YEAR", "WINTER"]],
      ["nizwa", "نزوى", "Nizwa", "HERITAGE", "الداخلية", "قلعة نزوى وسوقها التاريخي وسوق الماشية يوم الجمعة، بوابة الجبل الأخضر.", ["WINTER", "SHOULDER"]],
      ["jabal_akhdar", "الجبل الأخضر", "Jabal Akhdar", "MOUNTAIN", "الداخلية", "قرى معلقة ومدرجات الورد الدمشقي والمناخ المعتدل صيفاً.", ["ALL_YEAR", "SUMMER"]],
      ["sur", "صور", "Sur", "COAST", "جنوب الشرقية", "مدينة السفن الخشبية، رأس الجنز لتعشيش السلاحف، وادي شاب.", ["WINTER", "SHOULDER"]],
      ["sharqiya_sands", "رمال الشرقية", "Sharqiya Sands", "DESERT", "الشرقية", "كثبان رملية ذهبية ومخيمات بدوية وتجربة الدفع الرباعي.", ["WINTER"]],
      ["salalah", "صلالة", "Salalah", "NATURE", "ظفار", "موسم الخريف الاستوائي، شواطئ المغسيل، وادي دربات، طريق اللبان.", ["KHAREEF", "WINTER"]],
    ] as const;
    for (const [key, name, nameEn, kind, gov, description, seasons] of destData) {
      destinations[key] = (await create(ctx, "destinations", { name, nameEn, kind, governorate: gov, description, bestSeasons: [...seasons], status: "ACTIVE" })) as Id<"destinations">;
    }

    const attractions: Id<"attractions">[] = [];
    const attrData: [keyof typeof destinations, string, string, string, number, number | undefined][] = [
      ["muscat", "جامع السلطان قابوس الأكبر", "Sultan Qaboos Grand Mosque", "ديني/معماري", 90, undefined],
      ["muscat", "سوق مطرح", "Mutrah Souq", "تسوق", 120, undefined],
      ["muscat", "المتحف الوطني", "National Museum", "متحف", 120, 5],
      ["muscat", "دار الأوبرا السلطانية", "Royal Opera House", "ثقافة", 60, undefined],
      ["nizwa", "قلعة نزوى", "Nizwa Fort", "تاريخي", 90, 5],
      ["nizwa", "سوق نزوى", "Nizwa Souq", "تسوق", 90, undefined],
      ["nizwa", "قلعة بهلا", "Bahla Fort", "تاريخي", 90, 5],
      ["jabal_akhdar", "قرية وادي بني حبيب", "Wadi Bani Habib village", "قرية تراثية", 60, undefined],
      ["jabal_akhdar", "مدرجات الورد", "Rose terraces", "طبيعة", 60, undefined],
      ["sur", "محمية رأس الجنز للسلاحف", "Ras Al Jinz Turtle Reserve", "طبيعة", 120, 7],
      ["sur", "وادي شاب", "Wadi Shab", "وادي", 240, undefined],
      ["sur", "مصنع السفن الخشبية", "Dhow factory", "حرف", 45, undefined],
      ["sharqiya_sands", "الكثبان الرملية", "Sand dunes", "صحراء", 180, undefined],
      ["salalah", "وادي دربات", "Wadi Darbat", "طبيعة", 180, undefined],
      ["salalah", "شاطئ المغسيل", "Mughsail Beach", "شاطئ", 120, undefined],
      ["salalah", "متحف أرض اللبان", "Land of Frankincense Museum", "متحف", 90, 3],
    ];
    for (const [dest, name, nameEn, category, minutes, fee] of attrData) {
      attractions.push((await create(ctx, "attractions", { destinationId: destinations[dest], name, nameEn, category, visitDurationMinutes: minutes, entryFee: fee !== undefined ? { amount: fee, currency: "OMR" } : undefined, status: "ACTIVE" })) as Id<"attractions">);
    }

    const suppliers: Record<string, Id<"suppliers">> = {};
    const supData: [string, string, string, string, string, string, string][] = [
      ["hotel_muscat_bay", "فندق خليج مسقط", "Muscat Bay Hotel", "HOTEL", "PREFERRED", "96824123456", "res@muscatbay.example.om"],
      ["hotel_qurum", "منتجع القرم", "Qurum Resort", "HOTEL", "APPROVED", "96824654321", "sales@qurumresort.example.om"],
      ["hotel_nizwa", "نزوى هيرتيج إن", "Nizwa Heritage Inn", "HOTEL", "APPROVED", "96825411111", "book@nizwainn.example.om"],
      ["hotel_jabal", "منتجع الجبل الأخضر", "Jabal Akhdar Resort", "HOTEL", "PREFERRED", "96825429999", "reservations@jabalresort.example.om"],
      ["hotel_sur", "فندق صور بلازا", "Sur Plaza Hotel", "HOTEL", "CONDITIONAL", "96825543210", "info@surplaza.example.om"],
      ["camp_sands", "مخيم نجوم الرمال", "Desert Stars Camp", "HOTEL", "APPROVED", "96899112233", "camp@desertstars.example.om"],
      ["hotel_salalah", "منتجع شاطئ صلالة", "Salalah Beach Resort", "HOTEL", "APPROVED", "96823212121", "res@salalahbeach.example.om"],
      ["transport_alnahda", "النهضة للنقل السياحي", "Al Nahda Tourist Transport", "TRANSPORT", "PREFERRED", "96899887766", "ops@alnahda-transport.example.om"],
      ["guides_oman", "دليل عُمان للإرشاد", "Oman Guides Co.", "GUIDE", "APPROVED", "96895554433", "guides@omanguides.example.om"],
      ["activities_sea", "بحر عُمان للأنشطة البحرية", "Sea of Oman Activities", "ACTIVITY_OPERATOR", "UNDER_REVIEW", "96891122334", "hello@seaofoman.example.om"],
    ];
    for (const [key, name, nameEn, supplierType, status, phone, email] of supData) {
      suppliers[key] = (await create(ctx, "suppliers", { name, nameEn, supplierType, status, phone, email, city: key.includes("salalah") ? "صلالة" : key.includes("nizwa") ? "نزوى" : "مسقط", paymentTerms: "تحويل بنكي خلال 14 يوماً من الفاتورة", tags: ["seed"] })) as Id<"suppliers">;
    }

    const hotels: Record<string, Id<"hotels">> = {};
    const hotelData: [string, string, string, keyof typeof destinations, string, string, string | undefined][] = [
      ["muscat_bay", "فندق خليج مسقط", "Muscat Bay Hotel", "muscat", "FIVE_STAR", "hotel_muscat_bay", "الأطفال دون 6 سنوات مجاناً في غرفة الوالدين"],
      ["qurum", "منتجع القرم", "Qurum Resort", "muscat", "FOUR_STAR", "hotel_qurum", "الأطفال دون 12 سنة: 50% على السرير الإضافي"],
      ["muscat_city", "فندق مسقط سيتي", "Muscat City Hotel", "muscat", "THREE_STAR", "hotel_qurum", undefined],
      ["nizwa_inn", "نزوى هيرتيج إن", "Nizwa Heritage Inn", "nizwa", "BOUTIQUE", "hotel_nizwa", undefined],
      ["jabal_resort", "منتجع الجبل الأخضر", "Jabal Akhdar Resort", "jabal_akhdar", "FIVE_STAR", "hotel_jabal", "طفل واحد دون 12 سنة مجاناً"],
      ["sur_plaza", "فندق صور بلازا", "Sur Plaza Hotel", "sur", "THREE_STAR", "hotel_sur", undefined],
      ["desert_camp", "مخيم نجوم الرمال", "Desert Stars Camp", "sharqiya_sands", "CAMP", "camp_sands", "الأطفال دون 5 سنوات مجاناً"],
      ["salalah_beach", "منتجع شاطئ صلالة", "Salalah Beach Resort", "salalah", "FOUR_STAR", "hotel_salalah", undefined],
    ];
    for (const [key, name, nameEn, dest, category, sup, childPolicy] of hotelData) {
      hotels[key] = (await create(ctx, "hotels", { name, nameEn, destinationId: destinations[dest], supplierId: suppliers[sup], category, childPolicy, checkInTime: "14:00", checkOutTime: "12:00", amenities: ["واي فاي", "إفطار", "مواقف"], status: "ACTIVE" })) as Id<"hotels">;
    }

    const experiences: Id<"experiences">[] = [];
    const expData: [string, string, keyof typeof destinations, keyof typeof suppliers, number, string][] = [
      ["رحلة مشاهدة الدلافين", "Dolphin watching cruise", "muscat", "activities_sea", 2, "EASY"],
      ["جولة مسقط الثقافية", "Muscat heritage tour", "muscat", "guides_oman", 5, "EASY"],
      ["سفاري الكثبان بالدفع الرباعي", "Dune bashing safari", "sharqiya_sands", "transport_alnahda", 2, "MODERATE"],
      ["مشاهدة السلاحف ليلاً", "Night turtle watching", "sur", "guides_oman", 2, "EASY"],
      ["هايكنج وادي شاب", "Wadi Shab hike & swim", "sur", "guides_oman", 4, "CHALLENGING"],
      ["جولة قرى الجبل الأخضر", "Jabal Akhdar villages walk", "jabal_akhdar", "guides_oman", 3, "MODERATE"],
    ];
    for (const [name, nameEn, dest, sup, hours, difficulty] of expData) {
      experiences.push((await create(ctx, "experiences", { name, nameEn, destinationId: destinations[dest], supplierId: suppliers[sup], durationHours: hours, difficulty, minPax: 2, maxPax: 12, seasons: ["ALL_YEAR"], status: "ACTIVE" })) as Id<"experiences">);
    }
    return { destinations, attractions, suppliers, hotels, experiences };
  },
});

export const seedRates = internalMutation({
  args: { suppliers: v.any(), hotels: v.any(), experiences: v.array(v.id("experiences")) },
  handler: async (ctx, { suppliers, hotels, experiences }) => {
    const S = suppliers as Record<string, Id<"suppliers">>;
    const H = hotels as Record<string, Id<"hotels">>;
    const rates: Id<"rates">[] = [];
    type RateRow = { sup: string; hotel?: string; exp?: number; type: string; svc: string; desc: string; basis: string; amount: number; currency?: string; season: string; from: number; to: number; trust: string; room?: string; cancel: string };
    const rows: RateRow[] = [
      { sup: "hotel_muscat_bay", hotel: "muscat_bay", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة ديلوكس مزدوجة مع إفطار", basis: "PER_NIGHT", amount: 95, season: "WINTER", from: -60, to: 120, trust: "CONTRACTED", room: "DELUXE", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "hotel_muscat_bay", hotel: "muscat_bay", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة ديلوكس مزدوجة مع إفطار (صيف)", basis: "PER_NIGHT", amount: 65, season: "SUMMER", from: 150, to: 300, trust: "CONTRACTED", room: "DELUXE", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "hotel_muscat_bay", hotel: "muscat_bay", type: "HOTEL", svc: "HOTEL_ROOM", desc: "جناح عائلي", basis: "PER_NIGHT", amount: 160, season: "WINTER", from: -60, to: 120, trust: "CONTRACTED", room: "FAMILY_SUITE", cancel: "إلغاء مجاني حتى 7 أيام" },
      { sup: "hotel_qurum", hotel: "qurum", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة قياسية مع إفطار", basis: "PER_NIGHT", amount: 55, season: "ALL_YEAR", from: -30, to: 335, trust: "SUPPLIER_CONFIRMED", room: "STANDARD", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "hotel_qurum", hotel: "muscat_city", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة قياسية", basis: "PER_NIGHT", amount: 32, season: "ALL_YEAR", from: -30, to: 335, trust: "SUPPLIER_CONFIRMED", room: "STANDARD", cancel: "غير قابل للاسترداد" },
      { sup: "hotel_nizwa", hotel: "nizwa_inn", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة تراثية مع إفطار", basis: "PER_NIGHT", amount: 48, season: "WINTER", from: -60, to: 90, trust: "CONTRACTED", room: "HERITAGE", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "hotel_jabal", hotel: "jabal_resort", type: "HOTEL", svc: "HOTEL_ROOM", desc: "فيلا بإطلالة على الوادي", basis: "PER_NIGHT", amount: 220, season: "ALL_YEAR", from: -60, to: 300, trust: "CONTRACTED", room: "VILLA", cancel: "50% حتى 14 يوماً، 100% خلال 7 أيام" },
      { sup: "hotel_jabal", hotel: "jabal_resort", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة كانيون", basis: "PER_NIGHT", amount: 140, season: "ALL_YEAR", from: -60, to: 300, trust: "CONTRACTED", room: "CANYON", cancel: "50% حتى 14 يوماً، 100% خلال 7 أيام" },
      { sup: "hotel_sur", hotel: "sur_plaza", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة مزدوجة", basis: "PER_NIGHT", amount: 38, season: "ALL_YEAR", from: -400, to: -10, trust: "CONTRACTED", room: "DOUBLE", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "camp_sands", hotel: "desert_camp", type: "HOTEL", svc: "DESERT_CAMP", desc: "خيمة بدوية مع عشاء وإفطار", basis: "PER_PERSON", amount: 45, season: "WINTER", from: -30, to: 25, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "camp_sands", hotel: "desert_camp", type: "HOTEL", svc: "DESERT_CAMP", desc: "خيمة ديلوكس مع حمام خاص", basis: "PER_PERSON", amount: 70, season: "WINTER", from: -30, to: 120, trust: "SUPPLIER_CONFIRMED", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "hotel_salalah", hotel: "salalah_beach", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة بإطلالة بحرية (خريف)", basis: "PER_NIGHT", amount: 120, season: "KHAREEF", from: 240, to: 330, trust: "SUPPLIER_CONFIRMED", room: "SEA_VIEW", cancel: "غير قابل للاسترداد في موسم الخريف" },
      { sup: "hotel_salalah", hotel: "salalah_beach", type: "HOTEL", svc: "HOTEL_ROOM", desc: "غرفة بإطلالة بحرية (شتاء)", basis: "PER_NIGHT", amount: 68, season: "WINTER", from: -30, to: 120, trust: "CONTRACTED", room: "SEA_VIEW", cancel: "إلغاء مجاني حتى 72 ساعة" },
      { sup: "transport_alnahda", type: "TRANSPORT", svc: "VEHICLE_4X4", desc: "لاند كروزر مع سائق (يوم كامل)", basis: "PER_VEHICLE", amount: 85, season: "ALL_YEAR", from: -90, to: 275, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 24 ساعة" },
      { sup: "transport_alnahda", type: "TRANSPORT", svc: "AIRPORT_TRANSFER", desc: "نقل من المطار إلى فنادق مسقط", basis: "PER_VEHICLE", amount: 18, season: "ALL_YEAR", from: -90, to: 275, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 24 ساعة" },
      { sup: "transport_alnahda", type: "TRANSPORT", svc: "VEHICLE_4X4", desc: "حافلة 20 مقعداً (يوم كامل)", basis: "PER_VEHICLE", amount: 150, season: "ALL_YEAR", from: -90, to: 275, trust: "SUPPLIER_CONFIRMED", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "guides_oman", type: "GUIDE", svc: "GUIDE_DAY", desc: "مرشد مرخص (عربي/إنجليزي) يوم كامل", basis: "PER_GROUP", amount: 60, season: "ALL_YEAR", from: -90, to: 275, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "guides_oman", type: "GUIDE", svc: "GUIDE_DAY", desc: "مرشد ناطق بالألمانية يوم كامل", basis: "PER_GROUP", amount: 90, season: "ALL_YEAR", from: -90, to: 275, trust: "SUPPLIER_CONFIRMED", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "activities_sea", exp: 0, type: "ACTIVITY", svc: "BOAT_TRIP", desc: "رحلة مشاهدة الدلافين (ساعتان)", basis: "PER_PERSON", amount: 20, season: "ALL_YEAR", from: -30, to: 200, trust: "SUPPLIER_CONFIRMED", cancel: "إلغاء مجاني حتى 24 ساعة؛ تُلغى عند سوء الأحوال الجوية" },
      { sup: "guides_oman", exp: 3, type: "ACTIVITY", svc: "ACTIVITY", desc: "زيارة محمية السلاحف مع مرشد", basis: "PER_PERSON", amount: 12, season: "ALL_YEAR", from: -30, to: 200, trust: "SUPPLIER_CONFIRMED", cancel: "غير قابل للاسترداد" },
      { sup: "guides_oman", exp: 4, type: "ACTIVITY", svc: "ACTIVITY", desc: "هايكنج وادي شاب مع مرشد", basis: "PER_GROUP", amount: 45, season: "WINTER", from: -30, to: 150, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 48 ساعة" },
      { sup: "transport_alnahda", exp: 2, type: "ACTIVITY", svc: "ACTIVITY", desc: "سفاري الكثبان (ساعتان)", basis: "PER_VEHICLE", amount: 40, season: "WINTER", from: -30, to: 150, trust: "CONTRACTED", cancel: "إلغاء مجاني حتى 24 ساعة" },
      { sup: "hotel_muscat_bay", hotel: "muscat_bay", type: "MEAL", svc: "MEAL", desc: "عشاء بوفيه", basis: "PER_PERSON", amount: 15, season: "ALL_YEAR", from: -400, to: -30, trust: "HISTORICAL", cancel: "غير قابل للاسترداد" },
      { sup: "hotel_jabal", hotel: "jabal_resort", type: "MEAL", svc: "MEAL", desc: "عشاء عُماني تقليدي", basis: "PER_PERSON", amount: 22, season: "ALL_YEAR", from: -400, to: -5, trust: "HISTORICAL", cancel: "غير قابل للاسترداد" },
    ];
    for (const r of rows) {
      const id = (await create(ctx, "rates", {
        supplierId: S[r.sup],
        hotelId: r.hotel ? H[r.hotel] : undefined,
        experienceId: r.exp !== undefined ? experiences[r.exp] : undefined,
        componentType: r.type,
        serviceType: r.svc,
        serviceDescription: r.desc,
        roomType: r.room,
        rateBasis: r.basis,
        amount: { amount: r.amount, currency: r.currency ?? "OMR" },
        season: r.season,
        validFrom: d(r.from),
        validTo: d(r.to),
        taxesIncluded: true,
        cancellationTerms: r.cancel,
        rateTrust: r.trust,
        status: r.to < 0 ? "EXPIRED" : "ACTIVE",
      })) as Id<"rates">;
      // Seed records carry realistic trust levels instead of the system default.
      const trustLevel = r.trust === "CONTRACTED" ? "A_COMPANY_VERIFIED" : r.trust === "SUPPLIER_CONFIRMED" ? "B_SUPPLIER_CONFIRMED" : "D_RELIABLE_EXTERNAL";
      await ctx.db.patch(id, { trustLevel, verificationStatus: r.trust === "HISTORICAL" ? "UNVERIFIED" : "HUMAN_VERIFIED", freshness: computeFreshness({ validFrom: d(r.from), validTo: d(r.to), lastVerifiedAt: NOW, verificationStatus: r.trust === "HISTORICAL" ? "UNVERIFIED" : "HUMAN_VERIFIED" }) });
      rates.push(id);
    }
    // Six research (ESTIMATED) rates created the way the product agent would create them.
    const research: { sup: string; hotel?: string; desc: string; amount: number; currency: string; url: string; season: string }[] = [
      { sup: "hotel_muscat_bay", hotel: "muscat_bay", desc: "غرفة ديلوكس — سعر موقع حجوزات", amount: 260, currency: "USD", url: "https://www.example-booking.com/hotel/muscat-bay", season: "WINTER" },
      { sup: "hotel_qurum", hotel: "qurum", desc: "غرفة قياسية — سعر موقع حجوزات", amount: 150, currency: "USD", url: "https://www.example-booking.com/hotel/qurum-resort", season: "WINTER" },
      { sup: "hotel_jabal", hotel: "jabal_resort", desc: "فيلا — سعر الموقع الرسمي", amount: 610, currency: "USD", url: "https://www.example-hotel.com/jabal-akhdar/rates", season: "ALL_YEAR" },
      { sup: "hotel_salalah", hotel: "salalah_beach", desc: "غرفة بحرية خريف — سعر موقع حجوزات", amount: 330, currency: "USD", url: "https://www.example-booking.com/hotel/salalah-beach", season: "KHAREEF" },
      { sup: "camp_sands", hotel: "desert_camp", desc: "خيمة ديلوكس — سعر موقع المخيم", amount: 75, currency: "OMR", url: "https://www.example-camp.com/prices", season: "WINTER" },
      { sup: "transport_alnahda", desc: "تأجير لاند كروزر بدون سائق (يوم)", amount: 45, currency: "OMR", url: "https://www.example-rental.com/oman/4x4", season: "ALL_YEAR" },
    ];
    for (const r of research) {
      const created = await createResearchRate(ctx, agentActor("product"), {
        supplierId: S[r.sup],
        hotelId: r.hotel ? H[r.hotel] : undefined,
        componentType: r.hotel ? "HOTEL" : "VEHICLE_RENTAL",
        serviceType: r.hotel ? "HOTEL_ROOM" : "VEHICLE_RENTAL",
        serviceDescription: r.desc,
        rateBasis: r.hotel ? "PER_NIGHT" : "PER_VEHICLE",
        amount: r.amount,
        currency: r.currency,
        season: r.season as never,
        validFrom: d(0),
        validTo: d(60),
        sourceUrl: r.url,
        retrievedAt: NOW - 2 * DAY,
      });
      rates.push(created.id);
    }
    return { rates };
  },
});

export const seedProducts = internalMutation({
  args: { destinations: v.any(), hotels: v.any(), suppliers: v.any(), rates: v.array(v.id("rates")), experiences: v.array(v.id("experiences")) },
  handler: async (ctx, { destinations, hotels, suppliers, rates, experiences }) => {
    const D = destinations as Record<string, Id<"destinations">>;
    const H = hotels as Record<string, Id<"hotels">>;
    const S = suppliers as Record<string, Id<"suppliers">>;
    const products: Id<"products">[] = [];
    const money = (amount: number) => ({ amount, currency: "OMR" });

    const p1 = (await create(ctx, "products", {
      name: "كنوز مسقط — 3 أيام",
      nameEn: "Muscat Treasures — 3 days",
      productType: "PACKAGE",
      status: "DESIGN",
      destinationIds: [D.muscat],
      durationDays: 3,
      durationNights: 2,
      summary: "جولة ثقافية في العاصمة: الجامع الأكبر، سوق مطرح، المتحف الوطني، ورحلة مشاهدة الدلافين، مع الإقامة في فندق خليج مسقط.",
      highlights: ["جامع السلطان قابوس الأكبر", "سوق مطرح", "رحلة الدلافين"],
      inclusions: ["إقامة ليلتين مع الإفطار", "نقل من المطار وإليه", "مرشد يوم كامل", "رحلة الدلافين"],
      exclusions: ["الطيران الدولي", "الوجبات غير المذكورة", "المصروفات الشخصية"],
      supplierCost: money(175), internalCost: money(15), minSellingPrice: money(215), recommendedSellingPrice: money(235), customerSellingPrice: money(235),
      targetMarginPercent: 18, minPax: 2, maxPax: 12, seasons: ["WINTER", "SHOULDER"], validFrom: d(-30), validTo: d(200),
    })) as Id<"products">;
    await addProductComponent(ctx, SEED, p1, { componentType: "HOTEL", description: "ليلتان — غرفة ديلوكس مع إفطار", dayNumber: 1, quantity: 2, unit: "PER_NIGHT", supplierId: S.hotel_muscat_bay, hotelId: H.muscat_bay, rateId: rates[0], supplierCost: money(95), customerSellingPrice: money(120) });
    await addProductComponent(ctx, SEED, p1, { componentType: "TRANSPORT", description: "نقل مطار ذهاباً وإياباً", dayNumber: 1, quantity: 2, unit: "PER_VEHICLE", supplierId: S.transport_alnahda, rateId: rates[14], supplierCost: money(18), customerSellingPrice: money(25) });
    await addProductComponent(ctx, SEED, p1, { componentType: "GUIDE", description: "مرشد يوم كامل — جولة مسقط", dayNumber: 2, quantity: 1, unit: "PER_GROUP", supplierId: S.guides_oman, rateId: rates[16], supplierCost: money(30), customerSellingPrice: money(45) });
    await addProductComponent(ctx, SEED, p1, { componentType: "ACTIVITY", description: "رحلة مشاهدة الدلافين", dayNumber: 3, quantity: 1, unit: "PER_PERSON", supplierId: S.activities_sea, experienceId: experiences[0], rateId: rates[18], supplierCost: money(20), customerSellingPrice: money(28) });
    await readyForSale(ctx, p1);
    await activateProduct(ctx, SEED_OWNER, p1);
    products.push(p1);

    const p2 = (await create(ctx, "products", {
      name: "الداخلية والجبل الأخضر — 4 أيام",
      nameEn: "Nizwa & Jabal Akhdar — 4 days",
      productType: "MULTI_DAY_TOUR",
      status: "DESIGN",
      destinationIds: [D.nizwa, D.jabal_akhdar],
      durationDays: 4, durationNights: 3,
      summary: "قلعة نزوى وسوقها، قلعة بهلا، ثم ليلتان في منتجع الجبل الأخضر مع جولة القرى المعلقة.",
      highlights: ["قلعة نزوى", "قرى الجبل الأخضر", "عشاء عُماني تقليدي"],
      inclusions: ["3 ليالٍ مع الإفطار", "سيارة دفع رباعي مع سائق", "مرشد"],
      exclusions: ["الطيران", "الغداء"],
      supplierCost: money(520), internalCost: money(25), minSellingPrice: money(620), recommendedSellingPrice: money(680), customerSellingPrice: money(680),
      targetMarginPercent: 18, minPax: 2, maxPax: 6, seasons: ["ALL_YEAR"], validFrom: d(-30), validTo: d(270),
    })) as Id<"products">;
    await addProductComponent(ctx, SEED, p2, { componentType: "HOTEL", description: "ليلة — نزوى هيرتيج إن", dayNumber: 1, quantity: 1, unit: "PER_NIGHT", supplierId: S.hotel_nizwa, hotelId: H.nizwa_inn, rateId: rates[5], supplierCost: money(48), customerSellingPrice: money(65) });
    await addProductComponent(ctx, SEED, p2, { componentType: "HOTEL", description: "ليلتان — غرفة كانيون", dayNumber: 2, quantity: 2, unit: "PER_NIGHT", supplierId: S.hotel_jabal, hotelId: H.jabal_resort, rateId: rates[7], supplierCost: money(140), customerSellingPrice: money(175) });
    await addProductComponent(ctx, SEED, p2, { componentType: "TRANSPORT", description: "دفع رباعي مع سائق 4 أيام", dayNumber: 1, quantity: 4, unit: "PER_VEHICLE", supplierId: S.transport_alnahda, rateId: rates[13], supplierCost: money(85), customerSellingPrice: money(110) });
    await readyForSale(ctx, p2);
    await activateProduct(ctx, SEED_OWNER, p2);
    // A minor version (component tweak) to demonstrate versioning.
    const v11 = await createProductVersion(ctx, SEED_OWNER, p2, "minor", { summary: "قلعة نزوى وسوقها، قلعة بهلا، ثم ليلتان في منتجع الجبل الأخضر مع جولة القرى المعلقة وعشاء عُماني تقليدي." });
    products.push(p2, v11.id);

    const p3 = (await create(ctx, "products", {
      name: "الصحراء والساحل — 3 أيام",
      nameEn: "Desert & Coast — 3 days",
      productType: "MULTI_DAY_TOUR",
      status: "DESIGN",
      destinationIds: [D.sharqiya_sands, D.sur],
      durationDays: 3, durationNights: 2,
      summary: "ليلة في مخيم بدوي برمال الشرقية مع سفاري الكثبان، ثم وادي شاب ومحمية السلاحف في صور.",
      highlights: ["سفاري الكثبان", "ليلة تحت النجوم", "سلاحف رأس الجنز"],
      inclusions: ["ليلة مخيم مع عشاء وإفطار", "ليلة فندق في صور", "دفع رباعي مع سائق"],
      exclusions: ["الطيران"],
      supplierCost: money(285), internalCost: money(20), minSellingPrice: money(350), recommendedSellingPrice: money(385), customerSellingPrice: money(385),
      targetMarginPercent: 18, minPax: 2, maxPax: 8, seasons: ["WINTER"], validFrom: d(-30), validTo: d(120),
    })) as Id<"products">;
    await addProductComponent(ctx, SEED, p3, { componentType: "HOTEL", description: "خيمة ديلوكس مع عشاء وإفطار", dayNumber: 1, quantity: 1, unit: "PER_PERSON", supplierId: S.camp_sands, hotelId: H.desert_camp, rateId: rates[10], supplierCost: money(70), customerSellingPrice: money(90) });
    await addProductComponent(ctx, SEED, p3, { componentType: "ACTIVITY", description: "سفاري الكثبان", dayNumber: 1, quantity: 1, unit: "PER_VEHICLE", supplierId: S.transport_alnahda, experienceId: experiences[2], rateId: rates[21], supplierCost: money(40), customerSellingPrice: money(55) });
    await addProductComponent(ctx, SEED, p3, { componentType: "HOTEL", description: "ليلة في فندق صور بلازا (سعر منتهٍ يحتاج تحديثاً)", dayNumber: 2, quantity: 1, unit: "PER_NIGHT", supplierId: S.hotel_sur, hotelId: H.sur_plaza, rateId: rates[8], supplierCost: money(38), customerSellingPrice: money(50) });
    await addProductComponent(ctx, SEED, p3, { componentType: "ACTIVITY", description: "مشاهدة السلاحف ليلاً", dayNumber: 2, quantity: 1, unit: "PER_PERSON", supplierId: S.guides_oman, experienceId: experiences[3], rateId: rates[19], supplierCost: money(12), customerSellingPrice: money(18) });
    await readyForSale(ctx, p3);
    await activateProduct(ctx, SEED_OWNER, p3);
    products.push(p3);

    const p4 = (await create(ctx, "products", {
      name: "خريف صلالة — 5 أيام",
      nameEn: "Salalah Khareef — 5 days",
      productType: "PACKAGE",
      status: "COSTING",
      destinationIds: [D.salalah],
      durationDays: 5, durationNights: 4,
      summary: "مسودة باقة موسم الخريف: 4 ليالٍ بإطلالة بحرية، وادي دربات، المغسيل، متحف أرض اللبان.",
      highlights: ["وادي دربات", "شاطئ المغسيل"],
      inclusions: ["4 ليالٍ مع الإفطار", "سيارة مع سائق"],
      exclusions: ["الطيران الداخلي"],
      supplierCost: money(560), internalCost: money(30), minSellingPrice: money(690), recommendedSellingPrice: money(750),
      targetMarginPercent: 18, seasons: ["KHAREEF"], validFrom: d(240), validTo: d(330),
    })) as Id<"products">;
    await addProductComponent(ctx, SEED, p4, { componentType: "HOTEL", description: "4 ليالٍ بإطلالة بحرية (خريف) — سعر استرشادي", dayNumber: 1, quantity: 4, unit: "PER_NIGHT", supplierId: S.hotel_salalah, hotelId: H.salalah_beach, rateId: rates[rates.length - 3], customerSellingPrice: money(150) });
    products.push(p4);

    const p5 = (await create(ctx, "products", {
      name: "نقل مطار مسقط",
      nameEn: "Muscat airport transfer",
      productType: "TRANSFER",
      status: "DESIGN",
      destinationIds: [D.muscat],
      durationDays: 1, durationNights: 0,
      summary: "نقل خاص من مطار مسقط الدولي إلى فنادق العاصمة.",
      highlights: [], inclusions: ["سيارة خاصة مع سائق"], exclusions: [],
      supplierCost: money(18), internalCost: money(2), minSellingPrice: money(24), recommendedSellingPrice: money(28), customerSellingPrice: money(28),
      targetMarginPercent: 25, seasons: ["ALL_YEAR"], validFrom: d(-30), validTo: d(335),
    })) as Id<"products">;
    await addProductComponent(ctx, SEED, p5, { componentType: "TRANSPORT", description: "نقل مطار", quantity: 1, unit: "PER_VEHICLE", supplierId: S.transport_alnahda, rateId: rates[14], supplierCost: money(18), customerSellingPrice: money(28) });
    await readyForSale(ctx, p5);
    await activateProduct(ctx, SEED_OWNER, p5);
    products.push(p5);

    // Pricing rules
    for (const rule of [
      { kind: "TARGET_MARGIN", name: "الهامش المستهدف للباقات", value: 18, unit: "PERCENT", priority: 10 },
      { kind: "MIN_MARGIN", name: "الحد الأدنى للهامش", value: 10, unit: "PERCENT", priority: 20 },
      { kind: "DISCOUNT_CAP", name: "سقف الخصم بلا اعتماد", value: 10, unit: "PERCENT", priority: 30 },
      { kind: "ROUNDING", name: "تقريب أسعار البيع لأقرب ريال", value: 1, unit: "OMR", priority: 5 },
    ]) {
      await create(ctx, "pricingRules", { ...rule, status: "ACTIVE", validFrom: d(-30) });
    }
    return { products };
  },
});

const FIRST = ["أحمد", "محمد", "سعيد", "خالد", "سالم", "علي", "حمد", "يوسف", "ناصر", "عبدالله", "مريم", "فاطمة", "عائشة", "زينب", "نورة", "هند", "سارة", "شيخة", "أمل", "ليلى"];
const LAST = ["البلوشي", "الحارثي", "المعمري", "الرواحي", "الكندي", "السعدي", "العامري", "الهنائي", "البوسعيدي", "الشنفري", "الريامي", "المسكري", "الزدجالي", "العبري", "الغافري"];
const INTL = [
  ["James Whitfield", "GB", "en"],
  ["Anna Schmidt", "DE", "en"],
  ["Priya Raman", "IN", "en"],
  ["Lucas Moreau", "GB", "en"],
] as const;

export const seedCustomersLeads = internalMutation({
  args: { products: v.array(v.id("products")) },
  handler: async (ctx, { products }) => {
    const customers: Id<"customers">[] = [];
    for (let i = 0; i < 36; i++) {
      const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
      const phone = `+968 9${String(1000000 + i * 7919).slice(0, 7)}`;
      const types = ["INDIVIDUAL", "FAMILY", "FAMILY", "GROUP", "CORPORATE", "VIP"];
      customers.push((await create(ctx, "customers", {
        fullName: name,
        customerType: types[i % types.length],
        phone,
        email: i % 3 === 0 ? `customer${i}@example.om` : undefined,
        preferredLanguage: "ar",
        preferredChannel: ["WHATSAPP", "INSTAGRAM", "PHONE"][i % 3],
        city: ["مسقط", "صحار", "صلالة", "نزوى"][i % 4],
        consentStatus: i % 9 === 0 ? "PENDING" : "GRANTED",
        tags: i % 5 === 0 ? ["عميل متكرر"] : [],
        status: "ACTIVE",
      })) as Id<"customers">);
    }
    for (const [name, , lang] of INTL) {
      customers.push((await create(ctx, "customers", { fullName: name, customerType: "INDIVIDUAL", email: `${name.split(" ")[0].toLowerCase()}@example.com`, preferredLanguage: lang, preferredChannel: "EMAIL", consentStatus: "GRANTED", tags: ["international"], status: "ACTIVE" })) as Id<"customers">);
    }
    const stages: [string, number][] = [["NEW_LEAD", 6], ["QUALIFIED", 5], ["REQUIREMENTS_COLLECTED", 3], ["PROPOSAL_PREPARED", 3], ["QUOTE_SENT", 3], ["NEGOTIATION", 2], ["WON", 2], ["LOST", 1]];
    const leads: Id<"leads">[] = [];
    let i = 0;
    for (const [stage, count] of stages) {
      for (let k = 0; k < count; k++) {
        const customerId = customers[(i * 3) % customers.length];
        const customer = await ctx.db.get(customerId);
        leads.push((await create(ctx, "leads", {
          contactName: customer?.fullName ?? `عميل محتمل ${i}`,
          contactPhone: customer?.phone,
          contactEmail: customer?.email,
          customerId: i % 2 === 0 ? customerId : undefined,
          channel: ["INSTAGRAM", "WHATSAPP", "WEBSITE", "REFERRAL"][i % 4],
          stage,
          lostReason: stage === "LOST" ? "PRICE" : undefined,
          interestedProductId: products[i % products.length],
          expectedValue: { amount: 300 + i * 45, currency: "OMR" },
          travelDateFrom: d(20 + i * 5),
          travelDateTo: d(23 + i * 5),
          paxAdults: 2 + (i % 3),
          paxChildren: i % 2,
          nextFollowUpAt: stage === "WON" || stage === "LOST" ? undefined : d(1 + (i % 5)),
          summary: `طلب عبر ${["إنستجرام", "واتساب", "الموقع", "إحالة"][i % 4]}: عائلة تبحث عن برنامج ${["مسقط", "الجبل الأخضر", "الصحراء", "صلالة"][i % 4]} في الشتاء.`,
        })) as Id<"leads">);
        i += 1;
      }
    }
    return { customers, leads };
  },
});

export const seedBookings = internalMutation({
  args: { customers: v.array(v.id("customers")), leads: v.array(v.id("leads")), products: v.array(v.id("products")), suppliers: v.any(), hotels: v.any(), rates: v.array(v.id("rates")) },
  handler: async (ctx, { customers, leads, products, suppliers, hotels, rates }) => {
    const S = suppliers as Record<string, Id<"suppliers">>;
    const H = hotels as Record<string, Id<"hotels">>;
    const statuses = ["CONFIRMED", "CONFIRMED", "CONFIRMED", "COMPLETED", "COMPLETED", "PENDING_CONFIRMATION", "PENDING_CONFIRMATION", "TENTATIVE", "TENTATIVE", "INQUIRY", "IN_PROGRESS", "CANCELLED", "CONFIRMED", "COMPLETED", "PENDING_CONFIRMATION"];
    const bookings: Id<"bookings">[] = [];
    for (let i = 0; i < statuses.length; i++) {
      const status = statuses[i];
      const from = status === "COMPLETED" ? d(-40 + i) : status === "IN_PROGRESS" ? d(-1) : d(10 + i * 4);
      const productId = products[i % products.length];
      const product = await ctx.db.get(productId);
      const pax = 2 + (i % 3);
      const price = (product?.pricing.customerSellingPrice?.amount ?? 200) * pax;
      const cost = (product?.pricing.supplierCost?.amount ?? 150) * pax;
      const bookingId = (await create(ctx, "bookings", {
        customerId: customers[i % customers.length],
        leadId: i < leads.length ? leads[leads.length - 1 - i] : undefined,
        productId,
        status: status === "CONFIRMED" || status === "COMPLETED" || status === "IN_PROGRESS" ? "TENTATIVE" : status,
        paymentStatus: status === "COMPLETED" ? "PAID" : status === "CONFIRMED" || status === "IN_PROGRESS" ? "DEPOSIT_PAID" : "UNPAID",
        travelDateFrom: from,
        travelDateTo: from + (product?.durationNights ?? 2) * DAY,
        paxAdults: pax,
        paxChildren: i % 2,
        totalSellingPrice: { amount: price, currency: "OMR" },
        totalSupplierCost: { amount: cost, currency: "OMR" },
        specialRequests: i % 3 === 0 ? "غرف متجاورة، وجبات حلال، سرير أطفال" : undefined,
      })) as Id<"bookings">;
      await ctx.db.patch(bookingId, { productVersion: product?.version });
      // Services: hotel + transport (+ activity), each with its own status.
      const hotel = await addBookingService(ctx, SEED, bookingId, { componentType: "HOTEL", description: `إقامة ${product?.durationNights ?? 2} ليالٍ`, supplierId: S.hotel_muscat_bay, hotelId: H.muscat_bay, serviceDateFrom: from, serviceDateTo: from + (product?.durationNights ?? 2) * DAY, quantity: product?.durationNights ?? 2, rateId: rates[0], customerSellingPrice: { amount: 120 * (product?.durationNights ?? 2), currency: "OMR" }, supplierCost: { amount: 95 * (product?.durationNights ?? 2), currency: "OMR" } });
      const transport = await addBookingService(ctx, SEED, bookingId, { componentType: "TRANSPORT", description: "نقل وجولات", supplierId: S.transport_alnahda, serviceDateFrom: from, quantity: 1, rateId: rates[13], customerSellingPrice: { amount: 110, currency: "OMR" }, supplierCost: { amount: 85, currency: "OMR" } });
      const shouldConfirm = ["CONFIRMED", "COMPLETED", "IN_PROGRESS"].includes(status);
      if (shouldConfirm) {
        for (const svc of [hotel.id, transport.id]) {
          await ctx.db.patch(svc, { status: "REQUESTED" });
          await confirmBookingService(ctx, SEED_OWNER, svc, {
            supplierReference: `SUP-REF-${1000 + i}-${svc.slice(-4)}`,
            confirmedAt: from - 15 * DAY,
            confirmedPrice: { amount: svc === hotel.id ? 95 * (product?.durationNights ?? 2) : 85, currency: "OMR" },
            cancellationTerms: "إلغاء مجاني حتى 72 ساعة قبل الخدمة",
            evidenceKind: "EMAIL",
            messageText: `تأكيد الحجز من المورد بالبريد الإلكتروني بتاريخ ${new Date(from - 15 * DAY).toISOString().slice(0, 10)}.`,
          });
        }
        await ctx.db.patch(bookingId, { status: status as never, confirmedAt: from - 15 * DAY });
      } else if (status === "PENDING_CONFIRMATION") {
        await ctx.db.patch(hotel.id, { status: "REQUESTED" });
      } else if (status === "CANCELLED") {
        await ctx.db.patch(hotel.id, { status: "CANCELLED" });
        await ctx.db.patch(transport.id, { status: "CANCELLED" });
        await ctx.db.patch(bookingId, { cancelledAt: NOW - 3 * DAY, cancellationReason: "تغيّرت خطط العميل" });
      }
      bookings.push(bookingId);
    }
    return { bookings };
  },
});

export const seedGovernance = internalMutation({
  args: {},
  handler: async (ctx) => {
    const policies = [
      ["سياسة التسعير", "PRICING", "الهامش المستهدف 18% والحد الأدنى 10%؛ الأسعار الاسترشادية لا تدخل عرضاً للعميل دون تأكيد المورد واعتماد المالك.", ["executive", "product", "sales"]],
      ["سياسة الخصومات", "DISCOUNT", "الخصم حتى 10% من صلاحية المبيعات؛ ما فوق ذلك يتطلب قرار المالك ويُسجَّل في سجل القرارات.", ["executive", "sales"]],
      ["سياسة الاسترداد والإلغاء", "REFUND", "تُطبَّق شروط إلغاء المورد أولاً؛ رسوم إدارية 15 ريالاً لكل إلغاء؛ الاسترداد خلال 14 يوم عمل.", ["executive", "sales", "support"]],
      ["سياسة خدمة العملاء", "CUSTOMER_SERVICE", "الرد على الاستفسارات خلال ساعتين في أوقات العمل؛ الشكاوى تُصعَّد فوراً؛ لا يُذكر سعر غير معتمد.", ["executive", "support", "sales"]],
      ["سياسة استخدام الذكاء الاصطناعي", "AI_USAGE", "الوكلاء يقترحون ويجهّزون؛ كل إجراء خارجي يمر باعتماد المالك؛ لا بيانات عملاء خارج نطاق المهمة؛ كل حقيقة تُسنَد إلى مصدر.", ["executive", "product", "sales", "support"]],
    ] as const;
    for (const [title, category, summary, agents] of policies) {
      await create(ctx, "policies", { title, category, summary, body: `# ${title}\n\n${summary}\n\nالإصدار 1.0 — نافذ من تاريخ الاعتماد.`, lifecycle: "ACTIVE", appliesToAgents: [...agents], validFrom: d(-30) }, SEED_OWNER);
    }
    for (const [title, kind, description, reason, to] of [
      ["اعتماد الهامش المستهدف 18%", "POLICY_APPROVAL", "اعتماد سياسة التسعير الإصدار 1.0", "توازن بين التنافسية والربحية", undefined],
      ["استثناء خصم 15% لمجموعات الشركات", "TEMPORARY_EXCEPTION", "يسمح لوكيل المبيعات باقتراح خصم حتى 15% لعروض الشركات (10 أفراد فأكثر) حتى نهاية الموسم", "حملة مجموعات الشركات", d(90)],
      ["رفع حد التصعيد لقيمة الحجز إلى 2000 ريال", "LIMIT_INCREASE", "طلبات الحجز فوق 2000 ريال تُعاد معالجتها بالنموذج المتوسط", "تقليل الأخطاء في الحجوزات الكبيرة", undefined],
    ] as const) {
      await create(ctx, "decisionRegister", { title, kind, description, reason, effectiveFrom: d(-10), effectiveTo: to, status: "ACTIVE" }, SEED_OWNER);
    }
    return null;
  },
});

export const markSeeded = internalMutation({
  args: { version: v.string() },
  handler: async (ctx, { version }) => {
    await setSetting(ctx, "company", {}, SEED);
    const existing = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "seed")).unique();
    if (existing) await ctx.db.patch(existing._id, { value: { version, seededAt: Date.now() }, updatedAt: Date.now(), updatedBy: SEED });
    else await ctx.db.insert("settings", { key: "seed", value: { version, seededAt: Date.now() }, updatedAt: Date.now(), updatedBy: SEED });
    await appendAudit(ctx, { actor: SEED, table: "settings", recordId: "seed", event: "SEED", newValue: { version }, severity: "D2" });
  },
});

export const checkSeedAllowed = internalMutation({
  args: { force: v.boolean() },
  handler: async (ctx, { force }) => {
    if (process.env.DEPLOYMENT_STAGE === "prod") throw new Error("SEED_FORBIDDEN_IN_PROD");
    const existing = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "seed")).unique();
    if (existing && !force) throw new Error("ALREADY_SEEDED: run with {\"force\": true} to seed again (records are appended, not replaced)");
    await ensureDefaultsInternal(ctx);
    await getSetting(ctx, "company");
    return null;
  },
});

interface SeedReference {
  destinations: Record<string, Id<"destinations">>;
  attractions: Id<"attractions">[];
  suppliers: Record<string, Id<"suppliers">>;
  hotels: Record<string, Id<"hotels">>;
  experiences: Id<"experiences">[];
}

export const run = internalAction({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }): Promise<{ products: number; customers: number; leads: number; rates: number; documents: number }> => {
    await ctx.runMutation(internal.seed.checkSeedAllowed, { force: force ?? false });
    const ref: SeedReference = await ctx.runMutation(internal.seed.seedReference, {});
    const { rates }: { rates: Id<"rates">[] } = await ctx.runMutation(internal.seed.seedRates, { suppliers: ref.suppliers, hotels: ref.hotels, experiences: ref.experiences });
    const { products }: { products: Id<"products">[] } = await ctx.runMutation(internal.seed.seedProducts, { destinations: ref.destinations, hotels: ref.hotels, suppliers: ref.suppliers, rates, experiences: ref.experiences });
    const { customers, leads }: { customers: Id<"customers">[]; leads: Id<"leads">[] } = await ctx.runMutation(internal.seed.seedCustomersLeads, { products });
    await ctx.runMutation(internal.seed.seedBookings, { customers, leads, products, suppliers: ref.suppliers, hotels: ref.hotels, rates });
    await ctx.runMutation(internal.seed.seedGovernance, {});
    // Knowledge base v1: stored as files, processed by the pipeline, then activated.
    let documents = 0;
    for (const doc of SEED_DOCUMENTS) {
      const storageId = await ctx.storage.store(new Blob([doc.text], { type: "text/markdown" }));
      const documentId = await ctx.runMutation(internal.documents.registerInternal, {
        title: doc.title,
        documentType: doc.documentType,
        domain: doc.domain,
        language: "ar",
        classification: doc.classification,
        allowedAgents: [...doc.allowedAgents],
        storageId,
        mimeType: "text/markdown",
        sizeBytes: doc.text.length,
        originalFileName: `${doc.slug}.md`,
        validFrom: d(-30),
        validTo: doc.validToDays ? d(doc.validToDays) : undefined,
      });
      await ctx.runAction(internal.knowledge.pipeline.process, { documentId });
      await ctx.runMutation(internal.documents.activateInternal, { documentId });
      documents += 1;
    }
    await ctx.runMutation(internal.seed.markSeeded, { version: "1.0" });
    console.log(`[seed] done: ${products.length} products, ${customers.length} customers, ${leads.length} leads, ${rates.length} rates, ${documents} documents`);
    return { products: products.length, customers: customers.length, leads: leads.length, rates: rates.length, documents };
  },
});
