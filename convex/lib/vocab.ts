/**
 * Controlled vocabulary for the whole platform.
 *
 * Every status, type and classification used anywhere in the schema, the
 * services layer or the UI is declared here as an `as const` tuple and is
 * enforced in `convex/schema.ts` through `v.union(v.literal(...))`.
 * Free-text statuses are forbidden: no agent and no form can invent a state.
 *
 * Arabic labels for these values live in `lib/i18n/*` (UI concern only).
 */

// ---------------------------------------------------------------------------
// Cross-cutting (base fields, section 4.3)
// ---------------------------------------------------------------------------
export const TRUST_LEVELS = [
  "A_COMPANY_VERIFIED",
  "B_SUPPLIER_CONFIRMED",
  "C_OFFICIAL_SOURCE",
  "D_RELIABLE_EXTERNAL",
  "E_AI_ESTIMATE",
] as const;

export const VERIFICATION_STATUSES = [
  "HUMAN_VERIFIED",
  "AUTO_VERIFIED",
  "AI_EXTRACTED",
  "MIGRATED_UNVERIFIED",
  "UNVERIFIED",
] as const;

export const SOURCE_KINDS = ["db", "web", "api", "document", "human", "ai"] as const;

export const FRESHNESS = ["CURRENT", "EXPIRING", "EXPIRED", "REQUIRES_VERIFICATION"] as const;

export const CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "CUSTOMER_CONFIDENTIAL",
  "STRICTLY_CONFIDENTIAL",
] as const;

/** Generic record lifecycle used by master-data tables without a richer lifecycle. */
export const RECORD_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"] as const;

export const ACTOR_TYPES = ["owner", "agent", "system"] as const;

export const AGENT_SLUGS = ["executive", "product", "sales", "support"] as const;

export const USER_ROLES = ["owner", "staff"] as const;

/** Values used to mark missing data explicitly instead of guessing (section 4.6). */
export const MISSING_MARKERS = ["UNKNOWN", "NOT_PROVIDED", "REQUIRES_VERIFICATION"] as const;

// ---------------------------------------------------------------------------
// Domain 1 — Customer
// ---------------------------------------------------------------------------
export const CUSTOMER_TYPES = [
  "INDIVIDUAL",
  "FAMILY",
  "GROUP",
  "CORPORATE",
  "GOVERNMENT",
  "TRAVEL_PARTNER",
  "VIP",
] as const;

export const CONSENT_STATUSES = ["GRANTED", "NOT_GRANTED", "WITHDRAWN", "PENDING"] as const;

export const PREFERENCE_ORIGINS = ["STATED", "INFERRED"] as const;

export const CHANNELS = ["INSTAGRAM", "WHATSAPP", "WEBSITE", "EMAIL", "PHONE", "SNAPCHAT", "WALK_IN", "REFERRAL", "OTHER"] as const;

// ---------------------------------------------------------------------------
// Domain 2 — Sales & CRM
// ---------------------------------------------------------------------------
export const LEAD_STAGES = [
  "NEW_LEAD",
  "QUALIFIED",
  "REQUIREMENTS_COLLECTED",
  "PROPOSAL_PREPARED",
  "QUOTE_SENT",
  "NEGOTIATION",
  "WON",
  "LOST",
] as const;

export const LOST_REASONS = [
  "PRICE",
  "PRODUCT_FIT",
  "NO_RESPONSE",
  "COMPETITOR",
  "TIMING",
  "AVAILABILITY",
  "TRUST",
  "SERVICE_REQUIREMENT",
] as const;

export const QUOTE_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "SUPERSEDED"] as const;

export const INTERACTION_DIRECTIONS = ["INBOUND", "OUTBOUND", "INTERNAL_NOTE"] as const;

export const INTERACTION_KINDS = ["INQUIRY", "BOOKING_REQUEST", "COMPLAINT", "FOLLOW_UP", "FEEDBACK", "OTHER"] as const;

export const INTERACTION_STATUSES = ["NEW", "CLASSIFIED", "REPLY_PROPOSED", "REPLY_APPROVED", "REPLIED", "ESCALATED", "CLOSED"] as const;

/** Post-sale lifecycle messages (section 3.4); each is sent only after approval. */
export const FOLLOW_UP_KINDS = ["WELCOME", "PRE_TRIP_REMINDER", "SATISFACTION_SURVEY"] as const;

