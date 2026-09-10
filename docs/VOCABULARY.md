# المفردات المعيارية — Controlled Vocabulary

المصدر الوحيد: `convex/lib/vocab.ts` (ثوابت `as const`) تُفرض في `convex/schema.ts` عبر `literals()` = `v.union(v.literal(...))`.
ممنوع الحالات النصية الحرة؛ لا يستطيع وكيل أو نموذج إنشاء قيمة من عنده. التعريب في `lib/i18n/index.tsx` (`VOCAB_AR`).

## عام (الحقول المشتركة)
| المفردة | القيم |
|---|---|
| `trustLevel` | A_COMPANY_VERIFIED · B_SUPPLIER_CONFIRMED · C_OFFICIAL_SOURCE · D_RELIABLE_EXTERNAL · E_AI_ESTIMATE |
| `verificationStatus` | HUMAN_VERIFIED · AUTO_VERIFIED · AI_EXTRACTED · MIGRATED_UNVERIFIED · UNVERIFIED |
| `source.kind` | db · web · api · document · human · ai |
| `freshness` | CURRENT · EXPIRING (≤30 يوماً) · EXPIRED · REQUIRES_VERIFICATION |
| `classification` | PUBLIC · INTERNAL · CONFIDENTIAL · CUSTOMER_CONFIDENTIAL · STRICTLY_CONFIDENTIAL |
| حالة السجل العامة `status` | DRAFT · ACTIVE · INACTIVE · ARCHIVED |
| `actor.type` | owner · agent · system |
| الوكلاء | executive · product · sales · support |
| أدوار المستخدمين | owner · staff |
| وسم النقص | UNKNOWN · NOT_PROVIDED · REQUIRES_VERIFICATION |

## النطاق 1 — العميل
| المفردة | القيم |
|---|---|
| `customerType` | INDIVIDUAL · FAMILY · GROUP · CORPORATE · GOVERNMENT · TRAVEL_PARTNER · VIP |
| `consentStatus` | GRANTED · NOT_GRANTED · WITHDRAWN · PENDING |
| `customerPreferences.origin` | STATED · INFERRED |
| `channel` | INSTAGRAM · WHATSAPP · WEBSITE · EMAIL · PHONE · SNAPCHAT · WALK_IN · REFERRAL · OTHER |

## النطاق 2 — المبيعات
| المفردة | القيم |
|---|---|
| `leads.stage` | NEW_LEAD → QUALIFIED → REQUIREMENTS_COLLECTED → PROPOSAL_PREPARED → QUOTE_SENT → NEGOTIATION → WON / LOST |
| `lostReason` (إلزامي عند LOST) | PRICE · PRODUCT_FIT · NO_RESPONSE · COMPETITOR · TIMING · AVAILABILITY · TRUST · SERVICE_REQUIREMENT |
| `quotes.status` | DRAFT · PENDING_APPROVAL · APPROVED · SENT · ACCEPTED · REJECTED · EXPIRED · SUPERSEDED |
| `interactions.direction` | INBOUND · OUTBOUND · INTERNAL_NOTE |
| `interactions.kind` | INQUIRY · BOOKING_REQUEST · COMPLAINT · FOLLOW_UP · FEEDBACK · OTHER |
| `interactions.status` | NEW · CLASSIFIED · REPLY_PROPOSED · REPLY_APPROVED · REPLIED · ESCALATED · CLOSED |

### تسلسل مراحل العميل المحتمل (`LEAD_TRANSITIONS`)
NEW_LEAD→{QUALIFIED,LOST} · QUALIFIED→{REQUIREMENTS_COLLECTED,LOST} · REQUIREMENTS_COLLECTED→{PROPOSAL_PREPARED,LOST} · PROPOSAL_PREPARED→{QUOTE_SENT,REQUIREMENTS_COLLECTED,LOST} · QUOTE_SENT→{NEGOTIATION,WON,LOST} · NEGOTIATION→{QUOTE_SENT,WON,LOST} · WON→{} · LOST→{NEW_LEAD}

