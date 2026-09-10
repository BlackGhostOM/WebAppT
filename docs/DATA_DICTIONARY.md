# قاموس البيانات — Data Dictionary (المخطط 1.1)

المصدر التنفيذي: `convex/schema.ts` (المخطط)، `convex/lib/vocab.ts` (القيم المسموحة)، `lib/entities.ts` (النماذج/قواعد الإدخال اليدوي).
الحساسية: PUBLIC · INTERNAL · CONFIDENTIAL · CUSTOMER_CONFIDENTIAL · STRICTLY_CONFIDENTIAL. الخطورة D1–D4 وفق `convex/lib/audit.ts`.

## 0. الحقول المشتركة (`baseFields` — تُضاف لكل جدول رئيسي)
| الحقل | الاسم العربي | التعريف | النوع | القيم | إلزامي | المصدر | المالك | الحساسية | التحقق |
|---|---|---|---|---|---|---|---|---|---|
| businessId | المعرّف التجاري | معرّف مقروء دائم من `counters` (CUS-000001, SUP-000145, HOT-000078, PRD-OMN-0051, BKG-2026-001843, RAT-000912…) | string | بادئة-تسلسل | ✓ | النظام | executive | INTERNAL | يُولَّد فقط عبر `nextBusinessId` |
| trustLevel | مستوى الثقة | مصدر الحقيقة وموثوقيته | enum | A_COMPANY_VERIFIED…E_AI_ESTIMATE | ✓ | النظام حسب الفاعل | مالك النطاق | INTERNAL | بشري=A، وكيل=E، مستورد=D |
| verificationStatus | حالة التحقق | كيف تُحقق من السجل | enum | HUMAN_VERIFIED, AUTO_VERIFIED, AI_EXTRACTED, MIGRATED_UNVERIFIED, UNVERIFIED | ✓ | النظام | مالك النطاق | INTERNAL | — |
| verifiedBy / verifiedAt / evidenceRef | من تحقق / متى / الدليل | تفاصيل التحقق | actor / timestamp / string | — | عند التحقق | النظام | مالك النطاق | INTERNAL | — |
| source | المصدر | `{kind, ref?, url?, retrievedAt?}` | object | kind ∈ db/web/api/document/human/ai | ✓ | النظام | مالك النطاق | INTERNAL | web يحتاج url+retrievedAt |
| classification | التصنيف | حساسية السجل | enum | 5 مستويات | ✓ | افتراضي الكيان | executive | — | — |
| dataOwnerAgent | الوكيل المالك | مالك النطاق الحالي | enum | executive/product/sales/support | ✓ | تعريف الكيان | executive | INTERNAL | — |
| legalEntity / country / branch | الكيان القانوني / الدولة / الفرع | جاهزية التوسع | string | country ISO-2 (افتراضي OM) | ✓/✓/✗ | إعدادات الشركة | executive | INTERNAL | — |
| createdBy / updatedBy | أنشأه / حدّثه | الفاعل `{type,id,taskId?}` | actor | type ∈ owner/agent/system | ✓ | النظام | — | INTERNAL | — |
| createdAt / updatedAt / archivedAt | أُنشئ / حُدِّث / أُرشف | طوابع زمنية UTC | number | — | ✓/✓/✗ | النظام | — | INTERNAL | حذف ناعم فقط |
| dataQualityScore | درجة جودة البيانات | 0–100 (60% اكتمال + 40% تحقق) | number | 0–100 | للسجلات الحرجة | النظام | executive | INTERNAL | محسوبة |
| notes | ملاحظات | نص حر | string | ≤2000 | ✗ | بشري/وكيل | — | حسب الجدول | D1 |

### حقول الصلاحية الزمنية (`validityFields`)
| validFrom / validTo | ساري من/حتى | نافذة الصلاحية | number | — | حسب الجدول | بشري | مالك النطاق | INTERNAL | validTo ≥ validFrom |
|---|---|---|---|---|---|---|---|---|---|
| lastVerifiedAt | آخر تحقق | آخر إعادة تحقق | number | — | ✗ | النظام | — | INTERNAL | — |
| freshness | الحداثة | CURRENT/EXPIRING(≤30ي)/EXPIRED/REQUIRES_VERIFICATION | enum | 4 قيم | ✓ | cron يومي + على القراءة | executive | INTERNAL | محسوبة `computeFreshness` |