export const FOLLOW_UP_STATUSES = ["SCHEDULED", "PENDING_APPROVAL", "SENT", "SKIPPED", "CANCELLED"] as const;

// ---------------------------------------------------------------------------
// Domain 3 — Tourism Product
// ---------------------------------------------------------------------------
export const PRODUCT_LIFECYCLE = [
  "IDEA",
  "CONCEPT",
  "DESIGN",
  "COSTING",
  "QA",
  "APPROVAL",
  "READY_FOR_SALE",
  "ACTIVE",
  "REVIEW",
  "SUSPENDED",
  "EXPIRED",
  "ARCHIVED",
] as const;

export const PRODUCT_TYPES = ["PACKAGE", "DAY_TOUR", "MULTI_DAY_TOUR", "TRANSFER", "EXPERIENCE", "CUSTOM"] as const;

export const COMPONENT_TYPES = ["HOTEL", "TRANSPORT", "FLIGHT", "VEHICLE_RENTAL", "GUIDE", "ACTIVITY", "MEAL", "TICKET", "INSURANCE", "OTHER"] as const;

// ---------------------------------------------------------------------------
// Domain 4 — Destination & Experience
// ---------------------------------------------------------------------------
export const DESTINATION_KINDS = ["CITY", "REGION", "NATURE", "COAST", "MOUNTAIN", "DESERT", "HERITAGE"] as const;

export const SEASONS = ["ALL_YEAR", "WINTER", "SUMMER", "KHAREEF", "SHOULDER"] as const;

export const DIFFICULTY_LEVELS = ["EASY", "MODERATE", "CHALLENGING"] as const;

// ---------------------------------------------------------------------------
// Domain 5 — Supplier & Contract
// ---------------------------------------------------------------------------
export const SUPPLIER_STATUSES = [
  "PROSPECT",
  "UNDER_REVIEW",
  "APPROVED",
  "PREFERRED",
  "CONDITIONAL",
  "SUSPENDED",
  "BLOCKED",
  "INACTIVE",
  "ARCHIVED",
] as const;

export const SUPPLIER_TYPES = ["HOTEL", "TRANSPORT", "CAR_RENTAL", "AIRLINE", "GUIDE", "ACTIVITY_OPERATOR", "RESTAURANT", "DMC", "OTHER"] as const;

export const HOTEL_CATEGORIES = ["ONE_STAR", "TWO_STAR", "THREE_STAR", "FOUR_STAR", "FIVE_STAR", "BOUTIQUE", "CAMP", "APARTMENT", "UNRATED"] as const;

export const CONTRACT_STATUSES = ["DRAFT", "NEGOTIATION", "SIGNED", "ACTIVE", "EXPIRED", "TERMINATED"] as const;

// ---------------------------------------------------------------------------
// Domain 6 — Rates & Commercial
// ---------------------------------------------------------------------------
export const RATE_BASES = ["PER_PERSON", "PER_ROOM", "PER_NIGHT", "PER_VEHICLE", "PER_GROUP", "PER_ACTIVITY", "FIXED"] as const;

export const RATE_TRUSTS = ["CONTRACTED", "SUPPLIER_CONFIRMED", "LIVE_API", "HISTORICAL", "ESTIMATED"] as const;

export const RATE_STATUSES = ["PROPOSED", "ACTIVE", "SUPERSEDED", "EXPIRED", "REJECTED", "ARCHIVED"] as const;

export const PRICING_RULE_KINDS = ["TARGET_MARGIN", "MIN_MARGIN", "MARKUP", "DISCOUNT_CAP", "ROUNDING", "CHILD_POLICY", "SEASONAL_ADJUSTMENT"] as const;