## النطاق 3 — المنتج السياحي
| المفردة | القيم |
|---|---|
| `products.status` (دورة الحياة) | IDEA · CONCEPT · DESIGN · COSTING · QA · APPROVAL · READY_FOR_SALE · ACTIVE · REVIEW · SUSPENDED · EXPIRED · ARCHIVED |
| `productType` | PACKAGE · DAY_TOUR · MULTI_DAY_TOUR · TRANSFER · EXPERIENCE · CUSTOM |
| `componentType` | HOTEL · TRANSPORT · FLIGHT · VEHICLE_RENTAL · GUIDE · ACTIVITY · MEAL · TICKET · INSURANCE · OTHER |
| `version` | `1.0` → تغيير مكوّن `1.1` → تغيير جوهري `2.0` (يُعرض V1.0) |

### تسلسل دورة حياة المنتج (`PRODUCT_TRANSITIONS`)
IDEA→{CONCEPT,ARCHIVED} · CONCEPT→{DESIGN,ARCHIVED} · DESIGN→{COSTING,CONCEPT,ARCHIVED} · COSTING→{QA,DESIGN,ARCHIVED} · QA→{APPROVAL,COSTING,ARCHIVED} · APPROVAL→{READY_FOR_SALE,QA,ARCHIVED} · READY_FOR_SALE→{ACTIVE,REVIEW,ARCHIVED} · ACTIVE→{REVIEW,SUSPENDED,EXPIRED,ARCHIVED} · REVIEW→{ACTIVE,DESIGN,SUSPENDED,ARCHIVED} · SUSPENDED→{ACTIVE,REVIEW,ARCHIVED} · EXPIRED→{REVIEW,ARCHIVED} · ARCHIVED→{}
لا يُباع منتج إلا بحالة ACTIVE وإصدار معتمد (`approvedBy/approvedAt`).

## النطاق 4 — الوجهات
| المفردة | القيم |
|---|---|
| `destinations.kind` | CITY · REGION · NATURE · COAST · MOUNTAIN · DESERT · HERITAGE |
| `season` | ALL_YEAR · WINTER · SUMMER · KHAREEF · SHOULDER |
| `difficulty` | EASY · MODERATE · CHALLENGING |

## النطاق 5 — الموردون
| المفردة | القيم |
|---|---|
| `suppliers.status` | PROSPECT · UNDER_REVIEW · APPROVED · PREFERRED · CONDITIONAL · SUSPENDED · BLOCKED · INACTIVE · ARCHIVED |
| `supplierType` | HOTEL · TRANSPORT · CAR_RENTAL · AIRLINE · GUIDE · ACTIVITY_OPERATOR · RESTAURANT · DMC · OTHER |
| `hotels.category` | ONE_STAR … FIVE_STAR · BOUTIQUE · CAMP · APARTMENT · UNRATED |
| `contracts.status` | DRAFT · NEGOTIATION · SIGNED · ACTIVE · EXPIRED · TERMINATED |

## النطاق 6 — الأسعار
| المفردة | القيم |
|---|---|
| `rateBasis` | PER_PERSON · PER_ROOM · PER_NIGHT · PER_VEHICLE · PER_GROUP · PER_ACTIVITY · FIXED |
| `rateTrust` | CONTRACTED · SUPPLIER_CONFIRMED · LIVE_API · HISTORICAL · ESTIMATED (استرشادي — شارة صفراء) |
| `rates.status` | PROPOSED · ACTIVE · SUPERSEDED · EXPIRED · REJECTED · ARCHIVED |
| `pricingRules.kind` | TARGET_MARGIN · MIN_MARGIN · MARKUP · DISCOUNT_CAP · ROUNDING · CHILD_POLICY · SEASONAL_ADJUSTMENT |
قاعدة: كل ما يجمعه وكيل من البحث = ESTIMATED + E_AI_ESTIMATE + رابط + وقت رصد، ولا يدخل عرضاً للعميل دون تنبيه واعتماد.