### حقول الإصدار (`versionFields`)
| version | الإصدار | `1.0` → `1.1` (مكوّن) → `2.0` (جوهري) | string | `\d+\.\d+` | ✓ | النظام | — | INTERNAL | لا يُحذف القديم |
|---|---|---|---|---|---|---|---|---|---|
| supersededBy / supersedes | استُبدل بـ / يستبدل | businessId للإصدار الأحدث/الأقدم | string | — | ✗ | النظام | — | INTERNAL | — |

### النقد (`money`)
`{ amount, currency, baseAmount, baseCurrency: "OMR", exchangeRate?, rateSource?, rateTimestamp? }` — التحويل بسعر مرجعي من `refCurrencies`؛ عملة بلا سعر مرجعي تُرفض.

---

## 1. Customer — `customers` (المالك: support → 04) · CUSTOMER_CONFIDENTIAL
| الحقل | الاسم العربي | التعريف | النوع | القيم | إلزامي | المصدر | الحساسية | التحقق |
|---|---|---|---|---|---|---|---|---|
| fullName / normalizedName | الاسم الكامل / المطبَّع | اسم العميل وصيغته للتكرار | string | 2–120 | ✓ | بشري/وكيل الدعم | CUSTOMER_CONFIDENTIAL | تطبيع عربي (أ/إ/آ→ا، ة→ه، ى→ي) |
| customerType | نوع العميل | تصنيف | enum | INDIVIDUAL…VIP | ✓ | بشري | INTERNAL | vocab |
| phone / normalizedPhone | الهاتف / المطبَّع | E.164 تقريبي (968 افتراضياً) | string | ≥7 أرقام | ✗ | بشري | CUSTOMER_CONFIDENTIAL | فحص تكرار |
| email / normalizedEmail | البريد | — | string | صيغة بريد | ✗ | بشري | CUSTOMER_CONFIDENTIAL | فحص تكرار |
| preferredLanguage / preferredChannel | اللغة / القناة المفضلة | — | enum | ar/en · CHANNELS | ✓/✗ | بشري | INTERNAL | vocab |
| city | المدينة | — | string | ≤80 | ✗ | بشري | INTERNAL | — |
| nationality / idDocumentRef | الجنسية / مرجع الهوية | فقط عند حاجة تشغيلية | string | ≤60 | ✗ | بشري | **STRICTLY_CONFIDENTIAL** (مخفية عن كل الوكلاء) | D2 |
| consentStatus / consentUpdatedAt | الموافقة على التواصل | لا مراسلة دون GRANTED | enum / number | GRANTED, NOT_GRANTED, WITHDRAWN, PENDING | ✓ | بشري | INTERNAL | تُفحص قبل send_customer_message |
| tags | وسوم | — | string[] | — | ✗ | بشري | INTERNAL | D1 |
| status | الحالة | — | enum | RECORD_STATUSES | ✓ | بشري | INTERNAL | vocab |

### `customerPreferences`
| customerId | العميل | مرجع | id | — | ✓ | — | CUSTOMER_CONFIDENTIAL | مرجع صالح |
|---|---|---|---|---|---|---|---|---|
| key / value | المفتاح / القيمة | تفضيل | string | — | ✓ | بشري/وكيل | CUSTOMER_CONFIDENTIAL | — |
| origin | الأصل | STATED (قاله العميل) أو INFERRED (استنتاج لا يُعامل كحقيقة) | enum | STATED, INFERRED | ✓ | — | INTERNAL | vocab |
| confidence | الثقة | 0–1 للمستنتج | number | 0–1 | ✗ | وكيل | INTERNAL | — |
| source, createdBy, createdAt, updatedAt, archivedAt | — | — | — | — | ✓ | النظام | INTERNAL | — |

`customerConsents` (P2+): customerId, purpose, status, grantedAt, withdrawnAt, channel, evidenceRef.