// ---------------------------------------------------------------------------
// Domain 7 — Booking & Operations
// ---------------------------------------------------------------------------
export const BOOKING_STATUSES = ["INQUIRY", "TENTATIVE", "PENDING_CONFIRMATION", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export const BOOKING_SERVICE_STATUSES = ["PLANNED", "REQUESTED", "CONFIRMED", "AMENDED", "CANCELLED", "FAILED"] as const;

export const PAYMENT_STATUSES = ["UNPAID", "DEPOSIT_PAID", "PARTIALLY_PAID", "PAID", "REFUNDED", "PARTIALLY_REFUNDED"] as const;

export const EVIDENCE_KINDS = ["EMAIL", "PDF", "MESSAGE", "API_RESPONSE", "PHONE_CALL", "PORTAL_SCREENSHOT", "OTHER"] as const;

// ---------------------------------------------------------------------------
// Domain 11 — Corporate, HR & Admin
// ---------------------------------------------------------------------------
export const POLICY_CATEGORIES = ["PRICING", "DISCOUNT", "REFUND", "CUSTOMER_SERVICE", "AI_USAGE", "DATA_PROTECTION", "OPERATIONS", "BRAND", "OTHER"] as const;

export const DOCUMENT_LIFECYCLE = ["DRAFT", "REVIEW", "APPROVED", "ACTIVE", "REVIEW_DUE", "SUPERSEDED", "ARCHIVED"] as const;

export const DECISION_KINDS = ["POLICY_APPROVAL", "TEMPORARY_EXCEPTION", "LIMIT_INCREASE", "AUTO_APPROVAL_RULE", "SUPPLIER_DECISION", "PRODUCT_DECISION", "OTHER"] as const;

export const DECISION_STATUSES = ["ACTIVE", "EXPIRED", "REVOKED"] as const;

// ---------------------------------------------------------------------------
// Domain 12 — Digital, Tech & Analytics (agents runtime)
// ---------------------------------------------------------------------------
export const TASK_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_APPROVAL",
  "WAITING_SUBTASKS",
  "COMPLETED",
  "FAILED",
  "CANCELLING",
  "CANCELLED",
  "BUDGET_EXCEEDED",
] as const;

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;

export const TASK_ORIGINS = ["owner", "customer", "system", "agent"] as const;

/** Owner-defined recurring agent tasks (schema 1.3). */
export const SCHEDULE_FREQUENCIES = ["ONCE", "DAILY", "WEEKLY", "MONTHLY"] as const;

export const TASK_RUN_STEP_KINDS = ["MODEL_CALL", "TOOL_CALL", "TOOL_RESULT", "APPROVAL_REQUESTED", "SUBTASK_CREATED", "NOTE", "CANCELLED", "ERROR", "FINAL"] as const;

export const TOOL_KINDS = ["read", "write_internal", "external"] as const;

export const APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED", "EDITED_APPROVED", "CANCELLED", "EXECUTED", "EXECUTION_FAILED"] as const;

export const APPROVAL_KINDS = [
  "SEND_CUSTOMER_MESSAGE",
  "SEND_QUOTE",
  "PUBLISH_CONTENT",
  "CONFIRM_BOOKING",
  "SENSITIVE_CHANGE",
  "RATE_PROPOSAL",
  "MEMORY_PROMOTION",
  "DATA_MERGE",
  "OTHER",
] as const;

export const AUDIT_EVENTS = ["CREATE", "UPDATE", "ARCHIVE", "RESTORE", "SENSITIVE_READ", "EXPORT", "LOGIN", "LOGIN_FAILED", "LOGOUT", "APPROVAL", "REJECTION", "CANCEL", "EMERGENCY_STOP", "EMERGENCY_RESUME", "SEED", "SYSTEM"] as const;

/** Change-severity classes (section 4.6). D3/D4 require owner approval. */
export const SEVERITY_CLASSES = ["D1", "D2", "D3", "D4"] as const;

export const ACCESS_ACTIONS = ["READ", "CREATE", "UPDATE", "ARCHIVE", "SENSITIVE_READ", "EXPORT"] as const;

export const CONFLICT_STATUSES = ["OPEN", "RESOLVED", "ESCALATED"] as const;

export const CONFLICT_RESOLUTION_RULES = ["AUTHORITY", "RECENCY", "SPECIFICITY", "CONTRACT_STATUS", "VERIFICATION", "OWNER_DECISION"] as const;

export const GAP_STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "DISMISSED"] as const;

export const CAMPAIGN_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "RUNNING", "PAUSED", "COMPLETED", "ARCHIVED"] as const;

export const CONTENT_PLATFORMS = ["INSTAGRAM", "SNAPCHAT", "WEBSITE", "WHATSAPP_STATUS"] as const;

export const CONTENT_STATUSES = ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED", "FAILED", "ARCHIVED"] as const;

export const ASSET_KINDS = ["IMAGE", "VIDEO", "DOCUMENT", "LOGO", "TEMPLATE", "OTHER"] as const;

