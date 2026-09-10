/**
 * Convex schema — the single source of truth for the company data backbone.
 *
 * The 12 business domains (section 4.5) are laid out below in order. Tables
 * marked MVP are implemented now; everything else is documented as a
 * `// Phase 2+` block with its planned fields so this file stays a map of the
 * future data model. Every enumerated field is constrained to the controlled
 * vocabulary in `./lib/vocab.ts`.
 *
 * Schema version: 1.2 (see docs/DATA_CHANGE_PROCESS.md).
 */
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actorValidator,
  baseFields,
  citationValidator,
  literals,
  moneyValidator,
  sourceValidator,
  validityFields,
  versionFields,
  zonedTimeValidator,
} from "./lib/baseFields";
import * as V from "./lib/vocab";

/** The five separated pricing fields (section 4.6). Margin is derived, never stored by hand. */
const pricingFields = v.object({
  supplierCost: v.optional(moneyValidator),
  internalCost: v.optional(moneyValidator),
  minSellingPrice: v.optional(moneyValidator),
  recommendedSellingPrice: v.optional(moneyValidator),
  customerSellingPrice: v.optional(moneyValidator),
});

const dateRange = v.object({ from: v.number(), to: v.number() });

const relatedEntity = v.object({ table: v.string(), recordId: v.string() });