## 2. Sales & CRM — `leads` (sales → 03) · CUSTOMER_CONFIDENTIAL
| الحقل | الاسم العربي | التعريف | النوع | القيم | إلزامي | الحساسية | التحقق |
|---|---|---|---|---|---|---|---|
| customerId | سجل العميل | مرجع اختياري | id | — | ✗ | — | مرجع |
| contactName / contactPhone / contactEmail | بيانات الاتصال | — | string | — | ✓/✗/✗ | CUSTOMER_CONFIDENTIAL (مخفية عن product) | صيغة |
| channel | المصدر | قناة الوصول | enum | CHANNELS | ✓ | INTERNAL | vocab |
| stage | المرحلة | خط المبيعات | enum | LEAD_STAGES | ✓ | INTERNAL | تسلسل `LEAD_TRANSITIONS` |
| lostReason | سبب الخسارة | إلزامي عند LOST | enum | LOST_REASONS | عند LOST | INTERNAL | vocab |
| interestedProductId | المنتج المهتم به | مرجع | id | — | ✗ | INTERNAL | مرجع |
| expectedValue | القيمة المتوقعة | نقد | money | — | ✗ | CONFIDENTIAL | OMR أساس |
| travelDateFrom/To, paxAdults, paxChildren | تواريخ السفر والأفراد | — | number | ≥0 | ✗ | INTERNAL | — |
| lastContactAt / nextFollowUpAt | آخر تواصل / المتابعة القادمة | — | number | — | ✗ | INTERNAL | — |
| summary | ملخص الطلب | — | string | ≤2000 | ✗ | CUSTOMER_CONFIDENTIAL | — |

### `quotes` (مُصدَّرة)
| leadId / customerId / productId / productVersion | مراجع + إصدار المنتج الذي بُني عليه العرض | id/string | — | ✓/✗/✗/✗ | CUSTOMER_CONFIDENTIAL | المنتج ACTIVE فقط |
|---|---|---|---|---|---|---|
| status | الحالة | enum | QUOTE_STATUSES | ✓ | INTERNAL | vocab |
| lines[] | بنود العرض `{componentType, description, quantity, rateId?, rateTrust?, pricing}` | array | — | ✓ | CONFIDENTIAL (مخفية عن sales/support) | — |
| totals | التسعير الخمسي الإجمالي | pricing | — | ✓ | supplierCost/internalCost CONFIDENTIAL | الهامش محسوب |
| priceWarnings[] | تحذيرات (ESTIMATED/EXPIRED/دون الحد الأدنى) | string[] | — | ✓ | INTERNAL | تُعرض للمالك قبل الإرسال |
| validUntil / sentAt / approvalId / citations | — | — | — | ✗ | INTERNAL | — |

### `interactions` (الصندوق الموحد)
| customerId / leadId | مراجع | id | ✗ | CUSTOMER_CONFIDENTIAL |
|---|---|---|---|---|
| channel / direction / kind / status | القناة/الاتجاه/التصنيف/الحالة | enum | ✓/✓/✗/✓ | vocab |
| externalId / externalSenderId | معرّفات القناة الخارجية | string | ✗ | فهرس by_externalId |
| subject / body / language | المحتوى | string | ✗/✓/✗ | body بيانات غير موثوقة (لا تُنفَّذ تعليماتها) |
| aiClassification `{kind, confidence, model, escalated, escalationReason}` | تصنيف آلي | object | ✗ | confidence<0.7 → تصعيد |
| proposedReply / approvalId / taskId | الرد المقترح ومرجع الاعتماد | string/id | ✗ | لا يُرسل قبل الاعتماد |
| receivedAt / sentAt / createdBy / createdAt / updatedAt | — | number | ✓ | — |

`followUps` (P2+): leadId, customerId, dueAt, kind, message, status, approvalId, sentAt.