## النطاق 7 — الحجوزات
| المفردة | القيم |
|---|---|
| `bookings.status` | INQUIRY · TENTATIVE · PENDING_CONFIRMATION · CONFIRMED · IN_PROGRESS · COMPLETED · CANCELLED · NO_SHOW |
| `bookingServices.status` | PLANNED → REQUESTED → CONFIRMED (يتطلب `confirmationEvidence`) → AMENDED · CANCELLED · FAILED |
| `paymentStatus` | UNPAID · DEPOSIT_PAID · PARTIALLY_PAID · PAID · REFUNDED · PARTIALLY_REFUNDED |
| `evidenceKind` | EMAIL · PDF · MESSAGE · API_RESPONSE · PHONE_CALL · PORTAL_SCREENSHOT · OTHER |

### تسلسل خدمة الحجز (`BOOKING_SERVICE_TRANSITIONS`)
PLANNED→{REQUESTED,CANCELLED} · REQUESTED→{CONFIRMED,FAILED,CANCELLED} · CONFIRMED→{AMENDED,CANCELLED} · AMENDED→{CONFIRMED,CANCELLED} · FAILED→{REQUESTED,CANCELLED} · CANCELLED→{}
لا يصبح الحجز CONFIRMED قبل تأكيد كل خدماته.

## النطاق 11 — الحوكمة
| المفردة | القيم |
|---|---|
| `policies.category` | PRICING · DISCOUNT · REFUND · CUSTOMER_SERVICE · AI_USAGE · DATA_PROTECTION · OPERATIONS · BRAND · OTHER |
| `lifecycle` (مستندات/سياسات/إجراءات) | DRAFT → REVIEW → APPROVED → ACTIVE → REVIEW_DUE → SUPERSEDED → ARCHIVED |
| `decisionRegister.kind` | POLICY_APPROVAL · TEMPORARY_EXCEPTION · LIMIT_INCREASE · AUTO_APPROVAL_RULE · SUPPLIER_DECISION · PRODUCT_DECISION · OTHER |
| `decisionRegister.status` | ACTIVE · EXPIRED · REVOKED |

### تسلسل المستند (`DOCUMENT_TRANSITIONS`)
DRAFT→{REVIEW,ARCHIVED} · REVIEW→{APPROVED,DRAFT,ARCHIVED} · APPROVED→{ACTIVE,ARCHIVED} · ACTIVE→{REVIEW_DUE,SUPERSEDED,ARCHIVED} · REVIEW_DUE→{ACTIVE,SUPERSEDED,ARCHIVED} · SUPERSEDED→{ARCHIVED} · ARCHIVED→{}