// ---------------------------------------------------------------------------
// Knowledge & memory (sections 4.7, 4.8)
// ---------------------------------------------------------------------------
export const DOCUMENT_TYPES = [
  "SUPPLIER_CONTRACT",
  "PRICE_LIST",
  "DESTINATION_GUIDE",
  "POLICY",
  "SOP",
  "CUSTOMER_TERMS",
  "BRAND_GUIDE",
  "AGENT_INSTRUCTIONS",
  "PRODUCT_RULES",
  "OTHER",
] as const;

export const DOMAINS = [
  "CUSTOMER",
  "SALES_CRM",
  "TOURISM_PRODUCT",
  "DESTINATION_EXPERIENCE",
  "SUPPLIER_CONTRACT",
  "RATES_COMMERCIAL",
  "BOOKING_OPERATIONS",
  "FINANCE",
  "QUALITY_RISK_COMPLIANCE",
  "LEGAL_REGULATORY",
  "CORPORATE_HR_ADMIN",
  "DIGITAL_TECH_ANALYTICS",
] as const;

export const LANGUAGES = ["ar", "en"] as const;

export const TRANSLATION_STATUSES = ["CANONICAL", "TRANSLATED", "MACHINE_TRANSLATED", "PENDING"] as const;

export const MEMORY_TYPES = ["SESSION", "WORKFLOW", "CUSTOMER", "SUPPLIER", "COMPANY_DECISION"] as const;

export const MEMORY_ORIGINS = ["STATED", "INFERRED", "AI_ASSESSMENT", "HUMAN_VERIFIED"] as const;

export const MEMORY_STATUSES = ["PROPOSED", "APPROVED", "REJECTED", "EXPIRED"] as const;

export const RETENTION_POLICIES = ["SESSION_ONLY", "DAYS_30", "DAYS_90", "DAYS_365", "UNTIL_REVOKED"] as const;

export const DATA_QUALITY_DIMENSIONS = ["ACCURACY", "COMPLETENESS", "CONSISTENCY", "FRESHNESS", "VALIDITY", "UNIQUENESS", "TRACEABILITY"] as const;

// ---------------------------------------------------------------------------
// Model routing (section 2.1)
// ---------------------------------------------------------------------------
export const REQUEST_ORIGINS = ["customer", "owner", "executive"] as const;

export const LLM_PROVIDERS = ["anthropic", "openai_compatible", "mock"] as const;

// ---------------------------------------------------------------------------
// Allowed status transitions (enforced by services; documented in docs/VOCABULARY.md)
// ---------------------------------------------------------------------------
export const PRODUCT_TRANSITIONS: Record<(typeof PRODUCT_LIFECYCLE)[number], readonly (typeof PRODUCT_LIFECYCLE)[number][]> = {
  IDEA: ["CONCEPT", "ARCHIVED"],
  CONCEPT: ["DESIGN", "ARCHIVED"],
  DESIGN: ["COSTING", "CONCEPT", "ARCHIVED"],
  COSTING: ["QA", "DESIGN", "ARCHIVED"],
  QA: ["APPROVAL", "COSTING", "ARCHIVED"],
  APPROVAL: ["READY_FOR_SALE", "QA", "ARCHIVED"],
  READY_FOR_SALE: ["ACTIVE", "REVIEW", "ARCHIVED"],
  ACTIVE: ["REVIEW", "SUSPENDED", "EXPIRED", "ARCHIVED"],
  REVIEW: ["ACTIVE", "DESIGN", "SUSPENDED", "ARCHIVED"],
  SUSPENDED: ["ACTIVE", "REVIEW", "ARCHIVED"],
  EXPIRED: ["REVIEW", "ARCHIVED"],
  ARCHIVED: [],
};

export const LEAD_TRANSITIONS: Record<(typeof LEAD_STAGES)[number], readonly (typeof LEAD_STAGES)[number][]> = {
  NEW_LEAD: ["QUALIFIED", "LOST"],
  QUALIFIED: ["REQUIREMENTS_COLLECTED", "PROPOSAL_PREPARED", "QUOTE_SENT", "LOST"],
  REQUIREMENTS_COLLECTED: ["PROPOSAL_PREPARED", "QUOTE_SENT", "LOST"],
  PROPOSAL_PREPARED: ["QUOTE_SENT", "REQUIREMENTS_COLLECTED", "LOST"],
  QUOTE_SENT: ["NEGOTIATION", "WON", "LOST"],
  NEGOTIATION: ["QUOTE_SENT", "WON", "LOST"],
  WON: [],
  LOST: ["NEW_LEAD"],
};