## 3. Tourism Product — `products` (product → 02) · INTERNAL
| الحقل | الاسم العربي | التعريف | النوع | القيم | إلزامي | الحساسية | التحقق |
|---|---|---|---|---|---|---|---|
| productFamilyId | عائلة المنتج | businessId للإصدار الأول | string | — | ✓ | INTERNAL | — |
| name / nameEn / productType | الاسم / النوع | — | string/enum | PRODUCT_TYPES | ✓/✗/✓ | INTERNAL | vocab |
| status | دورة الحياة | — | enum | PRODUCT_LIFECYCLE | ✓ | INTERNAL | `PRODUCT_TRANSITIONS`؛ ACTIVE = D3 |
| destinationIds[] | الوجهات | مراجع | id[] | — | ✓ | PUBLIC | مراجع |
| durationDays / durationNights | المدة | — | integer | 1–60 / 0–60 | ✓ | PUBLIC | — |
| summary / highlights[] / inclusions[] / exclusions[] / terms | المحتوى | — | string | — | ✓/✗ | PUBLIC | — |
| pricing | التسعير الخمسي للفرد `{supplierCost, internalCost, minSellingPrice, recommendedSellingPrice, customerSellingPrice}` | object(money) | — | ✗ | supplierCost/internalCost CONFIDENTIAL؛ min/recommended مخفية عن support | الهامش يُحسب لا يُدخل |
| targetMarginPercent | الهامش المستهدف | — | number | 0–100 | ✗ | CONFIDENTIAL | — |
| minPax / maxPax / seasons[] | الحدود والمواسم | — | integer/enum | SEASONS | ✗ | PUBLIC | — |
| approvalId / approvedBy / approvedAt | الاعتماد | — | — | — | عند ACTIVE | INTERNAL | مالك فقط |
| citations[] | بُني على | مصادر التصميم | citation[] | — | ✓ | INTERNAL | — |
| + validity + version | — | — | — | — | — | — | — |

### `productComponents`
| productId / componentType / dayNumber / order / description | المكوّن | id/enum/int/int/string | ✓/✓/✗/✓/✓ | INTERNAL | vocab |
|---|---|---|---|---|---|
| supplierId / hotelId / experienceId / attractionId / rateId | مراجع | id | ✗ | INTERNAL | مراجع صالحة |
| rateTrust | ثقة السعر المرتبط | enum | ✗ | INTERNAL | ESTIMATED → شارة صفراء وتحذير في العرض |
| quantity / unit | الكمية / الوحدة | number/enum(RATE_BASES) | ✓ | INTERNAL | — |
| pricing | التسعير الخمسي | object | ✓ | التكلفة CONFIDENTIAL | — |
| source / trustLevel / createdBy / updatedBy / createdAt / updatedAt / archivedAt | — | — | ✓ | — | — |

### `itineraries`
productId, dayNumber, title, description, destinationId?, attractionIds[], meals{breakfast,lunch,dinner}, overnightHotelId?, overnightDestinationId?, + actor/timestamps.

## 4. Destination & Experience (product → 02) · PUBLIC
- `destinations`: name, nameEn, normalizedName, kind (DESTINATION_KINDS), governorate?, description?, bestSeasons[] (SEASONS), coordinates?{lat,lng}, imageAssetId?, status.
- `attractions`: destinationId (✓), name, nameEn?, normalizedName, category?, description?, visitDurationMinutes? (0–1440), entryFee? (money), openingHours?, status.
- `experiences`: destinationId?, supplierId?, name, nameEn?, normalizedName, description?, durationHours? (0–240), difficulty? (DIFFICULTY_LEVELS), minPax?, maxPax?, seasons[], status.
- `routes` (P2+): name, destinationIds[], legs[]{from,to,distanceKm,durationMinutes,roadType}, status.

## 5. Supplier & Contract (product مؤقتاً → 08) · CONFIDENTIAL
### `suppliers`
| name / nameEn / normalizedName | الاسم | string | ✓/✗/✓ | INTERNAL | تكرار بالاسم/الهاتف/البريد |
|---|---|---|---|---|---|
| supplierType / status | النوع / الحالة | enum | ✓ | INTERNAL | SUPPLIER_TYPES / SUPPLIER_STATUSES |
| contactName / phone / email / website / city | الاتصال | string | ✗ | CONFIDENTIAL | صيغة |
| paymentTerms | شروط الدفع | string | ✗ | CONFIDENTIAL | — |
| bankAccountRef | مرجع الحساب البنكي (آخر 4 أرقام) | string ≤40 | ✗ | **STRICTLY_CONFIDENTIAL** (مخفي عن الوكلاء) | **D4** — اعتماد المالك |
| performance `{verifiedScore?, operationalNotes?, aiAssessment?, aiAssessmentAt?}` | الأداء | object | ✗ | INTERNAL | فصل المتحقق عن الملاحظة عن تقييم الذكاء الاصطناعي |
| tags[] | — | string[] | ✗ | INTERNAL | D1 |