## النطاق 12 — التشغيل والوكلاء
| المفردة | القيم |
|---|---|
| `tasks.status` | QUEUED · RUNNING · WAITING_APPROVAL · WAITING_SUBTASKS · COMPLETED · FAILED · CANCELLING · CANCELLED · BUDGET_EXCEEDED |
| `tasks.priority` | LOW · NORMAL · HIGH · URGENT |
| `tasks.origin` | owner · customer · system · agent |
| `taskRuns.kind` | MODEL_CALL · TOOL_CALL · TOOL_RESULT · APPROVAL_REQUESTED · SUBTASK_CREATED · NOTE · CANCELLED · ERROR · FINAL |
| `toolRegistry.kind` | read · write_internal · external |
| `approvals.status` | PENDING · APPROVED · REJECTED · EDITED_APPROVED · CANCELLED · EXECUTED · EXECUTION_FAILED |
| `approvals.kind` | SEND_CUSTOMER_MESSAGE · SEND_QUOTE · PUBLISH_CONTENT · CONFIRM_BOOKING · SENSITIVE_CHANGE · RATE_PROPOSAL · MEMORY_PROMOTION · DATA_MERGE · OTHER |
| `auditLog.event` | CREATE · UPDATE · ARCHIVE · RESTORE · SENSITIVE_READ · EXPORT · LOGIN · LOGIN_FAILED · LOGOUT · APPROVAL · REJECTION · CANCEL · EMERGENCY_STOP · EMERGENCY_RESUME · SEED · SYSTEM |
| خطورة التغيير | D1 (منخفض) · D2 (متوسط) · D3 (حساس — اعتماد المالك للوكلاء) · D4 (حرج — اعتماد المالك دائماً) |
| `dataAccessMatrix.actions` | READ · CREATE · UPDATE · ARCHIVE · SENSITIVE_READ · EXPORT |
| `dataConflicts.status` / `resolutionRule` | OPEN · RESOLVED · ESCALATED / AUTHORITY → RECENCY → SPECIFICITY → CONTRACT_STATUS → VERIFICATION → OWNER_DECISION |
| `dataGaps`/`knowledgeGaps.status` | OPEN · IN_PROGRESS · RESOLVED · DISMISSED |
| `campaigns.status` | DRAFT · PENDING_APPROVAL · APPROVED · RUNNING · PAUSED · COMPLETED · ARCHIVED |
| `contentCalendar.platform` | INSTAGRAM · SNAPCHAT · WEBSITE · WHATSAPP_STATUS |
| `contentCalendar.status` | DRAFT · PENDING_APPROVAL · APPROVED · SCHEDULED · PUBLISHED · REJECTED · FAILED · ARCHIVED |

### تسلسل المهمة (`TASK_TRANSITIONS`)
QUEUED→{RUNNING,CANCELLING,CANCELLED} · RUNNING→{WAITING_APPROVAL,WAITING_SUBTASKS,COMPLETED,FAILED,CANCELLING,BUDGET_EXCEEDED} · WAITING_*→{RUNNING,COMPLETED,CANCELLING,CANCELLED} · CANCELLING→{CANCELLED} · FAILED/CANCELLED/BUDGET_EXCEEDED→{QUEUED} (إعادة محاولة)

## المعرفة والذاكرة
| المفردة | القيم |
|---|---|
| `documentType` | SUPPLIER_CONTRACT · PRICE_LIST · DESTINATION_GUIDE · POLICY · SOP · CUSTOMER_TERMS · BRAND_GUIDE · AGENT_INSTRUCTIONS · PRODUCT_RULES · OTHER |
| `domain` | CUSTOMER · SALES_CRM · TOURISM_PRODUCT · DESTINATION_EXPERIENCE · SUPPLIER_CONTRACT · RATES_COMMERCIAL · BOOKING_OPERATIONS · FINANCE · QUALITY_RISK_COMPLIANCE · LEGAL_REGULATORY · CORPORATE_HR_ADMIN · DIGITAL_TECH_ANALYTICS |
| `language` / `translationStatus` | ar · en / CANONICAL · TRANSLATED · MACHINE_TRANSLATED · PENDING |
| `memories.type` | SESSION · WORKFLOW · CUSTOMER · SUPPLIER · COMPANY_DECISION |
| `memories.origin` | STATED · INFERRED · AI_ASSESSMENT · HUMAN_VERIFIED |
| `memories.status` | PROPOSED · APPROVED · REJECTED · EXPIRED |
| `retentionPolicy` | SESSION_ONLY · DAYS_30 · DAYS_90 · DAYS_365 · UNTIL_REVOKED |
| أبعاد جودة البيانات | ACCURACY · COMPLETENESS · CONSISTENCY · FRESHNESS · VALIDITY · UNIQUENESS · TRACEABILITY |

## توجيه النماذج
| المفردة | القيم |
|---|---|
| `requestOrigin` | customer · owner · executive |
| `llmProvider` | anthropic · openai_compatible · mock |