export const BOOKING_SERVICE_TRANSITIONS: Record<(typeof BOOKING_SERVICE_STATUSES)[number], readonly (typeof BOOKING_SERVICE_STATUSES)[number][]> = {
  PLANNED: ["REQUESTED", "CANCELLED"],
  REQUESTED: ["CONFIRMED", "FAILED", "CANCELLED"],
  CONFIRMED: ["AMENDED", "CANCELLED"],
  AMENDED: ["CONFIRMED", "CANCELLED"],
  CANCELLED: [],
  FAILED: ["REQUESTED", "CANCELLED"],
};

export const DOCUMENT_TRANSITIONS: Record<(typeof DOCUMENT_LIFECYCLE)[number], readonly (typeof DOCUMENT_LIFECYCLE)[number][]> = {
  DRAFT: ["REVIEW", "ARCHIVED"],
  REVIEW: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["ACTIVE", "ARCHIVED"],
  ACTIVE: ["REVIEW_DUE", "SUPERSEDED", "ARCHIVED"],
  REVIEW_DUE: ["ACTIVE", "SUPERSEDED", "ARCHIVED"],
  SUPERSEDED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const CONTENT_TRANSITIONS: Record<(typeof CONTENT_STATUSES)[number], readonly (typeof CONTENT_STATUSES)[number][]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "ARCHIVED"],
  PENDING_APPROVAL: ["APPROVED", "REJECTED", "ARCHIVED"],
  APPROVED: ["SCHEDULED", "PUBLISHED", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "FAILED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED"],
  REJECTED: ["DRAFT", "ARCHIVED"],
  FAILED: ["SCHEDULED", "ARCHIVED"],
  ARCHIVED: [],
};

export const CAMPAIGN_TRANSITIONS: Record<(typeof CAMPAIGN_STATUSES)[number], readonly (typeof CAMPAIGN_STATUSES)[number][]> = {
  DRAFT: ["PENDING_APPROVAL", "APPROVED", "ARCHIVED"],
  PENDING_APPROVAL: ["APPROVED", "DRAFT", "ARCHIVED"],
  APPROVED: ["RUNNING", "ARCHIVED"],
  RUNNING: ["PAUSED", "COMPLETED", "ARCHIVED"],
  PAUSED: ["RUNNING", "COMPLETED", "ARCHIVED"],
  COMPLETED: ["ARCHIVED"],
  ARCHIVED: [],
};

export const TASK_TRANSITIONS: Record<(typeof TASK_STATUSES)[number], readonly (typeof TASK_STATUSES)[number][]> = {
  QUEUED: ["RUNNING", "CANCELLING", "CANCELLED"],
  RUNNING: ["WAITING_APPROVAL", "WAITING_SUBTASKS", "COMPLETED", "FAILED", "CANCELLING", "BUDGET_EXCEEDED"],
  WAITING_APPROVAL: ["RUNNING", "COMPLETED", "CANCELLING", "CANCELLED"],
  WAITING_SUBTASKS: ["RUNNING", "COMPLETED", "CANCELLING", "CANCELLED"],
  COMPLETED: [],
  FAILED: ["QUEUED"],
  CANCELLING: ["CANCELLED"],
  CANCELLED: ["QUEUED"],
  BUDGET_EXCEEDED: ["QUEUED"],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type TrustLevel = (typeof TRUST_LEVELS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export type SourceKind = (typeof SOURCE_KINDS)[number];
export type Freshness = (typeof FRESHNESS)[number];
export type Classification = (typeof CLASSIFICATIONS)[number];
export type ActorType = (typeof ACTOR_TYPES)[number];
export type AgentSlug = (typeof AGENT_SLUGS)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type LeadStage = (typeof LEAD_STAGES)[number];
export type LostReasonType = (typeof LOST_REASONS)[number];
export type ProductLifecycle = (typeof PRODUCT_LIFECYCLE)[number];
export type RateTrust = (typeof RATE_TRUSTS)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type ToolKind = (typeof TOOL_KINDS)[number];
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
export type AuditEvent = (typeof AUDIT_EVENTS)[number];
export type SeverityClass = (typeof SEVERITY_CLASSES)[number];
export type AccessAction = (typeof ACCESS_ACTIONS)[number];
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLE)[number];
export type RequestOrigin = (typeof REQUEST_ORIGINS)[number];
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type Domain = (typeof DOMAINS)[number];

/** Runtime membership check used by the validation layer. */
export function isOneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