### `hotels`
supplierId?, destinationId (✓), name, nameEn?, normalizedName, category (HOTEL_CATEGORIES), address?, roomTypes[]{code,name,maxOccupancy}, amenities[], childPolicy? (فجوة بيانات إن غاب), checkInTime?, checkOutTime?, phone?, email?, website?, status.

### `contracts` (الحقول الأساسية الآن؛ التشغيل P2)
supplierId (✓), title, status (CONTRACT_STATUSES), documentId?, currency, paymentTerms?, cancellationTerms?, + validity + version. كل تغيير D3.

`vehicles`/`guides` (P2+) موثقة في المخطط.

## 6. Rates & Commercial (product → 08/09) · CONFIDENTIAL
### `rates`
| الحقل | الاسم العربي | التعريف | النوع | القيم | إلزامي | التحقق |
|---|---|---|---|---|---|---|
| supplierId | المورد | مرجع | id | — | ✓ | مرجع |
| hotelId / experienceId | الفندق / التجربة | مراجع | id | — | ✗ | مرجع |
| serviceType | رمز الخدمة | من `refServiceTypes` | string | HOTEL_ROOM, VEHICLE_4X4… | ✓ | — |
| serviceDescription / componentType / roomType / occupancy | وصف/نوع/غرفة/إشغال | — | string/enum | COMPONENT_TYPES | ✓/✓/✗/✗ | vocab |
| rateBasis | أساس السعر | — | enum | RATE_BASES | ✓ | vocab |
| amount | المبلغ | نقد مع OMR أساس | money | — | ✓ | ≥0، عملة بسعر مرجعي |
| season | الموسم | — | enum | SEASONS | ✓ | vocab |
| validFrom / validTo | الصلاحية | — | number | — | ✓ (يدوي) | freshness |
| blackoutDates[] | تواريخ الحظر | `{from,to}` | array | — | ✓ (قد تكون فارغة) | — |
| taxesAndFees `{included, percent?, fixed?, notes?}` | الضرائب والرسوم | — | object | — | ✓ | — |
| cancellationTerms / cancellationTypeCode | شروط الإلغاء | — | string | — | ✓ | `REQUIRES_VERIFICATION` للاسترشادي |
| rateTrust | ثقة السعر | — | enum | CONTRACTED, SUPPLIER_CONFIRMED, LIVE_API, HISTORICAL, ESTIMATED | ✓ | البحث ⇒ ESTIMATED دائماً؛ تغيير المبلغ/الثقة D3 |
| status | الحالة | — | enum | RATE_STATUSES | ✓ | vocab |
| contractId / sourceDocumentId | مراجع العقد/المستند | id | — | ✗ | — |
| minPax / maxPax | — | integer | — | ✗ | — |

### `pricingRules`
kind (PRICING_RULE_KINDS), name, value, unit (PERCENT/OMR), appliesTo{productType?, componentType?, destinationId?}, priority (0–100), status, decisionId?, + validity. تغيير القيمة D3.

## 7. Booking & Operations (support مؤقتاً → 07) · CUSTOMER_CONFIDENTIAL
### `bookings`
customerId (✓), leadId?, quoteId?, productId?, productVersion?, status (BOOKING_STATUSES; CONFIRMED يتطلب تأكيد كل الخدمات — D3), paymentStatus (PAYMENT_STATUSES), travelDateFrom/To (✓), timezone (Asia/Muscat), paxAdults (1–200), paxChildren (0–200), totalSellingPrice (money ✓), totalSupplierCost? (money, CONFIDENTIAL — مخفي عن sales/support), specialRequests?, confirmedAt?, cancelledAt?, cancellationReason?. تكرار: نفس العميل ونفس تاريخ السفر.

### `bookingServices`
bookingId, componentType, supplierId?, hotelId?, description, serviceDateFrom (✓), serviceDateTo?, quantity, status (BOOKING_SERVICE_TRANSITIONS؛ CONFIRMED فقط عبر دليل — **D4**), rateId?, rateTrust?, pricing (التكلفة مخفية عن support), confirmationEvidenceId?, supplierReference?, + actor/timestamps.