export default defineSchema({
  // =========================================================================
  // Authentication & users (Convex Auth tables + our extensions)
  // =========================================================================
  ...authTables,
  users: defineTable({
    // Fields expected by Convex Auth
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // Our extensions
    role: v.optional(literals(V.USER_ROLES)),
    disabled: v.optional(v.boolean()),
    locale: v.optional(literals(V.LANGUAGES)),
    lastLoginAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  // =========================================================================
  // Platform: counters, settings, reference data
  // =========================================================================
  counters: defineTable({ key: v.string(), value: v.number() }).index("by_key", ["key"]),

  /** Fixed-window rate limits for public HTTP endpoints (contact form, webhooks). */
  httpRateLimits: defineTable({ key: v.string(), windowStart: v.number(), count: v.number() }).index("by_key", ["key"]),

  /** Key/value settings editable from the UI without redeploying (model routing, budgets, company…). */
  settings: defineTable({
    key: v.string(),
    value: v.any(),
    updatedAt: v.number(),
    updatedBy: actorValidator,
  }).index("by_key", ["key"]),

  refCountries: defineTable({
    code: v.string(),
    iso3: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    phonePrefix: v.optional(v.string()),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  refCurrencies: defineTable({
    code: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    decimals: v.number(),
    /** OMR value of one unit of this currency. */
    rateToBase: v.number(),
    rateSource: v.string(),
    rateUpdatedAt: v.number(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  refLanguages: defineTable({
    code: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    rtl: v.boolean(),
  }).index("by_code", ["code"]),

  refServiceTypes: defineTable({
    code: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    componentType: literals(V.COMPONENT_TYPES),
    defaultRateBasis: literals(V.RATE_BASES),
  }).index("by_code", ["code"]),

  refPaymentMethods: defineTable({
    code: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    active: v.boolean(),
  }).index("by_code", ["code"]),

  refCancellationTypes: defineTable({
    code: v.string(),
    nameAr: v.string(),
    nameEn: v.string(),
    description: v.string(),
  }).index("by_code", ["code"]),

  // =========================================================================
  // Domain 1 — Customer (owner now: support → future agent 04)
  // =========================================================================
  customers: defineTable({
    ...baseFields,
    fullName: v.string(),
    normalizedName: v.string(),
    customerType: literals(V.CUSTOMER_TYPES),
    phone: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    preferredLanguage: literals(V.LANGUAGES),
    preferredChannel: v.optional(literals(V.CHANNELS)),
    city: v.optional(v.string()),
    /** Stored only when operationally required; always STRICTLY_CONFIDENTIAL. */
    nationality: v.optional(v.string()),
    idDocumentRef: v.optional(v.string()),
    consentStatus: literals(V.CONSENT_STATUSES),
    consentUpdatedAt: v.optional(v.number()),
    tags: v.array(v.string()),
    status: literals(V.RECORD_STATUSES),
  })
    .index("by_businessId", ["businessId"])
    .index("by_normalizedPhone", ["normalizedPhone"])
    .index("by_normalizedEmail", ["normalizedEmail"])
    .index("by_normalizedName", ["normalizedName"])
    .index("by_status", ["status"]),

  /** Links a channel identity (Instagram sender id, WhatsApp number…) to a customer (schema 1.2). */
  channelIdentities: defineTable({
    channel: literals(V.CHANNELS),
    externalId: v.string(),
    customerId: v.id("customers"),
    handle: v.optional(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_channel_externalId", ["channel", "externalId"])
    .index("by_customer", ["customerId"]),

  /** Stated vs inferred preferences; inferred ones are never treated as facts. */
  customerPreferences: defineTable({
    customerId: v.id("customers"),
    key: v.string(),
    value: v.string(),
    origin: literals(V.PREFERENCE_ORIGINS),
    confidence: v.optional(v.number()),
    source: sourceValidator,
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_customer", ["customerId"]),

  // Phase 2+: customerConsents { customerId, purpose, status, grantedAt, withdrawnAt, channel, evidenceRef }

  // =========================================================================
  // Domain 2 — Sales & CRM (owner now: sales → future agent 03)
  // =========================================================================
  leads: defineTable({
    ...baseFields,
    customerId: v.optional(v.id("customers")),
    contactName: v.string(),
    contactPhone: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    channel: literals(V.CHANNELS),
    stage: literals(V.LEAD_STAGES),
    lostReason: v.optional(literals(V.LOST_REASONS)),
    interestedProductId: v.optional(v.id("products")),
    expectedValue: v.optional(moneyValidator),
    travelDateFrom: v.optional(v.number()),
    travelDateTo: v.optional(v.number()),
    paxAdults: v.optional(v.number()),
    paxChildren: v.optional(v.number()),
    lastContactAt: v.optional(v.number()),
    nextFollowUpAt: v.optional(v.number()),
    summary: v.optional(v.string()),
  })
    .index("by_businessId", ["businessId"])
    .index("by_stage", ["stage"])
    .index("by_customer", ["customerId"])
    .index("by_nextFollowUp", ["nextFollowUpAt"]),

  quotes: defineTable({
    ...baseFields,
    ...versionFields,
    leadId: v.id("leads"),
    customerId: v.optional(v.id("customers")),
    productId: v.optional(v.id("products")),
    /** Version of the product the quote was built on (section 4.6). */
    productVersion: v.optional(v.string()),
    status: literals(V.QUOTE_STATUSES),
    lines: v.array(
      v.object({
        componentType: literals(V.COMPONENT_TYPES),
        description: v.string(),
        quantity: v.number(),
        rateId: v.optional(v.id("rates")),
        rateTrust: v.optional(literals(V.RATE_TRUSTS)),
        pricing: pricingFields,
      }),
    ),
    totals: pricingFields,
    /** Warnings such as "quote uses ESTIMATED rates" that must be acknowledged by the owner. */
    priceWarnings: v.array(v.string()),
    validUntil: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    approvalId: v.optional(v.id("approvals")),
    citations: v.array(citationValidator),
  })
    .index("by_lead", ["leadId"])
    .index("by_status", ["status"])
    .index("by_businessId", ["businessId"]),

  /** Unified inbox: every inbound/outbound customer message from every channel. */
  interactions: defineTable({
    businessId: v.string(),
    customerId: v.optional(v.id("customers")),
    leadId: v.optional(v.id("leads")),
    channel: literals(V.CHANNELS),
    direction: literals(V.INTERACTION_DIRECTIONS),
    kind: v.optional(literals(V.INTERACTION_KINDS)),
    status: literals(V.INTERACTION_STATUSES),
    externalId: v.optional(v.string()),
    externalSenderId: v.optional(v.string()),
    subject: v.optional(v.string()),
    body: v.string(),
    language: v.optional(literals(V.LANGUAGES)),
    classification: literals(V.CLASSIFICATIONS),
    aiClassification: v.optional(
      v.object({
        kind: literals(V.INTERACTION_KINDS),
        confidence: v.number(),
        model: v.string(),
        escalated: v.boolean(),
        escalationReason: v.optional(v.string()),
      }),
    ),
    proposedReply: v.optional(v.string()),
    approvalId: v.optional(v.id("approvals")),
    taskId: v.optional(v.id("tasks")),
    receivedAt: v.number(),
    sentAt: v.optional(v.number()),
    /** Outbound only (schema 1.2): MOCK = logged in mock mode, QUEUED/SENT/FAILED = live channel delivery. */
    deliveryStatus: v.optional(v.union(v.literal("MOCK"), v.literal("QUEUED"), v.literal("SENT"), v.literal("FAILED"), v.literal("NOT_CONNECTED"))),
    deliveryError: v.optional(v.string()),
    createdBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_externalId", ["externalId"])
    .index("by_receivedAt", ["receivedAt"]),

  /**
   * Post-sale follow-ups (schema 1.2): welcome, pre-trip reminder, satisfaction
   * survey. Scheduled by the daily cron from confirmed bookings, sent only
   * after the owner approves the generated message.
   */
  followUps: defineTable({
    businessId: v.string(),
    bookingId: v.id("bookings"),
    customerId: v.id("customers"),
    kind: literals(V.FOLLOW_UP_KINDS),
    status: literals(V.FOLLOW_UP_STATUSES),
    dueAt: v.number(),
    channel: literals(V.CHANNELS),
    language: literals(V.LANGUAGES),
    message: v.optional(v.string()),
    approvalId: v.optional(v.id("approvals")),
    interactionId: v.optional(v.id("interactions")),
    sentAt: v.optional(v.number()),
    skipReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_booking_kind", ["bookingId", "kind"])
    .index("by_status_dueAt", ["status", "dueAt"])
    .index("by_customer", ["customerId"]),

  // =========================================================================
  // Domain 3 — Tourism Product (owner now: product → future agent 02)
  // =========================================================================
  products: defineTable({
    ...baseFields,
    ...versionFields,
    ...validityFields,
    /** Groups all versions of the same product (businessId of V1.0). */
    productFamilyId: v.string(),
    name: v.string(),
    nameEn: v.optional(v.string()),
    productType: literals(V.PRODUCT_TYPES),
    status: literals(V.PRODUCT_LIFECYCLE),
    destinationIds: v.array(v.id("destinations")),
    durationDays: v.number(),
    durationNights: v.number(),
    summary: v.string(),
    highlights: v.array(v.string()),
    inclusions: v.array(v.string()),
    exclusions: v.array(v.string()),
    terms: v.optional(v.string()),
    /** Per-person pricing split; margin is computed from these fields. */
    pricing: pricingFields,
    targetMarginPercent: v.optional(v.number()),
    minPax: v.optional(v.number()),
    maxPax: v.optional(v.number()),
    seasons: v.array(literals(V.SEASONS)),
    approvalId: v.optional(v.id("approvals")),
    approvedBy: v.optional(actorValidator),
    approvedAt: v.optional(v.number()),
    citations: v.array(citationValidator),
  })
    .index("by_status", ["status"])
    .index("by_family", ["productFamilyId"])
    .index("by_businessId", ["businessId"]),

  productComponents: defineTable({
    businessId: v.string(),
    productId: v.id("products"),
    componentType: literals(V.COMPONENT_TYPES),
    dayNumber: v.optional(v.number()),
    order: v.number(),
    description: v.string(),
    supplierId: v.optional(v.id("suppliers")),
    hotelId: v.optional(v.id("hotels")),
    experienceId: v.optional(v.id("experiences")),
    attractionId: v.optional(v.id("attractions")),
    rateId: v.optional(v.id("rates")),
    rateTrust: v.optional(literals(V.RATE_TRUSTS)),
    quantity: v.number(),
    unit: literals(V.RATE_BASES),
    pricing: pricingFields,
    source: sourceValidator,
    trustLevel: literals(V.TRUST_LEVELS),
    createdBy: actorValidator,
    updatedBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_product", ["productId"]),

  itineraries: defineTable({
    businessId: v.string(),
    productId: v.id("products"),
    dayNumber: v.number(),
    title: v.string(),
    description: v.string(),
    destinationId: v.optional(v.id("destinations")),
    attractionIds: v.array(v.id("attractions")),
    meals: v.object({ breakfast: v.boolean(), lunch: v.boolean(), dinner: v.boolean() }),
    overnightHotelId: v.optional(v.id("hotels")),
    overnightDestinationId: v.optional(v.id("destinations")),
    createdBy: actorValidator,
    updatedBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_product", ["productId"]),

  // =========================================================================
  // Domain 4 — Destination & Experience (owner now: product → future agent 02)
  // =========================================================================
  destinations: defineTable({
    ...baseFields,
    name: v.string(),
    nameEn: v.string(),
    normalizedName: v.string(),
    kind: literals(V.DESTINATION_KINDS),
    governorate: v.optional(v.string()),
    description: v.optional(v.string()),
    bestSeasons: v.array(literals(V.SEASONS)),
    coordinates: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    imageAssetId: v.optional(v.id("digitalAssets")),
    status: literals(V.RECORD_STATUSES),
  })
    .index("by_status", ["status"])
    .index("by_normalizedName", ["normalizedName"])
    .index("by_businessId", ["businessId"]),

  attractions: defineTable({
    ...baseFields,
    destinationId: v.id("destinations"),
    name: v.string(),
    nameEn: v.optional(v.string()),
    normalizedName: v.string(),
    category: v.optional(v.string()),
    description: v.optional(v.string()),
    visitDurationMinutes: v.optional(v.number()),
    entryFee: v.optional(moneyValidator),
    openingHours: v.optional(v.string()),
    status: literals(V.RECORD_STATUSES),
  })
    .index("by_destination", ["destinationId"])
    .index("by_normalizedName", ["normalizedName"]),

  experiences: defineTable({
    ...baseFields,
    destinationId: v.optional(v.id("destinations")),
    supplierId: v.optional(v.id("suppliers")),
    name: v.string(),
    nameEn: v.optional(v.string()),
    normalizedName: v.string(),
    description: v.optional(v.string()),
    durationHours: v.optional(v.number()),
    difficulty: v.optional(literals(V.DIFFICULTY_LEVELS)),
    minPax: v.optional(v.number()),
    maxPax: v.optional(v.number()),
    seasons: v.array(literals(V.SEASONS)),
    status: literals(V.RECORD_STATUSES),
  })
    .index("by_destination", ["destinationId"])
    .index("by_supplier", ["supplierId"])
    .index("by_normalizedName", ["normalizedName"]),

  // Phase 2+: routes { name, destinationIds[], legs[] { fromDestinationId, toDestinationId, distanceKm, durationMinutes, roadType }, status }

  // =========================================================================
  // Domain 5 — Supplier & Contract (owner now: product (temporary) → future agent 08)
  // =========================================================================
  suppliers: defineTable({
    ...baseFields,
    name: v.string(),
    nameEn: v.optional(v.string()),
    normalizedName: v.string(),
    supplierType: literals(V.SUPPLIER_TYPES),
    status: literals(V.SUPPLIER_STATUSES),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    email: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    website: v.optional(v.string()),
    city: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    /** Masked reference only (e.g. last 4 digits); D4 change, STRICTLY_CONFIDENTIAL. */
    bankAccountRef: v.optional(v.string()),
    /** Verified performance, operational notes and AI assessment are kept apart (section 4.8). */
    performance: v.optional(
      v.object({
        verifiedScore: v.optional(v.number()),
        operationalNotes: v.optional(v.string()),
        aiAssessment: v.optional(v.string()),
        aiAssessmentAt: v.optional(v.number()),
      }),
    ),
    tags: v.array(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_type", ["supplierType"])
    .index("by_normalizedName", ["normalizedName"])
    .index("by_normalizedPhone", ["normalizedPhone"])
    .index("by_normalizedEmail", ["normalizedEmail"])
    .index("by_businessId", ["businessId"]),

  hotels: defineTable({
    ...baseFields,
    supplierId: v.optional(v.id("suppliers")),
    destinationId: v.id("destinations"),
    name: v.string(),
    nameEn: v.optional(v.string()),
    normalizedName: v.string(),
    category: literals(V.HOTEL_CATEGORIES),
    address: v.optional(v.string()),
    roomTypes: v.array(v.object({ code: v.string(), name: v.string(), maxOccupancy: v.number() })),
    amenities: v.array(v.string()),
    childPolicy: v.optional(v.string()),
    checkInTime: v.optional(v.string()),
    checkOutTime: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    website: v.optional(v.string()),
    status: literals(V.RECORD_STATUSES),
  })
    .index("by_destination", ["destinationId"])
    .index("by_supplier", ["supplierId"])
    .index("by_normalizedName", ["normalizedName"])
    .index("by_businessId", ["businessId"]),

  /** Phase 2 feature; table created now with its core fields. */
  contracts: defineTable({
    ...baseFields,
    ...validityFields,
    ...versionFields,
    supplierId: v.id("suppliers"),
    title: v.string(),
    status: literals(V.CONTRACT_STATUSES),
    documentId: v.optional(v.id("documents")),
    currency: v.string(),
    paymentTerms: v.optional(v.string()),
    cancellationTerms: v.optional(v.string()),
  })
    .index("by_supplier", ["supplierId"])
    .index("by_status", ["status"]),

  // Phase 2+: vehicles { supplierId, type, plate, capacity, driverIncluded, status }
  // Phase 2+: guides { supplierId?, name, languages[], licenseRef, specialties[], status }

  // =========================================================================
  // Domain 6 — Rates & Commercial (owner now: product → future agents 08/09)
  // =========================================================================
  rates: defineTable({
    ...baseFields,
    ...validityFields,
    ...versionFields,
    supplierId: v.id("suppliers"),
    hotelId: v.optional(v.id("hotels")),
    experienceId: v.optional(v.id("experiences")),
    serviceType: v.string(),
    serviceDescription: v.string(),
    componentType: literals(V.COMPONENT_TYPES),
    roomType: v.optional(v.string()),
    occupancy: v.optional(v.number()),
    rateBasis: literals(V.RATE_BASES),
    amount: moneyValidator,
    season: literals(V.SEASONS),
    blackoutDates: v.array(dateRange),
    taxesAndFees: v.object({
      included: v.boolean(),
      percent: v.optional(v.number()),
      fixed: v.optional(moneyValidator),
      notes: v.optional(v.string()),
    }),
    cancellationTerms: v.string(),
    cancellationTypeCode: v.optional(v.string()),
    rateTrust: literals(V.RATE_TRUSTS),
    status: literals(V.RATE_STATUSES),
    contractId: v.optional(v.id("contracts")),
    sourceDocumentId: v.optional(v.id("documents")),
    minPax: v.optional(v.number()),
    maxPax: v.optional(v.number()),
  })
    .index("by_supplier", ["supplierId"])
    .index("by_hotel", ["hotelId"])
    .index("by_status", ["status"])
    .index("by_rateTrust", ["rateTrust"])
    .index("by_freshness", ["freshness"])
    .index("by_validTo", ["validTo"])
    .index("by_businessId", ["businessId"]),

  pricingRules: defineTable({
    ...baseFields,
    ...validityFields,
    kind: literals(V.PRICING_RULE_KINDS),
    name: v.string(),
    value: v.number(),
    unit: v.union(v.literal("PERCENT"), v.literal("OMR")),
    appliesTo: v.object({
      productType: v.optional(literals(V.PRODUCT_TYPES)),
      componentType: v.optional(literals(V.COMPONENT_TYPES)),
      destinationId: v.optional(v.id("destinations")),
    }),
    priority: v.number(),
    status: literals(V.RECORD_STATUSES),
    decisionId: v.optional(v.id("decisionRegister")),
  })
    .index("by_kind", ["kind"])
    .index("by_status", ["status"]),

  // =========================================================================
  // Domain 7 — Booking & Operations (owner now: support (temporary) → future agent 07)
  // =========================================================================
  bookings: defineTable({
    ...baseFields,
    customerId: v.id("customers"),
    leadId: v.optional(v.id("leads")),
    quoteId: v.optional(v.id("quotes")),
    productId: v.optional(v.id("products")),
    productVersion: v.optional(v.string()),
    status: literals(V.BOOKING_STATUSES),
    paymentStatus: literals(V.PAYMENT_STATUSES),
    travelDateFrom: v.number(),
    travelDateTo: v.number(),
    timezone: v.string(),
    paxAdults: v.number(),
    paxChildren: v.number(),
    totalSellingPrice: moneyValidator,
    totalSupplierCost: v.optional(moneyValidator),
    specialRequests: v.optional(v.string()),
    confirmedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
  })
    .index("by_customer", ["customerId"])
    .index("by_status", ["status"])
    .index("by_travelDateFrom", ["travelDateFrom"])
    .index("by_businessId", ["businessId"]),

  /** Each component of a booking has its own status; CONFIRMED requires evidence. */
  bookingServices: defineTable({
    businessId: v.string(),
    bookingId: v.id("bookings"),
    componentType: literals(V.COMPONENT_TYPES),
    supplierId: v.optional(v.id("suppliers")),
    hotelId: v.optional(v.id("hotels")),
    description: v.string(),
    serviceDateFrom: v.number(),
    serviceDateTo: v.optional(v.number()),
    quantity: v.number(),
    status: literals(V.BOOKING_SERVICE_STATUSES),
    rateId: v.optional(v.id("rates")),
    rateTrust: v.optional(literals(V.RATE_TRUSTS)),
    pricing: pricingFields,
    confirmationEvidenceId: v.optional(v.id("confirmationEvidence")),
    supplierReference: v.optional(v.string()),
    createdBy: actorValidator,
    updatedBy: actorValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_booking", ["bookingId"])
    .index("by_status", ["status"]),

  confirmationEvidence: defineTable({
    businessId: v.string(),
    bookingServiceId: v.id("bookingServices"),
    supplierId: v.optional(v.id("suppliers")),
    supplierReference: v.string(),
    confirmedAt: v.number(),
    confirmedPrice: moneyValidator,
    cancellationTerms: v.string(),
    evidenceKind: literals(V.EVIDENCE_KINDS),
    fileStorageId: v.optional(v.id("_storage")),
    messageText: v.optional(v.string()),
    verifiedBy: actorValidator,
    verifiedAt: v.number(),
    createdAt: v.number(),
  }).index("by_service", ["bookingServiceId"]),

  // Phase 2+: trips { bookingId, status, startAt, endAt, guideId, vehicleId, dailyPlan[] }
  // Phase 2+: tripReadiness { tripId, checklist[] { item, status, verifiedBy, at }, readyPercent }
  // Phase 2+: incidents { tripId?, bookingId?, severity, description, reportedBy, resolvedAt, rootCause }

  // =========================================================================
  // Domain 8 — Finance (Phase 2; the real ledger is an external system) → future agent 09
  // =========================================================================
  // Phase 2+: invoices { bookingId, customerId, number, lines[], total(money), status, issuedAt, dueAt, externalRef }
  // Phase 2+: payments { invoiceId, bookingId, amount(money), method(refPaymentMethods), receivedAt, reference, status, evidenceRef }
  // Phase 2+: refunds { paymentId, amount(money), reason, approvalId, processedAt, status }
  // Phase 2+: profitability { bookingId, revenue(money), supplierCost(money), internalCost(money), margin, computedAt, source }

  // =========================================================================
  // Domain 9 — Quality, Risk & Compliance (owner now: executive → future agent 10)
  // =========================================================================
  // Phase 2+: qaReviews { targetTable, targetRecordId, reviewer(actor), score, findings[], status, reviewedAt }
  // Phase 2+: riskRegister { title, category, likelihood, impact, mitigation, owner, status, reviewDueAt }
  // Phase 2+: complianceRecords { requirement, authority, status, evidenceDocumentId, validTo, responsible }

  // =========================================================================
  // Domain 10 — Legal & Regulatory (→ future agent 11)
  // =========================================================================
  // Phase 2+: legalKnowledge { title, jurisdiction, summary, documentId, effectiveFrom, effectiveTo, status }
  // Phase 2+: regulatoryChanges { title, authority, summary, effectiveAt, impactAssessment, status, decisionId }
  // Phase 2+: legalHolds { targetTable, targetRecordId, reason, placedBy, placedAt, releasedAt }

  // =========================================================================
  // Domain 11 — Corporate, HR & Admin (owner now: executive → future agent 13)
  // =========================================================================
  policies: defineTable({
    ...baseFields,
    ...validityFields,
    ...versionFields,
    policyFamilyId: v.string(),
    title: v.string(),
    category: literals(V.POLICY_CATEGORIES),
    summary: v.string(),
    body: v.string(),
    documentId: v.optional(v.id("documents")),
    lifecycle: literals(V.DOCUMENT_LIFECYCLE),
    appliesToAgents: v.array(literals(V.AGENT_SLUGS)),
    approvedBy: v.optional(actorValidator),
    approvedAt: v.optional(v.number()),
  })
    .index("by_category", ["category"])
    .index("by_lifecycle", ["lifecycle"])
    .index("by_family", ["policyFamilyId"]),

  sops: defineTable({
    ...baseFields,
    ...versionFields,
    title: v.string(),
    domain: literals(V.DOMAINS),
    steps: v.array(v.object({ order: v.number(), text: v.string() })),
    body: v.optional(v.string()),
    lifecycle: literals(V.DOCUMENT_LIFECYCLE),
    documentId: v.optional(v.id("documents")),
    appliesToAgents: v.array(literals(V.AGENT_SLUGS)),
  })
    .index("by_domain", ["domain"])
    .index("by_lifecycle", ["lifecycle"]),

  /** Owner decisions with scope and validity; the executive agent checks validity before relying on one. */
  decisionRegister: defineTable({
    ...baseFields,
    kind: literals(V.DECISION_KINDS),
    title: v.string(),
    description: v.string(),
    scope: v.object({
      table: v.optional(v.string()),
      recordId: v.optional(v.string()),
      agentSlug: v.optional(literals(V.AGENT_SLUGS)),
      domain: v.optional(literals(V.DOMAINS)),
    }),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    reason: v.string(),
    status: literals(V.DECISION_STATUSES),
    decidedBy: actorValidator,
    decidedAt: v.number(),
    relatedApprovalId: v.optional(v.id("approvals")),
    relatedTaskId: v.optional(v.id("tasks")),
  })
    .index("by_status", ["status"])
    .index("by_kind", ["kind"]),

  // Phase 2+: humanStaff { userId?, name, role, department, phone, email, status, startDate }

  // =========================================================================
  // Domain 12 — Digital, Tech & Analytics (owner now: executive → future agents 12/14)
  // =========================================================================
  /** Agents are data, not code: the owner edits instructions from the UI. */
  agents: defineTable({
    slug: literals(V.AGENT_SLUGS),
    name: v.string(),
    nameEn: v.string(),
    description: v.string(),
    systemPrompt: v.string(),
    promptVersion: v.number(),
    allowedTools: v.array(v.string()),
    defaultModel: v.string(),
    escalationModel: v.optional(v.string()),
    monthlyBudgetUsd: v.number(),
    maxStepsPerTask: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    updatedBy: actorValidator,
  }).index("by_slug", ["slug"]),

  tasks: defineTable({
    businessId: v.string(),
    title: v.string(),
    request: v.string(),
    origin: literals(V.TASK_ORIGINS),
    requestedBy: actorValidator,
    agentSlug: literals(V.AGENT_SLUGS),
    parentTaskId: v.optional(v.id("tasks")),
    rootTaskId: v.optional(v.id("tasks")),
    conversationId: v.optional(v.id("conversations")),
    status: literals(V.TASK_STATUSES),
    priority: literals(V.TASK_PRIORITIES),
    /** Cooperative cancellation flag checked before every model call and tool execution. */
    cancelRequested: v.boolean(),
    cancelReason: v.optional(v.string()),
    cancelledBy: v.optional(actorValidator),
    dueAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    result: v.optional(v.string()),
    partialResult: v.optional(v.string()),
    error: v.optional(v.string()),
    stepCount: v.number(),
    costUsd: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    model: v.optional(v.string()),
    /** Purpose-bound context: only the identifiers this task is allowed to work on. */
    contextRefs: v.object({
      customerIds: v.array(v.id("customers")),
      leadIds: v.array(v.id("leads")),
      productIds: v.array(v.id("products")),
      bookingIds: v.array(v.id("bookings")),
    }),
    citations: v.array(citationValidator),
    /** Owner rejection reasons fed back to the agent on the next run. */
    feedback: v.array(v.string()),
    resumedFromTaskId: v.optional(v.id("tasks")),
    schedulerJobId: v.optional(v.id("_scheduled_functions")),
    /** Owner explicitly allowed a premium model for this task (still gated by settings). */
    premiumRequested: v.optional(v.boolean()),
    /** Set when this task re-processes a customer interaction on the escalation model (section 2.1). */
    escalationReason: v.optional(v.string()),
    escalationOf: v.optional(v.id("tasks")),
    /** Interaction that triggered a customer-originated task. */
    interactionId: v.optional(v.id("interactions")),
    /** Provider-agnostic message transcript so a task can pause (approvals, subtasks) and resume. */
    transcript: v.optional(v.any()),
  })
    .index("by_status", ["status"])
    .index("by_agent", ["agentSlug"])
    .index("by_agent_status", ["agentSlug", "status"])
    .index("by_parent", ["parentTaskId"])
    .index("by_root", ["rootTaskId"])
    .index("by_conversation", ["conversationId"])
    .index("by_businessId", ["businessId"]),

  /** Step-by-step trace of every task run: model calls, tool calls, approvals, cancellation. */
  taskRuns: defineTable({
    taskId: v.id("tasks"),
    stepIndex: v.number(),
    kind: literals(V.TASK_RUN_STEP_KINDS),
    model: v.optional(v.string()),
    toolName: v.optional(v.string()),
    toolKind: v.optional(literals(V.TOOL_KINDS)),
    input: v.optional(v.any()),
    output: v.optional(v.any()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    approvalId: v.optional(v.id("approvals")),
    subtaskId: v.optional(v.id("tasks")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_task", ["taskId"]),

  /** Every external action and every D3/D4 change waits here for the owner. */
  approvals: defineTable({
    businessId: v.string(),
    kind: literals(V.APPROVAL_KINDS),
    status: literals(V.APPROVAL_STATUSES),
    taskId: v.optional(v.id("tasks")),
    agentSlug: literals(V.AGENT_SLUGS),
    title: v.string(),
    summary: v.string(),
    payload: v.any(),
    editedPayload: v.optional(v.any()),
    toolName: v.optional(v.string()),
    targetTable: v.optional(v.string()),
    targetRecordId: v.optional(v.string()),
    severity: literals(V.SEVERITY_CLASSES),
    requestedAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(actorValidator),
    decisionReason: v.optional(v.string()),
    executedAt: v.optional(v.number()),
    executionResult: v.optional(v.any()),
    executionError: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_task", ["taskId"])
    .index("by_kind", ["kind"])
    .index("by_businessId", ["businessId"]),

  /** Append-only. There is no update or delete path for this table anywhere in the code base. */
  auditLog: defineTable({
    actor: actorValidator,
    table: v.string(),
    recordId: v.optional(v.string()),
    businessId: v.optional(v.string()),
    event: literals(V.AUDIT_EVENTS),
    oldValue: v.optional(v.any()),
    newValue: v.optional(v.any()),
    reason: v.optional(v.string()),
    taskId: v.optional(v.id("tasks")),
    approvalId: v.optional(v.id("approvals")),
    severity: literals(V.SEVERITY_CLASSES),
    at: v.number(),
  })
    .index("by_table_record", ["table", "recordId"])
    .index("by_actor", ["actor.id"])
    .index("by_event", ["event"])
    .index("by_at", ["at"]),

  /** Token usage and cost per model call (section 5). */
  usageLog: defineTable({
    taskId: v.optional(v.id("tasks")),
    agentSlug: literals(V.AGENT_SLUGS),
    model: v.string(),
    provider: literals(V.LLM_PROVIDERS),
    origin: literals(V.REQUEST_ORIGINS),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cacheReadTokens: v.number(),
    cacheWriteTokens: v.number(),
    /** Server-side web searches in this call (schema 1.1). */
    webSearchRequests: v.optional(v.number()),
    costUsd: v.number(),
    batch: v.boolean(),
    escalated: v.boolean(),
    escalationReason: v.optional(v.string()),
    monthKey: v.string(),
    at: v.number(),
  })
    .index("by_month", ["monthKey"])
    .index("by_month_agent", ["monthKey", "agentSlug"])
    .index("by_month_model", ["monthKey", "model"])
    .index("by_task", ["taskId"]),

  toolRegistry: defineTable({
    name: v.string(),
    kind: literals(V.TOOL_KINDS),
    description: v.string(),
    inputSchema: v.any(),
    allowedAgents: v.array(literals(V.AGENT_SLUGS)),
    resource: v.optional(v.string()),
    action: v.optional(literals(V.ACCESS_ACTIONS)),
    severity: literals(V.SEVERITY_CLASSES),
    requiresApproval: v.boolean(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_name", ["name"]),

  /** Least-privilege access matrix enforced by the services layer (section 4.9). */
  dataAccessMatrix: defineTable({
    agentSlug: literals(V.AGENT_SLUGS),
    resource: v.string(),
    actions: v.array(literals(V.ACCESS_ACTIONS)),
    /** Row-level condition, e.g. "customer_in_task_context". */
    condition: v.optional(v.string()),
    /** Field-level deny list, e.g. ["supplierCost", "internalCost"]. */
    fieldDenyList: v.array(v.string()),
    scope: v.optional(v.string()),
    validTo: v.optional(v.number()),
    grantedBy: actorValidator,
    grantedAt: v.number(),
  })
    .index("by_agent", ["agentSlug"])
    .index("by_agent_resource", ["agentSlug", "resource"]),

  /** Two sources disagree: the agent never picks; it records the conflict. */
  dataConflicts: defineTable({
    businessId: v.string(),
    table: v.string(),
    recordId: v.optional(v.string()),
    field: v.string(),
    candidates: v.array(
      v.object({
        value: v.any(),
        source: sourceValidator,
        trustLevel: literals(V.TRUST_LEVELS),
        observedAt: v.number(),
        contractual: v.optional(v.boolean()),
        specificity: v.optional(v.number()),
        verified: v.optional(v.boolean()),
      }),
    ),
    status: literals(V.CONFLICT_STATUSES),
    resolutionRule: v.optional(literals(V.CONFLICT_RESOLUTION_RULES)),
    resolvedValue: v.optional(v.any()),
    resolvedBy: v.optional(actorValidator),
    resolvedAt: v.optional(v.number()),
    taskId: v.optional(v.id("tasks")),
    createdBy: actorValidator,
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_record", ["table", "recordId"]),

  dataGaps: defineTable({
    businessId: v.string(),
    table: v.string(),
    field: v.string(),
    description: v.string(),
    affectedCount: v.number(),
    totalCount: v.number(),
    percent: v.number(),
    severity: literals(V.SEVERITY_CLASSES),
    status: literals(V.GAP_STATUSES),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_table_field", ["table", "field"]),

  knowledgeGaps: defineTable({
    businessId: v.string(),
    question: v.string(),
    normalizedQuestion: v.string(),
    askedBy: literals(V.AGENT_SLUGS),
    occurrences: v.number(),
    lastAskedAt: v.number(),
    taskIds: v.array(v.id("tasks")),
    status: literals(V.GAP_STATUSES),
    resolutionDocumentId: v.optional(v.id("documents")),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_normalizedQuestion", ["normalizedQuestion"]),

  campaigns: defineTable({
    ...baseFields,
    name: v.string(),
    objective: v.string(),
    platforms: v.array(literals(V.CONTENT_PLATFORMS)),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    status: literals(V.CAMPAIGN_STATUSES),
    targetAudience: v.optional(v.string()),
    budget: v.optional(moneyValidator),
    productIds: v.array(v.id("products")),
    approvalId: v.optional(v.id("approvals")),
  }).index("by_status", ["status"]),

  contentCalendar: defineTable({
    ...baseFields,
    campaignId: v.optional(v.id("campaigns")),
    productId: v.optional(v.id("products")),
    platform: literals(V.CONTENT_PLATFORMS),
    scheduledAt: zonedTimeValidator,
    status: literals(V.CONTENT_STATUSES),
    caption: v.string(),
    captionEn: v.optional(v.string()),
    hashtags: v.array(v.string()),
    visualIdea: v.optional(v.string()),
    assetIds: v.array(v.id("digitalAssets")),
    approvalId: v.optional(v.id("approvals")),
    publishedAt: v.optional(v.number()),
    externalPostId: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_campaign", ["campaignId"])
    .index("by_scheduledAt", ["scheduledAt.timestamp"]),

  digitalAssets: defineTable({
    ...baseFields,
    kind: literals(V.ASSET_KINDS),
    title: v.string(),
    storageId: v.optional(v.id("_storage")),
    url: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    tags: v.array(v.string()),
    usageRights: v.optional(v.string()),
    status: literals(V.RECORD_STATUSES),
  }).index("by_kind", ["kind"]),

  // Phase 2+: workflowRegistry { name, trigger, steps[], owner, status, version }
  // Phase 2+: integrationRegistry { name (META, WHATSAPP, RESEND, VOYAGE), status, lastCheckAt, lastError, config(ref) }
  // Phase 2+: kpiDefinitions { code, nameAr, nameEn, formula, numerator, denominator, source, frequency, owner, target }

  // =========================================================================
  // Knowledge system (DMS + RAG, section 4.7) and memory governance (4.8)
  // =========================================================================
  documents: defineTable({
    ...baseFields,
    ...versionFields,
    ...validityFields,
    documentFamilyId: v.string(),
    title: v.string(),
    documentType: literals(V.DOCUMENT_TYPES),
    domain: literals(V.DOMAINS),
    language: literals(V.LANGUAGES),
    translationStatus: literals(V.TRANSLATION_STATUSES),
    canonicalDocumentId: v.optional(v.id("documents")),
    relatedEntity: v.optional(relatedEntity),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    originalFileName: v.optional(v.string()),
    lifecycle: literals(V.DOCUMENT_LIFECYCLE),
    allowedAgents: v.array(literals(V.AGENT_SLUGS)),
    /** Full extracted text lives in storage; a preview is kept inline. */
    extractedTextStorageId: v.optional(v.id("_storage")),
    textPreview: v.optional(v.string()),
    extractedCharCount: v.optional(v.number()),
    extractionStatus: v.union(
      v.literal("PENDING"),
      v.literal("EXTRACTED"),
      v.literal("FAILED"),
      v.literal("UNSUPPORTED"),
    ),
    extractionError: v.optional(v.string()),
    aiMetadata: v.optional(
      v.object({
        suggestedTitle: v.optional(v.string()),
        suggestedType: v.optional(literals(V.DOCUMENT_TYPES)),
        suggestedDomain: v.optional(literals(V.DOMAINS)),
        summary: v.optional(v.string()),
        keywords: v.array(v.string()),
        model: v.string(),
        status: v.literal("AI_EXTRACTED"),
        generatedAt: v.number(),
      }),
    ),
    /** Rates/terms extracted from the file, offered to the owner; never written to `rates` automatically. */
    proposals: v.array(
      v.object({
        id: v.string(),
        kind: v.union(v.literal("RATE"), v.literal("TERM")),
        data: v.any(),
        status: v.union(v.literal("PENDING"), v.literal("ACCEPTED"), v.literal("REJECTED")),
        decidedAt: v.optional(v.number()),
        createdRecordId: v.optional(v.string()),
      }),
    ),
    chunkCount: v.number(),
    indexedAt: v.optional(v.number()),
    citationCount: v.number(),
    approvedBy: v.optional(actorValidator),
    approvedAt: v.optional(v.number()),
    reviewDueAt: v.optional(v.number()),
  })
    .index("by_lifecycle", ["lifecycle"])
    .index("by_type", ["documentType"])
    .index("by_family", ["documentFamilyId"])
    .index("by_related", ["relatedEntity.table", "relatedEntity.recordId"])
    .index("by_businessId", ["businessId"]),

  /** Vector index for retrieval. Not the source of truth: the approved document is. */
  knowledgeChunks: defineTable({
    documentId: v.id("documents"),
    documentFamilyId: v.string(),
    chunkIndex: v.number(),
    section: v.optional(v.string()),
    text: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    documentType: literals(V.DOCUMENT_TYPES),
    domain: literals(V.DOMAINS),
    country: v.string(),
    language: literals(V.LANGUAGES),
    version: v.string(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    classification: literals(V.CLASSIFICATIONS),
    /** Denormalised from the document so retrieval can filter on it. */
    lifecycle: literals(V.DOCUMENT_LIFECYCLE),
    allowedAgents: v.array(literals(V.AGENT_SLUGS)),
    relatedTable: v.optional(v.string()),
    relatedRecordId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_lifecycle", ["lifecycle"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["lifecycle", "domain", "language", "documentType"],
    })
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["lifecycle", "language", "domain"],
    }),

  /** Governed memory: nothing inferred becomes institutional knowledge without approval. */
  memories: defineTable({
    businessId: v.string(),
    type: literals(V.MEMORY_TYPES),
    origin: literals(V.MEMORY_ORIGINS),
    status: literals(V.MEMORY_STATUSES),
    agentSlug: literals(V.AGENT_SLUGS),
    content: v.string(),
    subject: v.optional(relatedEntity),
    confidence: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    retentionPolicy: literals(V.RETENTION_POLICIES),
    proposedBy: actorValidator,
    reviewedBy: v.optional(actorValidator),
    reviewedAt: v.optional(v.number()),
    taskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  })
    .index("by_agent_status", ["agentSlug", "status"])
    .index("by_subject", ["subject.table", "subject.recordId"])
    .index("by_status", ["status"]),

  dataQualityRules: defineTable({
    name: v.string(),
    table: v.string(),
    field: v.optional(v.string()),
    dimension: literals(V.DATA_QUALITY_DIMENSIONS),
    description: v.string(),
    weight: v.number(),
    severity: literals(V.SEVERITY_CLASSES),
    enabled: v.boolean(),
    createdAt: v.number(),
  }).index("by_table", ["table"]),

  // =========================================================================
  // Owner ↔ executive agent conversation
  // =========================================================================
  conversations: defineTable({
    ownerUserId: v.id("users"),
    title: v.string(),
    activeTaskId: v.optional(v.id("tasks")),
    lastMessageAt: v.number(),
    createdAt: v.number(),
    archivedAt: v.optional(v.number()),
  }).index("by_owner", ["ownerUserId"]),

  chatMessages: defineTable({
    conversationId: v.id("conversations"),
    role: v.union(v.literal("owner"), v.literal("assistant"), v.literal("system")),
    content: v.string(),
    taskId: v.optional(v.id("tasks")),
    status: v.union(v.literal("PENDING"), v.literal("DONE"), v.literal("CANCELLED"), v.literal("ERROR")),
    partial: v.boolean(),
    createdAt: v.number(),
  }).index("by_conversation", ["conversationId"]),

  notifications: defineTable({
    kind: v.string(),
    title: v.string(),
    body: v.string(),
    severity: v.union(v.literal("INFO"), v.literal("WARNING"), v.literal("CRITICAL")),
    relatedTable: v.optional(v.string()),
    relatedRecordId: v.optional(v.string()),
    readAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_unread", ["readAt"]),
});