### `confirmationEvidence` (**D4**)
bookingServiceId (✓), supplierId?, supplierReference (✓), confirmedAt (✓), confirmedPrice (money ✓), cancellationTerms (✓), evidenceKind (EVIDENCE_KINDS), fileStorageId? أو messageText? (أحدهما إلزامي), verifiedBy (actor ✓), verifiedAt, createdAt.

`trips`, `tripReadiness`, `incidents` (P2+).

## 8–10. Finance / Quality / Legal — كلها P2+ (موثقة في المخطط)
invoices, payments, refunds, profitability · qaReviews, riskRegister, complianceRecords · legalKnowledge, regulatoryChanges, legalHolds.

## 11. Corporate, HR & Admin (executive → 13) · INTERNAL
- `policies`: policyFamilyId, title, category (POLICY_CATEGORIES), summary, body (markdown ≤20000), documentId?, lifecycle (DOCUMENT_LIFECYCLE؛ ACTIVE = D3 ومالك فقط), appliesToAgents[], approvedBy?, approvedAt?, + validity + version.
- `sops`: title, domain (DOMAINS), steps[]{order,text}, body?, lifecycle, documentId?, appliesToAgents[], + version.
- `decisionRegister` (**D3**): kind (DECISION_KINDS), title, description, scope{table?, recordId?, agentSlug?, domain?}, effectiveFrom (✓), effectiveTo?, reason (✓), status (ACTIVE/EXPIRED/REVOKED — cron يُنهي المنتهي), decidedBy (actor), decidedAt, relatedApprovalId?, relatedTaskId?.
- `humanStaff` (P2+).

## 12. Digital, Tech & Analytics (executive → 12/14)
| الجدول | الحقول الأساسية | الحساسية / ملاحظات |
|---|---|---|
| `agents` | slug, name, nameEn, description, systemPrompt, promptVersion, allowedTools[], defaultModel, escalationModel?, monthlyBudgetUsd, maxStepsPerTask (1–30), enabled, createdAt, updatedAt, updatedBy | INTERNAL؛ تغيير التعليمات/النموذج/الميزانية D3 (مالك) |
| `tasks` | businessId, title, request, origin, requestedBy, agentSlug, parentTaskId?, rootTaskId?, conversationId?, status, priority, cancelRequested, cancelReason?, cancelledBy?, dueAt?, startedAt?, finishedAt?, result?, partialResult?, error?, stepCount, costUsd, inputTokens, outputTokens, model?, contextRefs{customerIds[],leadIds[],productIds[],bookingIds[]}, citations[], feedback[], resumedFromTaskId?, schedulerJobId?, premiumRequested?, transcript? | INTERNAL؛ `contextRefs` تحدد نطاق وكيل الدعم (Row-Level) |
| `taskRuns` | taskId, stepIndex, kind, model?, toolName?, toolKind?, input?, output?, inputTokens?, outputTokens?, cacheReadTokens?, cacheWriteTokens?, costUsd?, durationMs?, approvalId?, subtaskId?, note?, createdAt | INTERNAL؛ سجل خطوة بخطوة |
| `approvals` | businessId, kind, status, taskId?, agentSlug, title, summary, payload, editedPayload?, toolName?, targetTable?, targetRecordId?, severity, requestedAt, decidedAt?, decidedBy?, decisionReason? (إلزامي عند الرفض), executedAt?, executionResult?, executionError?, expiresAt? | INTERNAL؛ كل إجراء خارجي وكل D3/D4 |
| `auditLog` | actor, table, recordId?, businessId?, event, oldValue?, newValue?, reason?, taskId?, approvalId?, severity, at | **إلحاقي فقط** — لا update/delete |
| `usageLog` | taskId?, agentSlug, model, provider, origin, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, webSearchRequests? (1.1: عدد عمليات البحث الخادمية، 0.01$ لكل عملية), costUsd, batch, escalated, escalationReason?, monthKey, at | INTERNAL |
| `toolRegistry` | name, kind (read/write_internal/external), description, inputSchema (JSON Schema), allowedAgents[], resource?, action?, severity, requiresApproval, enabled | INTERNAL |
| `dataAccessMatrix` | agentSlug, resource, actions[], condition? (customer_in_task_context / not_strictly_confidential / estimated_only / active_only), fieldDenyList[], scope?, validTo?, grantedBy, grantedAt | **D4**؛ صفوف المالك لا يمسها bootstrap |
| `dataConflicts` | businessId, table, recordId?, field, candidates[]{value, source, trustLevel, observedAt, contractual?, specificity?, verified?}, status, resolutionRule?, resolvedValue?, resolvedBy?, resolvedAt?, taskId?, createdBy, createdAt | INTERNAL؛ ترتيب الحسم ثابت |
| `dataGaps` | businessId, table, field, description, affectedCount, totalCount, percent, severity, status, createdAt, updatedAt, resolvedAt? | INTERNAL؛ cron يومي |
| `knowledgeGaps` | businessId, question, normalizedQuestion, askedBy, occurrences, lastAskedAt, taskIds[], status, resolutionDocumentId?, createdAt | INTERNAL |
| `campaigns` | name, objective, platforms[], startDate?, endDate?, status, targetAudience?, budget?, productIds[], approvalId? + base | INTERNAL |
| `contentCalendar` | campaignId?, productId?, platform, scheduledAt{timestamp,timezone}, status, caption, captionEn?, hashtags[], visualIdea?, assetIds[], approvalId?, publishedAt?, externalPostId?, rejectionReason? + base | INTERNAL؛ النشر بعد الاعتماد فقط |
| `digitalAssets` | kind, title, storageId?, url?, mimeType?, sizeBytes?, tags[], usageRights?, status + base | INTERNAL |
| `workflowRegistry`, `integrationRegistry`, `kpiDefinitions` | P2+ | — |

## المعرفة والذاكرة
| الجدول | الحقول | ملاحظات |
|---|---|---|
| `documents` | documentFamilyId, title, documentType, domain, language, translationStatus, canonicalDocumentId?, relatedEntity?{table,recordId}, storageId?, mimeType?, sizeBytes?, originalFileName?, lifecycle, allowedAgents[], extractedTextStorageId?, textPreview? (≤4000), extractedCharCount?, extractionStatus (PENDING/EXTRACTED/FAILED/UNSUPPORTED), extractionError?, aiMetadata?{suggestedTitle?, suggestedType?, suggestedDomain?, summary?, keywords[], model, status: AI_EXTRACTED, generatedAt}, proposals[]{id, kind: RATE/TERM, data, status, decidedAt?, createdRecordId?}, chunkCount, indexedAt?, citationCount, approvedBy?, approvedAt?, reviewDueAt? + base + version + validity | الوكلاء يرون ACTIVE/REVIEW_DUE فقط وضمن allowedAgents؛ التفعيل D3 |
| `knowledgeChunks` | documentId, documentFamilyId, chunkIndex, section?, text, embedding (float64[1024]), embeddingModel, documentType, domain, country, language, version, validFrom?, validTo?, classification, lifecycle, allowedAgents[], relatedTable?, relatedRecordId?, createdAt | فهرس متجهي `by_embedding` + بحث نصي `search_text`؛ ليس مصدر الحقيقة |
| `memories` | businessId, type, origin, status, agentSlug, content (≤2000), subject?{table,recordId}, confidence?, expiresAt?, retentionPolicy, proposedBy, reviewedBy?, reviewedAt?, taskId?, createdAt | استنتاج الوكيل PROPOSED حتى يعتمده المالك |
| `dataQualityRules` | name, table, field?, dimension, description, weight, severity, enabled, createdAt | — |

## المنصة والمصادقة
- `users` (Convex Auth + role ∈ owner/staff, disabled, locale, lastLoginAt, createdByUserId) — تغيير الدور/التعطيل **D4**.
- `authSessions`, `authAccounts`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits` — جداول Convex Auth (كلمات المرور مُجزّأة Scrypt).
- `counters {key, value}`, `settings {key, value, updatedAt, updatedBy}` (تغيير D3), `notifications`, `conversations`, `chatMessages`.
- بيانات مرجعية: `refCountries {code, iso3, nameAr, nameEn, phonePrefix?, active}`, `refCurrencies {code, nameAr, nameEn, decimals, rateToBase, rateSource, rateUpdatedAt, active}`, `refLanguages {code, nameAr, nameEn, rtl}`, `refServiceTypes {code, nameAr, nameEn, componentType, defaultRateBasis}`, `refPaymentMethods {code, nameAr, nameEn, active}`, `refCancellationTypes {code, nameAr, nameEn, description}`.
