/**
 * Tool registry (section 5). Every tool has a JSON schema and a kind:
 *   read           — safe, executed immediately
 *   write_internal — writes to the database inside one transaction, audited
 *   external       — talks to the outside world: creates an approval, never runs directly
 * Tools are executed inside a single mutation (`runtime.executeTool`) so a
 * cancellation can never leave a half-written record.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { agentActor, type Actor } from "../lib/actor";
import { appError, errorMessage, isAppError } from "../lib/errors";
import type { JsonSchema } from "../lib/llm/types";
import * as V from "../lib/vocab";
import { createApproval } from "../services/approvals";
import {
  activateProduct,
  addProductComponent,
  archiveProductComponent,
  changeLeadStage,
  createQuoteDraft,
  createResearchRate,
  productCosting,
  upsertItineraryDay,
} from "../services/commercial";
import { proposeMemory, recordConflict } from "../services/governance";
import { keywordSearch, recordCitations, recordKnowledgeGap } from "../services/knowledge";
import { createRecord, getRecord, listRecords, updateRecord } from "../services/records";
import { agentPerformance, bookingsReport, computeKpis, costReport, monthlySeries, pipelineReport, supportReport } from "../services/reports";
import { createCampaign, proposeFollowUp, scheduleContent } from "../services/sales";
import { proposeReply } from "../services/support";
import { createTask, listActiveTasks } from "../services/tasks";

export { computeKpis } from "../services/reports";

export interface ToolSpec {
  name: string;
  kind: V.ToolKind;
  description: string;
  inputSchema: JsonSchema;
  allowedAgents: V.AgentSlug[];
  severity: V.SeverityClass;
  requiresApproval: boolean;
  approvalKind?: V.ApprovalKind;
}

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const int = (description: string) => ({ type: "integer", description });
const arr = (items: JsonSchema, description: string) => ({ type: "array", items, description });
const enumOf = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const money = (description: string) => obj({ amount: num(description), currency: str("رمز العملة مثل OMR أو USD") }, ["amount", "currency"]);

const ALL: V.AgentSlug[] = ["executive", "product", "sales", "support"];

export const TOOL_SPECS: ToolSpec[] = [
  // ------------------------------------------------------------------ read
  { name: "get_kpis", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales"], description: "مؤشرات هذا الشهر من قاعدة البيانات: استفسارات، عملاء محتملون حسب المرحلة، حجوزات، إيراد، تكلفة الوكلاء، ومعدلات التحويل.", inputSchema: obj({ monthKey: str("الشهر بصيغة YYYY-MM (اختياري، الافتراضي الشهر الحالي)") }) },
  { name: "search_customers", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales", "support"], description: "بحث في العملاء بالاسم أو الهاتف أو البريد أو المعرّف. يعيد بيانات مصرحاً بها فقط مع مستوى الثقة.", inputSchema: obj({ query: str("نص البحث"), limit: int("الحد الأقصى (افتراضي 10)") }) },
  { name: "search_leads", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales", "product"], description: "العملاء المحتملون مع المرحلة والقيمة المتوقعة والمتابعة القادمة.", inputSchema: obj({ query: str("نص البحث (اختياري)"), stage: enumOf(V.LEAD_STAGES, "المرحلة (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_products", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "المنتجات والباقات مع الإصدار والحالة والتسعير المصرح به والهامش (لمن يحق له) وعدد المكوّنات الاسترشادية.", inputSchema: obj({ query: str("نص البحث (اختياري)"), status: enumOf(V.PRODUCT_LIFECYCLE, "الحالة (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_bookings", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "support"], description: "الحجوزات وخدماتها وحالة كل خدمة ودليل التأكيد.", inputSchema: obj({ query: str("معرّف الحجز أو اسم العميل (اختياري)"), status: enumOf(V.BOOKING_STATUSES, "الحالة (اختياري)"), customerId: str("معرّف العميل (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_suppliers", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "product"], description: "الموردون وحالتهم ونوعهم.", inputSchema: obj({ query: str("نص البحث (اختياري)"), supplierType: enumOf(V.SUPPLIER_TYPES, "النوع (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_hotels", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "product", "sales", "support"], description: "الفنادق حسب الوجهة أو الاسم.", inputSchema: obj({ query: str("نص البحث (اختياري)"), destinationId: str("معرّف الوجهة (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_destinations", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "الوجهات السياحية وأفضل مواسمها.", inputSchema: obj({ query: str("نص البحث (اختياري)") }) },
  { name: "search_attractions", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["product", "sales", "support"], description: "المعالم حسب الوجهة.", inputSchema: obj({ query: str("نص البحث (اختياري)"), destinationId: str("معرّف الوجهة (اختياري)") }) },
  { name: "search_experiences", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["product", "sales", "support"], description: "التجارب والأنشطة ومشغّلوها.", inputSchema: obj({ query: str("نص البحث (اختياري)"), destinationId: str("معرّف الوجهة (اختياري)") }) },
  { name: "search_rates", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "product"], description: "أسعار الموردين مع مستوى ثقة السعر (CONTRACTED/SUPPLIER_CONFIRMED/ESTIMATED…) والحداثة والمصدر.", inputSchema: obj({ supplierId: str("معرّف المورد (اختياري)"), hotelId: str("معرّف الفندق (اختياري)"), componentType: enumOf(V.COMPONENT_TYPES, "نوع المكوّن (اختياري)"), query: str("نص البحث (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_pricing_rules", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "product", "sales"], description: "قواعد التسعير الفعّالة: الهامش المستهدف، الحد الأدنى، سقف الخصم…", inputSchema: obj({}) },
  { name: "search_policies", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "سياسات الشركة السارية (تسعير، خصومات، استرداد، خدمة عملاء…) مع الإصدار وتاريخ النفاذ.", inputSchema: obj({ query: str("نص البحث (اختياري)"), category: enumOf(V.POLICY_CATEGORIES, "الفئة (اختياري)") }) },
  { name: "search_decisions", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive"], description: "قرارات المالك السارية الآن (استثناءات، رفع حدود، اعتمادات).", inputSchema: obj({ query: str("نص البحث (اختياري)") }) },
  { name: "search_quotes", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales"], description: "العروض التجارية لعميل محتمل.", inputSchema: obj({ leadId: str("معرّف العميل المحتمل (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_campaigns", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales"], description: "الحملات التسويقية.", inputSchema: obj({ query: str("نص البحث (اختياري)") }) },
  { name: "search_content", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales"], description: "تقويم المحتوى: المنشورات المقترحة والمعتمدة والمنشورة.", inputSchema: obj({ status: enumOf(V.CONTENT_STATUSES, "الحالة (اختياري)") }) },
  { name: "search_interactions", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "support"], description: "رسائل العملاء في الصندوق الموحد.", inputSchema: obj({ customerId: str("معرّف العميل (اختياري)"), status: enumOf(V.INTERACTION_STATUSES, "الحالة (اختياري)"), limit: int("الحد الأقصى") }) },
  { name: "search_knowledge", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "بحث دلالي في المستندات المعتمدة فقط (سياسات، إجراءات، عقود، أدلة). يعيد مقاطع مُسنَدة بإصدار المستند.", inputSchema: obj({ query: str("السؤال"), asOf: str("تاريخ الحدث ISO لاختيار السياسة السارية حينه (اختياري)"), limit: int("الحد الأقصى") }, ["query"]) },
  { name: "get_report", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive", "sales", "support"], description: "تقارير محسوبة من قاعدة البيانات: monthly_series (6 أشهر: استفسارات/عملاء/عروض/حجوزات/إيراد/تكلفة)، support (خدمة العملاء: القنوات، التصنيفات، زمن الاستجابة، التصعيد، الرد التلقائي)، agent_performance (المهام والاعتمادات لكل وكيل)، cost (التكلفة اليومية والتوقع لنهاية الشهر)، bookings (الحجوزات حسب الحالة والمنتج والمغادرات القادمة).", inputSchema: obj({ kind: enumOf(["monthly_series", "support", "agent_performance", "cost", "bookings"], "نوع التقرير"), month: str("الشهر YYYY-MM (اختياري)"), days: int("عدد الأيام لتقرير خدمة العملاء (افتراضي 30)"), months: int("عدد الأشهر للسلسلة (افتراضي 6)") }, ["kind"]) },
  { name: "list_pending_approvals", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive"], description: "ما ينتظر اعتماد المالك حالياً.", inputSchema: obj({}) },
  { name: "list_tasks", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["executive"], description: "المهام الجارية والمنتظرة في النظام.", inputSchema: obj({}) },
  // -------------------------------------------------------- write_internal
  { name: "delegate_task", kind: "write_internal", severity: "D1", requiresApproval: false, allowedAgents: ["executive"], description: "يوكل مهمة فرعية إلى وكيل مختص (product/sales/support). تُنفَّذ بشكل مستقل وتعود نتائجها إليك عند اكتمالها.", inputSchema: obj({ agentSlug: enumOf(["product", "sales", "support"], "الوكيل المختص"), title: str("عنوان قصير"), request: str("الطلب التفصيلي مع السياق اللازم"), customerIds: arr(str("معرّف عميل"), "العملاء الذين تخص المهمة (لوكيل الدعم)"), leadIds: arr(str("معرّف عميل محتمل"), "العملاء المحتملون ذوو الصلة"), productIds: arr(str("معرّف منتج"), "المنتجات ذات الصلة"), bookingIds: arr(str("معرّف حجز"), "الحجوزات ذات الصلة") }, ["agentSlug", "title", "request"]) },
  { name: "request_owner_decision", kind: "write_internal", severity: "D3", requiresApproval: false, approvalKind: "OTHER", allowedAgents: ["executive"], description: "يضع قراراً في صندوق اعتماد المالك ويوقف المهمة حتى يرد. استخدمه للاستثناءات والمبالغ الكبيرة وأي قرار بشري.", inputSchema: obj({ title: str("عنوان القرار"), question: str("السؤال بصياغة تسمح بالقرار بنقرة"), options: arr(str("خيار"), "الخيارات المقترحة"), recommendation: str("توصيتك وسببها") }, ["title", "question"]) },
  { name: "web_search_note", kind: "write_internal", severity: "D1", requiresApproval: false, allowedAgents: ["product", "executive"], description: "يسجّل نتيجة بحث ويب كمصدر مُوثَّق (رابط، عنوان، مقتطف، وقت الرصد) على المهمة.", inputSchema: obj({ url: str("الرابط"), title: str("العنوان"), snippet: str("المقتطف ذو الصلة") }, ["url", "title"]) },
  // Reference data the product agent may draft from research (AI_EXTRACTED / E_AI_ESTIMATE; the owner verifies later).
  { name: "create_destination", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ وجهة سياحية غير موجودة (مدينة/منطقة/جبل/صحراء…) لتُربط بها الفنادق والمنتجات. ابحث أولاً بـsearch_destinations؛ إن وُجدت وجهة مشابهة تُعاد لك لتستخدمها.", inputSchema: obj({ name: str("الاسم بالعربية"), nameEn: str("الاسم بالإنجليزية"), kind: enumOf(V.DESTINATION_KINDS, "النوع"), governorate: str("المحافظة (اختياري)"), description: str("وصف قصير (اختياري)"), bestSeasons: arr(enumOf(V.SEASONS, "موسم"), "أفضل المواسم (اختياري)"), acknowledgeDuplicates: { type: "boolean", description: "true فقط إذا راجعت السجلات المشابهة وتأكدت أن هذه وجهة مختلفة" } }, ["name", "nameEn", "kind"]) },
  { name: "create_supplier_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ مورداً بحالة PROSPECT (فندق، شركة تأجير سيارات، مشغّل أنشطة…) اكتشفته في البحث، حتى تُربط به الأسعار الاسترشادية. يُوسم مستخرجاً آلياً ويعتمده المالك لاحقاً. ابحث أولاً بـsearch_suppliers.", inputSchema: obj({ name: str("اسم المورد"), nameEn: str("الاسم بالإنجليزية (اختياري)"), supplierType: enumOf(V.SUPPLIER_TYPES, "نوع المورد"), website: str("الموقع الإلكتروني أو رابط صفحة الحجز (اختياري)"), phone: str("الهاتف إن ظهر في المصدر (اختياري)"), email: str("البريد إن ظهر في المصدر (اختياري)"), city: str("المدينة (اختياري)"), notes: str("ملاحظات: من أين استُخرجت البيانات وما الذي يحتاج تأكيداً"), acknowledgeDuplicates: { type: "boolean", description: "true فقط إذا راجعت السجلات المشابهة وتأكدت أنه مورد مختلف" } }, ["name", "supplierType"]) },
  { name: "create_hotel_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ فندقاً بحالة DRAFT مرتبطاً بوجهة (ومورد إن وُجد) حتى تُسجَّل أسعار غرفه. ابحث أولاً بـsearch_hotels.", inputSchema: obj({ name: str("اسم الفندق"), nameEn: str("الاسم بالإنجليزية (اختياري)"), destinationId: str("معرّف الوجهة"), supplierId: str("معرّف المورد (اختياري؛ أنشئه بـcreate_supplier_draft إن لم يوجد)"), category: enumOf(V.HOTEL_CATEGORIES, "التصنيف"), address: str("العنوان (اختياري)"), website: str("الموقع أو رابط الحجز (اختياري)"), phone: str("الهاتف (اختياري)"), amenities: arr(str("مرفق"), "المرافق (اختياري)"), notes: str("ملاحظات ومصدر البيانات"), acknowledgeDuplicates: { type: "boolean", description: "true فقط بعد مراجعة السجلات المشابهة" } }, ["name", "destinationId", "category"]) },
  { name: "create_attraction_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ معلماً سياحياً (قلعة، سوق، وادي…) مرتبطاً بوجهة لاستخدامه في البرنامج اليومي. ابحث أولاً بـsearch_attractions.", inputSchema: obj({ name: str("الاسم"), nameEn: str("الاسم بالإنجليزية (اختياري)"), destinationId: str("معرّف الوجهة"), category: str("الفئة (اختياري)"), description: str("وصف قصير (اختياري)"), visitDurationMinutes: int("مدة الزيارة بالدقائق (اختياري)"), entryFee: money("رسم الدخول إن ذُكر في المصدر (اختياري)"), openingHours: str("ساعات العمل (اختياري)"), notes: str("مصدر البيانات"), acknowledgeDuplicates: { type: "boolean", description: "true فقط بعد مراجعة السجلات المشابهة" } }, ["name", "destinationId"]) },
  { name: "create_experience_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ تجربة/نشاطاً (تخييم صحراوي، رحلة قارب، مسار جبلي…) بحالة DRAFT مع مشغّله إن وُجد. ابحث أولاً بـsearch_experiences.", inputSchema: obj({ name: str("الاسم"), nameEn: str("الاسم بالإنجليزية (اختياري)"), destinationId: str("معرّف الوجهة (اختياري)"), supplierId: str("معرّف المورد المشغّل (اختياري)"), description: str("الوصف"), durationHours: num("المدة بالساعات (اختياري)"), difficulty: enumOf(V.DIFFICULTY_LEVELS, "الصعوبة (اختياري)"), minPax: int("الحد الأدنى للأفراد (اختياري)"), maxPax: int("الحد الأقصى للأفراد (اختياري)"), seasons: arr(enumOf(V.SEASONS, "موسم"), "المواسم (اختياري)"), notes: str("مصدر البيانات"), acknowledgeDuplicates: { type: "boolean", description: "true فقط بعد مراجعة السجلات المشابهة" } }, ["name"]) },
  { name: "create_research_rate", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "يسجّل سعراً استرشادياً من البحث. يُوسم ESTIMATED / E_AI_ESTIMATE تلقائياً ويتطلب رابط المصدر ووقت الرصد.", inputSchema: obj({ supplierId: str("معرّف المورد"), hotelId: str("معرّف الفندق (اختياري)"), experienceId: str("معرّف التجربة (اختياري)"), componentType: enumOf(V.COMPONENT_TYPES, "نوع المكوّن"), serviceType: str("رمز الخدمة مثل HOTEL_ROOM"), serviceDescription: str("وصف الخدمة"), roomType: str("نوع الغرفة (اختياري)"), rateBasis: enumOf(V.RATE_BASES, "أساس السعر"), amount: num("المبلغ"), currency: str("العملة"), season: enumOf(V.SEASONS, "الموسم"), validFrom: str("ISO (اختياري)"), validTo: str("ISO (اختياري)"), cancellationTerms: str("شروط الإلغاء إن ذُكرت"), sourceUrl: str("رابط المصدر"), notes: str("ملاحظات") }, ["supplierId", "componentType", "serviceType", "serviceDescription", "rateBasis", "amount", "currency", "season", "sourceUrl"]) },
  { name: "create_product_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينشئ مسودة منتج/باقة (حالة DESIGN). التفعيل قرار المالك.", inputSchema: obj({ name: str("اسم المنتج"), nameEn: str("الاسم بالإنجليزية"), productType: enumOf(V.PRODUCT_TYPES, "النوع"), durationDays: int("عدد الأيام"), durationNights: int("عدد الليالي"), summary: str("ملخص"), destinationIds: arr(str("معرّف وجهة"), "الوجهات"), highlights: arr(str("نقطة"), "أبرز المعالم"), inclusions: arr(str("عنصر"), "يشمل"), exclusions: arr(str("عنصر"), "لا يشمل"), seasons: arr(enumOf(V.SEASONS, "موسم"), "المواسم"), supplierCost: money("تكلفة الموردين للفرد"), internalCost: money("التكلفة الداخلية للفرد"), minSellingPrice: money("الحد الأدنى لسعر البيع"), recommendedSellingPrice: money("السعر المقترح"), customerSellingPrice: money("سعر البيع للعميل"), targetMarginPercent: num("الهامش المستهدف %") }, ["name", "productType", "durationDays", "durationNights", "summary"]) },
  { name: "add_product_component", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "يضيف مكوّناً لمسودة منتج (فندق/نقل/نشاط…) مع ربطه بسعر مورد إن وُجد.", inputSchema: obj({ productId: str("معرّف المنتج"), componentType: enumOf(V.COMPONENT_TYPES, "النوع"), description: str("الوصف"), dayNumber: int("اليوم (اختياري)"), quantity: num("الكمية"), unit: enumOf(V.RATE_BASES, "الوحدة"), supplierId: str("معرّف المورد (اختياري)"), hotelId: str("معرّف الفندق (اختياري)"), experienceId: str("معرّف التجربة (اختياري)"), rateId: str("معرّف السعر (اختياري)"), supplierCost: money("تكلفة المورد"), internalCost: money("التكلفة الداخلية"), minSellingPrice: money("الحد الأدنى"), recommendedSellingPrice: money("المقترح"), customerSellingPrice: money("سعر العميل") }, ["productId", "componentType", "description", "quantity", "unit"]) },
  { name: "remove_product_component", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "يؤرشف مكوّناً من مسودة منتج غير فعّال.", inputSchema: obj({ componentId: str("معرّف المكوّن") }, ["componentId"]) },
  { name: "get_product_costing", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["product", "executive"], description: "التكلفة والهامش المحسوبان من مكوّنات المنتج، وعدد المكوّنات الاسترشادية، والبرنامج اليومي.", inputSchema: obj({ productId: str("معرّف المنتج") }, ["productId"]) },
  { name: "update_product_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "يعدّل حقول مسودة منتج (الاسم، الملخص، الشروط، المدة، الوجهات، المواسم، حقول التسعير الخمسة، الهامش المستهدف).", inputSchema: obj({ productId: str("معرّف المنتج"), name: str("الاسم"), nameEn: str("الاسم بالإنجليزية"), summary: str("ملخص"), terms: str("الشروط"), durationDays: int("عدد الأيام"), durationNights: int("عدد الليالي"), destinationIds: arr(str("معرّف وجهة"), "الوجهات"), highlights: arr(str("نقطة"), "أبرز المعالم"), inclusions: arr(str("عنصر"), "يشمل"), exclusions: arr(str("عنصر"), "لا يشمل"), seasons: arr(enumOf(V.SEASONS, "موسم"), "المواسم"), minPax: int("الحد الأدنى للأفراد"), maxPax: int("الحد الأقصى للأفراد"), supplierCost: money("تكلفة الموردين للفرد"), internalCost: money("التكلفة الداخلية للفرد"), minSellingPrice: money("الحد الأدنى لسعر البيع"), recommendedSellingPrice: money("السعر المقترح"), customerSellingPrice: money("سعر البيع للعميل"), targetMarginPercent: num("الهامش المستهدف %") }, ["productId"]) },
  { name: "advance_product_status", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "ينقل المنتج عبر دورة حياته وفق التسلسل المسموح (IDEA→CONCEPT→DESIGN→COSTING→QA→APPROVAL→READY_FOR_SALE). التفعيل ACTIVE عبر request_product_activation فقط.", inputSchema: obj({ productId: str("معرّف المنتج"), status: enumOf(["CONCEPT", "DESIGN", "COSTING", "QA", "APPROVAL", "READY_FOR_SALE", "REVIEW", "ARCHIVED"], "الحالة الجديدة"), note: str("سبب الانتقال") }, ["productId", "status"]) },
  { name: "upsert_itinerary_day", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["product"], description: "يضيف أو يعدّل يوماً في البرنامج اليومي للمنتج (العنوان، الوصف، الوجهة، المعالم، الوجبات، فندق الإقامة).", inputSchema: obj({ productId: str("معرّف المنتج"), dayNumber: int("رقم اليوم"), title: str("عنوان اليوم"), description: str("وصف البرنامج"), destinationId: str("معرّف الوجهة (اختياري)"), attractionIds: arr(str("معرّف معلم"), "المعالم"), breakfast: { type: "boolean", description: "إفطار مشمول" }, lunch: { type: "boolean", description: "غداء مشمول" }, dinner: { type: "boolean", description: "عشاء مشمول" }, overnightHotelId: str("معرّف فندق الإقامة (اختياري)") }, ["productId", "dayNumber", "title", "description"]) },
  { name: "request_product_activation", kind: "write_internal", severity: "D3", requiresApproval: false, approvalKind: "SENSITIVE_CHANGE", allowedAgents: ["product"], description: "يطلب من المالك تفعيل منتج READY_FOR_SALE للبيع؛ يُنشئ طلب اعتماد ولا يفعّل مباشرة.", inputSchema: obj({ productId: str("معرّف المنتج"), summary: str("ملخص جاهزية المنتج: المكوّنات، الهامش، المكوّنات الاسترشادية") }, ["productId"]) },
  { name: "create_campaign", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["sales"], description: "ينشئ حملة تسويقية (مسودة) تُجمَّع تحتها منشورات تقويم المحتوى.", inputSchema: obj({ name: str("اسم الحملة"), objective: str("الهدف"), platforms: arr(enumOf(V.CONTENT_PLATFORMS, "منصة"), "المنصات"), startDate: str("ISO (اختياري)"), endDate: str("ISO (اختياري)"), targetAudience: str("الجمهور المستهدف"), budgetOmr: num("الميزانية بالريال (اختياري)"), productIds: arr(str("معرّف منتج"), "المنتجات المروَّجة") }, ["name", "objective", "platforms"]) },
  { name: "propose_follow_up", kind: "write_internal", severity: "D3", requiresApproval: false, approvalKind: "SEND_CUSTOMER_MESSAGE", allowedAgents: ["sales"], description: "يقترح رسالة متابعة لعميل محتمل تُرسل بعد اعتماد المالك، ويحدّد موعد المتابعة.", inputSchema: obj({ leadId: str("معرّف العميل المحتمل"), channel: enumOf(V.CHANNELS, "القناة"), message: str("نص الرسالة بلغة العميل"), purpose: str("الغرض: تذكير/عرض/استفسار/شكر"), followUpAt: str("موعد المتابعة ISO (اختياري)") }, ["leadId", "channel", "message", "purpose"]) },
  { name: "pipeline_report", kind: "read", severity: "D1", requiresApproval: false, allowedAgents: ["sales", "executive"], description: "تقرير خط المبيعات من قاعدة البيانات: القمع حسب المرحلة، القيمة المتوقعة، عملاء بلا تواصل، متابعات متأخرة، عروض تنتهي قريباً، أسباب الخسارة، معدلات التحويل.", inputSchema: obj({ staleDays: int("عدد الأيام بلا تواصل لاعتبار العميل راكداً (افتراضي 7)") }) },
  { name: "create_lead", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["sales", "support"], description: "ينشئ عميلاً محتملاً جديداً.", inputSchema: obj({ contactName: str("الاسم"), contactPhone: str("الهاتف"), contactEmail: str("البريد"), channel: enumOf(V.CHANNELS, "القناة"), summary: str("ملخص الطلب"), customerId: str("معرّف العميل إن وُجد"), interestedProductId: str("معرّف المنتج المهتم به"), paxAdults: int("عدد البالغين"), paxChildren: int("عدد الأطفال") }, ["contactName", "channel"]) },
  { name: "update_lead_stage", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["sales"], description: "يغيّر مرحلة عميل محتمل وفق التسلسل المسموح؛ LOST يتطلب سبباً معيارياً.", inputSchema: obj({ leadId: str("معرّف العميل المحتمل"), stage: enumOf(V.LEAD_STAGES, "المرحلة الجديدة"), lostReason: enumOf(V.LOST_REASONS, "سبب الخسارة (إلزامي عند LOST)"), note: str("ملاحظة") }, ["leadId", "stage"]) },
  { name: "create_quote_draft", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["sales"], description: "ينشئ مسودة عرض سعر من منتج فعّال (ACTIVE) فقط. يعيد تحذيرات الأسعار الاسترشادية/المنتهية.", inputSchema: obj({ leadId: str("معرّف العميل المحتمل"), productId: str("معرّف المنتج الفعّال"), pax: int("عدد الأفراد"), discountPercent: num("نسبة الخصم % (اختياري)"), validDays: int("مدة صلاحية العرض بالأيام") }, ["leadId", "productId", "pax"]) },
  { name: "update_customer_note", kind: "write_internal", severity: "D1", requiresApproval: false, allowedAgents: ["support", "sales"], description: "يضيف ما قاله العميل صراحةً إلى ملاحظات سجله.", inputSchema: obj({ customerId: str("معرّف العميل"), note: str("الملاحظة كما ذكرها العميل") }, ["customerId", "note"]) },
  { name: "escalate_to_executive", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ["support", "sales", "product"], description: "يصعّد شكوى أو خطراً أو قراراً بشرياً إلى الوكيل التنفيذي كمهمة عاجلة.", inputSchema: obj({ summary: str("ملخص واقعي للحالة"), customerId: str("معرّف العميل (اختياري)"), urgency: enumOf(V.TASK_PRIORITIES, "الأولوية") }, ["summary"]) },
  { name: "propose_memory", kind: "write_internal", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "يقترح ذاكرة (عن عميل/مورد/سير عمل) بحالة PROPOSED ليعتمدها المالك. ما هو مستنتج يُوسم INFERRED.", inputSchema: obj({ type: enumOf(V.MEMORY_TYPES, "النوع"), origin: enumOf(["STATED", "INFERRED", "AI_ASSESSMENT"], "الأصل"), content: str("المحتوى"), subjectTable: str("الجدول المرتبط (اختياري)"), subjectId: str("معرّف السجل المرتبط (اختياري)"), confidence: num("الثقة 0-1") }, ["type", "origin", "content"]) },
  { name: "record_knowledge_gap", kind: "write_internal", severity: "D1", requiresApproval: false, allowedAgents: ALL, description: "يسجّل سؤالاً لم تتوفر له إجابة في قاعدة المعرفة.", inputSchema: obj({ question: str("السؤال") }, ["question"]) },
  { name: "record_data_conflict", kind: "write_internal", severity: "D2", requiresApproval: false, allowedAgents: ALL, description: "يسجّل تعارض مصدرين حول قيمة واحدة بدل اختيار أحدهما. يطبّق النظام ترتيب الحسم أو يصعّد للمالك.", inputSchema: obj({ table: str("الجدول"), recordId: str("معرّف السجل (اختياري)"), field: str("الحقل"), candidates: arr(obj({ value: str("القيمة"), sourceKind: enumOf(V.SOURCE_KINDS, "نوع المصدر"), sourceRef: str("مرجع/رابط المصدر"), trustLevel: enumOf(V.TRUST_LEVELS, "مستوى الثقة"), observedAt: str("ISO"), contractual: { type: "boolean", description: "تعاقدي؟" } }, ["value", "sourceKind", "trustLevel"]), "المرشحان أو أكثر") }, ["table", "field", "candidates"]) },
  { name: "schedule_content", kind: "write_internal", severity: "D2", requiresApproval: false, approvalKind: "PUBLISH_CONTENT", allowedAgents: ["sales"], description: "يضيف منشوراً إلى تقويم النشر بحالة بانتظار الاعتماد وينشئ طلب اعتماد للنشر.", inputSchema: obj({ platform: enumOf(V.CONTENT_PLATFORMS, "المنصة"), caption: str("النص"), captionEn: str("النص بالإنجليزية (اختياري)"), hashtags: arr(str("#هاشتاق"), "الهاشتاقات"), visualIdea: str("الفكرة المرئية"), scheduledAt: str("وقت النشر ISO"), productId: str("معرّف المنتج (اختياري)"), campaignId: str("معرّف الحملة (اختياري)") }, ["platform", "caption", "scheduledAt"]) },
  { name: "propose_reply", kind: "write_internal", severity: "D2", requiresApproval: false, approvalKind: "SEND_CUSTOMER_MESSAGE", allowedAgents: ["support"], description: "يصنّف رسالة واردة ويقترح رداً يُعرض على المالك للاعتماد بنقرة. الشكاوى وانخفاض الثقة والحجوزات الكبيرة تُعاد معالجتها تلقائياً بنموذج أدق مرة واحدة. استدعِه مرة واحدة لكل رسالة.", inputSchema: obj({ interactionId: str("معرّف الرسالة"), kind: enumOf(V.INTERACTION_KINDS, "التصنيف"), confidence: num("ثقة التصنيف 0-1"), reply: str("الرد المقترح بلغة العميل، دون أسعار غير موجودة في منتج فعّال أو حجز فعلي"), faq: { type: "boolean", description: "true فقط إذا كان الرد مبنياً بالكامل على معرفة معتمدة (search_knowledge) أو منتج فعّال ولا يتضمن سعراً أو تأكيد حجز؛ يؤهّل للرد التلقائي إن فعّله المالك" }, estimatedBookingValueOmr: num("القيمة التقديرية لطلب الحجز بالريال العُماني إن كانت الرسالة طلب حجز (اختياري)") }, ["interactionId", "kind", "confidence", "reply"]) },
  // -------------------------------------------------------------- external
  { name: "send_customer_message", kind: "external", severity: "D3", requiresApproval: true, approvalKind: "SEND_CUSTOMER_MESSAGE", allowedAgents: ["sales", "support"], description: "إرسال رسالة لعميل عبر قناة. لا تُرسل مباشرة؛ تُنشئ طلب اعتماد بمعاينة كاملة.", inputSchema: obj({ customerId: str("معرّف العميل"), channel: enumOf(V.CHANNELS, "القناة"), message: str("نص الرسالة"), purpose: str("الغرض: ترحيب/تذكير/متابعة/استطلاع/رد") }, ["customerId", "channel", "message", "purpose"]) },
  { name: "send_quote", kind: "external", severity: "D3", requiresApproval: true, approvalKind: "SEND_QUOTE", allowedAgents: ["sales"], description: "إرسال عرض سعر لعميل محتمل. يُنشئ طلب اعتماد يتضمن العرض وتحذيرات الأسعار.", inputSchema: obj({ quoteId: str("معرّف العرض"), channel: enumOf(V.CHANNELS, "القناة"), message: str("رسالة مصاحبة") }, ["quoteId", "channel", "message"]) },
];

export const TOOLS_BY_NAME = new Map(TOOL_SPECS.map((t) => [t.name, t]));

export function toolsForAgent(agent: Doc<"agents">): ToolSpec[] {
  return TOOL_SPECS.filter((t) => t.allowedAgents.includes(agent.slug) && agent.allowedTools.includes(t.name));
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------
export interface ToolOutcome {
  content: string;
  isError?: boolean;
  createdSubtaskId?: Id<"tasks">;
  waitingDecision?: boolean;
  approvalId?: Id<"approvals">;
  citations?: Doc<"tasks">["citations"];
}

const MAX_RESULT_CHARS = 6000;
/** Hard cap so a confused agent cannot fan out indefinitely. */
export const MAX_SUBTASKS_PER_TASK = 6;

function json(value: unknown): string {
  const text = JSON.stringify(value, null, 0) ?? "null";
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…(مقتطع)` : text;
}

function s(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function n(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
function ts(input: Record<string, unknown>, key: string): number | undefined {
  const v = input[key];
  if (typeof v === "number") return v;
  if (typeof v === "string" && v) {
    const p = Date.parse(v);
    return Number.isNaN(p) ? undefined : p;
  }
  return undefined;
}
function list(input: Record<string, unknown>, key: string): string[] {
  const v = input[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}
function id<T extends "customers" | "leads" | "products" | "bookings" | "suppliers" | "hotels" | "experiences" | "attractions" | "rates" | "quotes" | "interactions" | "campaigns" | "destinations">(ctx: MutationCtx, table: T, raw: string | undefined): Id<T> | undefined {
  if (!raw) return undefined;
  return ctx.db.normalizeId(table, raw) ?? undefined;
}

/**
 * Creates a reference record from research. Duplicate candidates are returned to
 * the model (not an error) so it reuses the existing id instead of forking data.
 */
async function createDraftRecord(ctx: MutationCtx, actor: Actor, key: "destinations" | "suppliers" | "hotels" | "attractions" | "experiences", data: Record<string, unknown>, acknowledgeDuplicates: boolean, label: string): Promise<ToolOutcome> {
  try {
    const result = await createRecord(ctx, actor, key, data, { acknowledgeDuplicates });
    return { content: `أُنشئ ${label} ${result.businessId} (معرّف ${result.id}) كسجل مستخرج آلياً بانتظار تحقق المالك. استخدم هذا المعرّف في الخطوات التالية.` };
  } catch (e) {
    if (isAppError(e, "DUPLICATE")) {
      const candidates = ((e.data.details as { candidates?: unknown[] } | undefined)?.candidates ?? []) as { _id: string; businessId: string; label: string; matchedOn: string[] }[];
      return { content: `توجد سجلات مشابهة بالفعل — استخدم معرّفها بدل إنشاء جديد: ${json(candidates.map((c) => ({ id: c._id, businessId: c.businessId, name: c.label, matchedOn: c.matchedOn })))}. إن كان سجلك مختلفاً فعلاً أعد الاستدعاء مع acknowledgeDuplicates=true.` };
    }
    throw e;
  }
}

function pick<T extends Record<string, unknown>>(rows: T[], keys: string[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])));
}

const TRUST_KEYS = ["_id", "businessId", "trustLevel", "verificationStatus", "freshness", "source", "classification"];

export async function executeTool(ctx: MutationCtx, task: Doc<"tasks">, agent: Doc<"agents">, toolName: string, input: Record<string, unknown>): Promise<ToolOutcome> {
  const spec = TOOLS_BY_NAME.get(toolName);
  if (!spec) return { content: `أداة غير معروفة: ${toolName}`, isError: true };
  if (!spec.allowedAgents.includes(agent.slug) || !agent.allowedTools.includes(toolName)) {
    return { content: `الأداة ${toolName} غير مسموحة للوكيل ${agent.slug}`, isError: true };
  }
  const actor: Actor = agentActor(agent.slug, task._id);
  const refs = task.contextRefs;
  try {
    switch (toolName) {
      // ---------------------------------------------------------------- read
      case "get_kpis":
        return { content: json(await computeKpis(ctx, s(input, "monthKey"))) };
      case "search_customers": {
        const rows = await listRecords(ctx, actor, "customers", { search: s(input, "query"), limit: n(input, "limit") ?? 10, contextRefs: refs });
        return { content: json(pick(rows, [...TRUST_KEYS, "fullName", "customerType", "phone", "email", "preferredLanguage", "preferredChannel", "city", "consentStatus", "tags", "status", "notes"])) };
      }
      case "search_leads": {
        const rows = await listRecords(ctx, actor, "leads", { search: s(input, "query"), status: s(input, "stage"), limit: n(input, "limit") ?? 20, contextRefs: refs });
        return { content: json(pick(rows, [...TRUST_KEYS, "contactName", "contactPhone", "contactEmail", "channel", "stage", "lostReason", "interestedProductId", "expectedValue", "travelDateFrom", "travelDateTo", "paxAdults", "paxChildren", "nextFollowUpAt", "summary", "customerId"])) };
      }
      case "search_products": {
        const rows = await listRecords(ctx, actor, "products", { search: s(input, "query"), status: s(input, "status"), limit: n(input, "limit") ?? 20, contextRefs: refs });
        const enriched = [];
        for (const r of rows) {
          const costing = await productCosting(ctx, r._id as Id<"products">);
          enriched.push({ ...Object.fromEntries([...TRUST_KEYS, "name", "nameEn", "productType", "status", "version", "durationDays", "durationNights", "summary", "pricing", "margin", "destinationIds", "seasons", "validTo"].filter((k) => k in r).map((k) => [k, r[k]])), componentCount: costing.components.length, estimatedComponents: costing.estimatedComponents });
        }
        return { content: json(enriched) };
      }
      case "search_bookings": {
        const customerId = id(ctx, "customers", s(input, "customerId"));
        let rows = await listRecords(ctx, actor, "bookings", { search: s(input, "query"), status: s(input, "status"), limit: n(input, "limit") ?? 20, contextRefs: refs });
        if (customerId) rows = rows.filter((r) => r.customerId === customerId);
        const out = [];
        for (const r of rows) {
          const services = await ctx.db.query("bookingServices").withIndex("by_booking", (q) => q.eq("bookingId", r._id as Id<"bookings">)).take(50);
          out.push({ ...Object.fromEntries([...TRUST_KEYS, "customerId", "productId", "productVersion", "status", "paymentStatus", "travelDateFrom", "travelDateTo", "paxAdults", "paxChildren", "totalSellingPrice", "totalSupplierCost", "specialRequests"].filter((k) => k in r).map((k) => [k, r[k]])), services: services.map((sv) => ({ businessId: sv.businessId, componentType: sv.componentType, description: sv.description, status: sv.status, rateTrust: sv.rateTrust, confirmationEvidenceId: sv.confirmationEvidenceId, customerSellingPrice: sv.pricing.customerSellingPrice })) });
        }
        return { content: json(out) };
      }
      case "search_suppliers": {
        let rows = await listRecords(ctx, actor, "suppliers", { search: s(input, "query"), limit: n(input, "limit") ?? 20 });
        const type = s(input, "supplierType");
        if (type) rows = rows.filter((r) => r.supplierType === type);
        return { content: json(pick(rows, [...TRUST_KEYS, "name", "nameEn", "supplierType", "status", "contactName", "phone", "email", "website", "city", "paymentTerms", "performance", "tags"])) };
      }
      case "search_hotels": {
        let rows = await listRecords(ctx, actor, "hotels", { search: s(input, "query"), limit: n(input, "limit") ?? 20 });
        const dest = s(input, "destinationId");
        if (dest) rows = rows.filter((r) => r.destinationId === dest);
        return { content: json(pick(rows, [...TRUST_KEYS, "name", "nameEn", "destinationId", "supplierId", "category", "roomTypes", "amenities", "childPolicy", "checkInTime", "checkOutTime", "status"])) };
      }
      case "search_destinations":
        return { content: json(pick(await listRecords(ctx, actor, "destinations", { search: s(input, "query"), limit: 30 }), [...TRUST_KEYS, "name", "nameEn", "kind", "governorate", "description", "bestSeasons", "status"])) };
      case "search_attractions": {
        let rows = await listRecords(ctx, actor, "attractions", { search: s(input, "query"), limit: 40 });
        const dest = s(input, "destinationId");
        if (dest) rows = rows.filter((r) => r.destinationId === dest);
        return { content: json(pick(rows, [...TRUST_KEYS, "name", "nameEn", "destinationId", "category", "description", "visitDurationMinutes", "entryFee", "openingHours"])) };
      }
      case "search_experiences": {
        let rows = await listRecords(ctx, actor, "experiences", { search: s(input, "query"), limit: 40 });
        const dest = s(input, "destinationId");
        if (dest) rows = rows.filter((r) => r.destinationId === dest);
        return { content: json(pick(rows, [...TRUST_KEYS, "name", "nameEn", "destinationId", "supplierId", "description", "durationHours", "difficulty", "minPax", "maxPax", "seasons"])) };
      }
      case "search_rates": {
        let rows = await listRecords(ctx, actor, "rates", { search: s(input, "query"), limit: n(input, "limit") ?? 30 });
        const supplierId = s(input, "supplierId");
        const hotelId = s(input, "hotelId");
        const componentType = s(input, "componentType");
        if (supplierId) rows = rows.filter((r) => r.supplierId === supplierId);
        if (hotelId) rows = rows.filter((r) => r.hotelId === hotelId);
        if (componentType) rows = rows.filter((r) => r.componentType === componentType);
        return { content: json(pick(rows, [...TRUST_KEYS, "supplierId", "hotelId", "experienceId", "serviceType", "serviceDescription", "componentType", "roomType", "rateBasis", "amount", "season", "validFrom", "validTo", "taxesAndFees", "cancellationTerms", "rateTrust", "status", "version"])) };
      }
      case "search_pricing_rules":
        return { content: json(pick(await listRecords(ctx, actor, "pricingRules", { status: "ACTIVE", limit: 50 }), [...TRUST_KEYS, "kind", "name", "value", "unit", "appliesTo", "priority", "validFrom", "validTo"])) };
      case "search_policies": {
        let rows = await listRecords(ctx, actor, "policies", { search: s(input, "query"), status: "ACTIVE", limit: 30 });
        const category = s(input, "category");
        if (category) rows = rows.filter((r) => r.category === category);
        const now = Date.now();
        const citations = rows.map((r) => ({ kind: "record" as const, table: "policies", recordId: String(r._id), retrievedAt: now }));
        return { content: json(pick(rows, [...TRUST_KEYS, "title", "category", "summary", "body", "version", "validFrom", "validTo", "appliesToAgents"])), citations };
      }
      case "search_decisions": {
        const now = Date.now();
        const rows = (await listRecords(ctx, actor, "decisionRegister", { search: s(input, "query"), status: "ACTIVE", limit: 30 })).filter((r) => (r.effectiveFrom as number) <= now && (r.effectiveTo === undefined || (r.effectiveTo as number) >= now));
        return { content: json(pick(rows, [...TRUST_KEYS, "kind", "title", "description", "scope", "effectiveFrom", "effectiveTo", "reason", "decidedAt"])) };
      }
      case "search_quotes": {
        const leadId = id(ctx, "leads", s(input, "leadId"));
        const rows = leadId ? await ctx.db.query("quotes").withIndex("by_lead", (q) => q.eq("leadId", leadId)).take(n(input, "limit") ?? 20) : await ctx.db.query("quotes").order("desc").take(n(input, "limit") ?? 20);
        const redacted = [];
        for (const r of rows) {
          const doc = await getRecord(ctx, actor, "leads", r.leadId, refs);
          void doc;
          redacted.push({ _id: r._id, businessId: r.businessId, leadId: r.leadId, productId: r.productId, productVersion: r.productVersion, status: r.status, totals: { customerSellingPrice: r.totals.customerSellingPrice, minSellingPrice: r.totals.minSellingPrice }, priceWarnings: r.priceWarnings, validUntil: r.validUntil, version: r.version });
        }
        return { content: json(redacted) };
      }
      case "search_campaigns":
        return { content: json(pick((await ctx.db.query("campaigns").order("desc").take(30)).filter((c) => !c.archivedAt) as unknown as Record<string, unknown>[], ["_id", "businessId", "name", "objective", "platforms", "startDate", "endDate", "status", "targetAudience", "productIds"])) };
      case "search_content": {
        const status = s(input, "status");
        const rows = status ? await ctx.db.query("contentCalendar").withIndex("by_status", (q) => q.eq("status", status as Doc<"contentCalendar">["status"])).take(50) : await ctx.db.query("contentCalendar").order("desc").take(50);
        return { content: json(pick(rows as unknown as Record<string, unknown>[], ["_id", "businessId", "platform", "scheduledAt", "status", "caption", "hashtags", "visualIdea", "productId", "campaignId", "rejectionReason", "publishedAt"])) };
      }
      case "search_interactions": {
        const customerId = id(ctx, "customers", s(input, "customerId"));
        const status = s(input, "status");
        let rows = customerId
          ? await ctx.db.query("interactions").withIndex("by_customer", (q) => q.eq("customerId", customerId)).order("desc").take(n(input, "limit") ?? 20)
          : status
            ? await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status as Doc<"interactions">["status"])).order("desc").take(n(input, "limit") ?? 20)
            : await ctx.db.query("interactions").order("desc").take(n(input, "limit") ?? 20);
        if (agent.slug === "support") rows = rows.filter((r) => r.customerId && refs.customerIds.includes(r.customerId));
        return { content: json(pick(rows as unknown as Record<string, unknown>[], ["_id", "businessId", "customerId", "leadId", "channel", "direction", "kind", "status", "subject", "body", "language", "aiClassification", "proposedReply", "receivedAt"])) };
      }
      case "search_knowledge": {
        const hits = await keywordSearch(ctx, actor, s(input, "query") ?? "", { limit: n(input, "limit") ?? 6, asOf: ts(input, "asOf") });
        if (hits.length === 0) {
          await recordKnowledgeGap(ctx, agent.slug, s(input, "query") ?? "", task._id);
          return { content: "لا توجد مستندات معتمدة تجيب عن هذا السؤال. سُجّلت فجوة معرفة للمالك." };
        }
        await recordCitations(ctx, hits.map((h) => h.documentId));
        return { content: json(hits.map((h) => ({ document: h.documentBusinessId, title: h.title, version: h.version, section: h.section, trustLevel: h.trustLevel, freshness: h.freshness, validFrom: h.validFrom, validTo: h.validTo, text: h.text }))), citations: hits.map((h) => h.citation) };
      }
      case "list_pending_approvals": {
        const rows = await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).order("desc").take(50);
        return { content: json(rows.map((a) => ({ businessId: a.businessId, kind: a.kind, title: a.title, summary: a.summary, agentSlug: a.agentSlug, severity: a.severity, requestedAt: a.requestedAt }))) };
      }
      case "list_tasks": {
        const rows = await listActiveTasks(ctx);
        return { content: json(rows.map((t) => ({ businessId: t.businessId, title: t.title, agentSlug: t.agentSlug, status: t.status, priority: t.priority, parentTaskId: t.parentTaskId }))) };
      }
      // ------------------------------------------------------ write_internal
      case "delegate_task": {
        const agentSlug = s(input, "agentSlug");
        if (!V.isOneOf(V.AGENT_SLUGS, agentSlug) || agentSlug === "executive") return { content: "agentSlug غير صالح", isError: true };
        const existingChildren = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", task._id)).take(MAX_SUBTASKS_PER_TASK + 1);
        if (existingChildren.length >= MAX_SUBTASKS_PER_TASK) {
          return { content: `بلغت المهمة الحد الأقصى للمهام الفرعية (${MAX_SUBTASKS_PER_TASK}). اجمع النتائج الموجودة وقدّم الملخص بدل التفويض مجدداً.`, isError: true };
        }
        const subtaskId = await createTask(ctx, {
          title: s(input, "title") ?? "مهمة فرعية",
          request: s(input, "request") ?? "",
          origin: task.origin === "customer" ? "customer" : "agent",
          agentSlug,
          requestedBy: actor,
          parentTaskId: task._id,
          conversationId: task.conversationId,
          priority: task.priority,
          contextRefs: {
            customerIds: [...new Set([...refs.customerIds, ...(list(input, "customerIds").map((x) => id(ctx, "customers", x)).filter(Boolean) as Id<"customers">[])])],
            leadIds: [...new Set([...refs.leadIds, ...(list(input, "leadIds").map((x) => id(ctx, "leads", x)).filter(Boolean) as Id<"leads">[])])],
            productIds: [...new Set([...refs.productIds, ...(list(input, "productIds").map((x) => id(ctx, "products", x)).filter(Boolean) as Id<"products">[])])],
            bookingIds: [...new Set([...refs.bookingIds, ...(list(input, "bookingIds").map((x) => id(ctx, "bookings", x)).filter(Boolean) as Id<"bookings">[])])],
          },
        });
        const sub = await ctx.db.get(subtaskId);
        return { content: `أُنشئت المهمة الفرعية ${sub?.businessId} للوكيل ${agentSlug} وهي قيد التنفيذ؛ ستصلك نتيجتها عند اكتمالها.`, createdSubtaskId: subtaskId };
      }
      case "request_owner_decision": {
        const { approvalId } = await createApproval(ctx, actor, {
          kind: "OTHER",
          agentSlug: agent.slug,
          taskId: task._id,
          title: s(input, "title") ?? "قرار مطلوب",
          summary: s(input, "question") ?? "",
          payload: { question: s(input, "question"), options: list(input, "options"), recommendation: s(input, "recommendation") },
          severity: "D3",
        });
        return { content: "وُضع القرار في صندوق اعتماد المالك؛ ستُستكمل المهمة عند رده.", waitingDecision: true, approvalId };
      }
      case "web_search_note": {
        const url = s(input, "url");
        if (!url || !/^https?:\/\//.test(url)) return { content: "url غير صالح", isError: true };
        const citation = { kind: "web" as const, url, title: s(input, "title"), retrievedAt: Date.now() };
        await ctx.db.patch(task._id, { citations: [...task.citations, citation].slice(-50) });
        return { content: `سُجّل المصدر ${url} (وقت الرصد ${new Date(citation.retrievedAt).toISOString()}).`, citations: [citation] };
      }
      case "create_destination":
        return await createDraftRecord(ctx, actor, "destinations", { name: s(input, "name"), nameEn: s(input, "nameEn"), kind: s(input, "kind"), governorate: s(input, "governorate"), description: s(input, "description"), bestSeasons: list(input, "bestSeasons"), status: "ACTIVE" }, input.acknowledgeDuplicates === true, "الوجهة");
      case "create_supplier_draft":
        return await createDraftRecord(ctx, actor, "suppliers", { name: s(input, "name"), nameEn: s(input, "nameEn"), supplierType: s(input, "supplierType"), status: "PROSPECT", website: s(input, "website"), phone: s(input, "phone"), email: s(input, "email"), city: s(input, "city"), notes: s(input, "notes"), tags: ["research"] }, input.acknowledgeDuplicates === true, "المورد");
      case "create_hotel_draft": {
        const destinationId = id(ctx, "destinations", s(input, "destinationId"));
        if (!destinationId) return { content: "destinationId غير صالح — أنشئ الوجهة أولاً بـcreate_destination أو ابحث عنها بـsearch_destinations", isError: true };
        return await createDraftRecord(ctx, actor, "hotels", { name: s(input, "name"), nameEn: s(input, "nameEn"), destinationId, supplierId: id(ctx, "suppliers", s(input, "supplierId")), category: s(input, "category"), address: s(input, "address"), website: s(input, "website"), phone: s(input, "phone"), amenities: list(input, "amenities"), notes: s(input, "notes"), status: "DRAFT" }, input.acknowledgeDuplicates === true, "الفندق");
      }
      case "create_attraction_draft": {
        const destinationId = id(ctx, "destinations", s(input, "destinationId"));
        if (!destinationId) return { content: "destinationId غير صالح — أنشئ الوجهة أولاً بـcreate_destination", isError: true };
        return await createDraftRecord(ctx, actor, "attractions", { name: s(input, "name"), nameEn: s(input, "nameEn"), destinationId, category: s(input, "category"), description: s(input, "description"), visitDurationMinutes: n(input, "visitDurationMinutes"), entryFee: input.entryFee, openingHours: s(input, "openingHours"), notes: s(input, "notes"), status: "DRAFT" }, input.acknowledgeDuplicates === true, "المعلم");
      }
      case "create_experience_draft":
        return await createDraftRecord(ctx, actor, "experiences", { name: s(input, "name"), nameEn: s(input, "nameEn"), destinationId: id(ctx, "destinations", s(input, "destinationId")), supplierId: id(ctx, "suppliers", s(input, "supplierId")), description: s(input, "description"), durationHours: n(input, "durationHours"), difficulty: s(input, "difficulty"), minPax: n(input, "minPax"), maxPax: n(input, "maxPax"), seasons: list(input, "seasons"), notes: s(input, "notes"), status: "DRAFT" }, input.acknowledgeDuplicates === true, "التجربة");
      case "create_research_rate": {
        const supplierId = id(ctx, "suppliers", s(input, "supplierId"));
        if (!supplierId) return { content: "supplierId غير صالح — ابحث عن المورد بـsearch_suppliers أو أنشئه بـcreate_supplier_draft ثم أعد المحاولة", isError: true };
        const result = await createResearchRate(ctx, actor, {
          supplierId,
          hotelId: id(ctx, "hotels", s(input, "hotelId")),
          experienceId: id(ctx, "experiences", s(input, "experienceId")),
          componentType: s(input, "componentType") as Doc<"rates">["componentType"],
          serviceType: s(input, "serviceType") ?? "",
          serviceDescription: s(input, "serviceDescription") ?? "",
          roomType: s(input, "roomType"),
          rateBasis: s(input, "rateBasis") as Doc<"rates">["rateBasis"],
          amount: n(input, "amount") ?? 0,
          currency: s(input, "currency") ?? "OMR",
          season: s(input, "season") as Doc<"rates">["season"],
          validFrom: ts(input, "validFrom"),
          validTo: ts(input, "validTo"),
          cancellationTerms: s(input, "cancellationTerms"),
          sourceUrl: s(input, "sourceUrl") ?? "",
          notes: s(input, "notes"),
        });
        return { content: `سُجّل السعر الاسترشادي ${result.businessId} بحالة PROPOSED ومستوى ثقة ESTIMATED؛ يحتاج تأكيداً من المورد قبل استخدامه في عرض.` };
      }
      case "create_product_draft": {
        const result = await createRecord(ctx, actor, "products", {
          name: s(input, "name"),
          nameEn: s(input, "nameEn"),
          productType: s(input, "productType"),
          status: "DESIGN",
          durationDays: n(input, "durationDays"),
          durationNights: n(input, "durationNights"),
          summary: s(input, "summary"),
          destinationIds: list(input, "destinationIds"),
          highlights: list(input, "highlights"),
          inclusions: list(input, "inclusions"),
          exclusions: list(input, "exclusions"),
          seasons: list(input, "seasons"),
          supplierCost: input.supplierCost,
          internalCost: input.internalCost,
          minSellingPrice: input.minSellingPrice,
          recommendedSellingPrice: input.recommendedSellingPrice,
          customerSellingPrice: input.customerSellingPrice,
          targetMarginPercent: n(input, "targetMarginPercent"),
        });
        return { content: `أُنشئت مسودة المنتج ${result.businessId} (معرّف ${result.id}) بحالة DESIGN. أضف المكوّنات عبر add_product_component.` };
      }
      case "add_product_component": {
        const productId = id(ctx, "products", s(input, "productId"));
        if (!productId) return { content: "productId غير صالح", isError: true };
        const result = await addProductComponent(ctx, actor, productId, {
          componentType: s(input, "componentType") as Doc<"productComponents">["componentType"],
          description: s(input, "description") ?? "",
          dayNumber: n(input, "dayNumber"),
          quantity: n(input, "quantity") ?? 1,
          unit: s(input, "unit") as Doc<"productComponents">["unit"],
          supplierId: id(ctx, "suppliers", s(input, "supplierId")),
          hotelId: id(ctx, "hotels", s(input, "hotelId")),
          experienceId: id(ctx, "experiences", s(input, "experienceId")),
          rateId: id(ctx, "rates", s(input, "rateId")),
          supplierCost: input.supplierCost as { amount: number; currency: string } | undefined,
          internalCost: input.internalCost as { amount: number; currency: string } | undefined,
          minSellingPrice: input.minSellingPrice as { amount: number; currency: string } | undefined,
          recommendedSellingPrice: input.recommendedSellingPrice as { amount: number; currency: string } | undefined,
          customerSellingPrice: input.customerSellingPrice as { amount: number; currency: string } | undefined,
        });
        const costing = await productCosting(ctx, productId);
        return { content: json({ component: result.businessId, totals: costing.pricing, margin: costing.margin, estimatedComponents: costing.estimatedComponents }) };
      }
      case "remove_product_component": {
        const componentId = ctx.db.normalizeId("productComponents", s(input, "componentId") ?? "");
        if (!componentId) return { content: "componentId غير صالح", isError: true };
        await archiveProductComponent(ctx, actor, componentId);
        return { content: "أُرشف المكوّن." };
      }
      case "get_product_costing": {
        const productId = id(ctx, "products", s(input, "productId"));
        if (!productId) return { content: "productId غير صالح", isError: true };
        const product = await getRecord(ctx, actor, "products", productId, refs);
        if (!product) return { content: "المنتج غير موجود", isError: true };
        const costing = await productCosting(ctx, productId);
        const itineraries = await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", productId)).take(60);
        return {
          content: json({
            product: { businessId: product.businessId, name: product.name, version: product.version, status: product.status, pricing: product.pricing },
            components: costing.components.map((c) => ({ id: c._id, businessId: c.businessId, componentType: c.componentType, description: c.description, dayNumber: c.dayNumber, quantity: c.quantity, unit: c.unit, rateTrust: c.rateTrust, trustLevel: c.trustLevel, pricing: c.pricing })),
            totals: costing.pricing,
            margin: costing.margin,
            estimatedComponents: costing.estimatedComponents,
            itinerary: itineraries.sort((a, b) => a.dayNumber - b.dayNumber).map((d) => ({ dayNumber: d.dayNumber, title: d.title, description: d.description, meals: d.meals, overnightHotelId: d.overnightHotelId })),
          }),
        };
      }
      case "update_product_draft": {
        const productId = id(ctx, "products", s(input, "productId"));
        if (!productId) return { content: "productId غير صالح", isError: true };
        const patch: Record<string, unknown> = {};
        for (const key of ["name", "nameEn", "summary", "terms"]) if (s(input, key) !== undefined) patch[key] = s(input, key);
        for (const key of ["durationDays", "durationNights", "minPax", "maxPax", "targetMarginPercent"]) if (n(input, key) !== undefined) patch[key] = n(input, key);
        for (const key of ["destinationIds", "highlights", "inclusions", "exclusions", "seasons"]) if (Array.isArray(input[key])) patch[key] = list(input, key);
        for (const key of ["supplierCost", "internalCost", "minSellingPrice", "recommendedSellingPrice", "customerSellingPrice"]) if (input[key] !== undefined) patch[key] = input[key];
        if (Object.keys(patch).length === 0) return { content: "لا حقول للتعديل", isError: true };
        const result = await updateRecord(ctx, actor, "products", productId, patch, { contextRefs: refs });
        return { content: result.approvalRequired ? `التعديل يتطلب اعتماد المالك (طلب ${result.approvalId}).` : `حُدّثت مسودة المنتج ${result.businessId}.` };
      }
      case "advance_product_status": {
        const productId = id(ctx, "products", s(input, "productId"));
        const status = s(input, "status");
        if (!productId || !status) return { content: "productId/status غير صالح", isError: true };
        if (status === "ACTIVE") return { content: "التفعيل يمر عبر request_product_activation", isError: true };
        const result = await updateRecord(ctx, actor, "products", productId, { status }, { contextRefs: refs, reason: s(input, "note") });
        return { content: result.approvalRequired ? `الانتقال يتطلب اعتماد المالك (طلب ${result.approvalId}).` : `انتقل المنتج ${result.businessId} إلى ${status}.` };
      }
      case "upsert_itinerary_day": {
        const productId = id(ctx, "products", s(input, "productId"));
        if (!productId) return { content: "productId غير صالح", isError: true };
        const itineraryId = await upsertItineraryDay(ctx, actor, productId, {
          dayNumber: n(input, "dayNumber") ?? 0,
          title: s(input, "title") ?? "",
          description: s(input, "description") ?? "",
          destinationId: id(ctx, "destinations", s(input, "destinationId")),
          attractionIds: list(input, "attractionIds").map((x) => ctx.db.normalizeId("attractions", x)).filter((x): x is Id<"attractions"> => !!x),
          meals: { breakfast: input.breakfast === true, lunch: input.lunch === true, dinner: input.dinner === true },
          overnightHotelId: id(ctx, "hotels", s(input, "overnightHotelId")),
        });
        return { content: `حُفظ اليوم ${n(input, "dayNumber")} في البرنامج (${itineraryId}).` };
      }
      case "request_product_activation": {
        const productId = id(ctx, "products", s(input, "productId"));
        if (!productId) return { content: "productId غير صالح", isError: true };
        const product = await ctx.db.get(productId);
        if (!product) return { content: "المنتج غير موجود", isError: true };
        if (product.status !== "READY_FOR_SALE") return { content: `المنتج في حالة ${product.status}؛ انقله إلى READY_FOR_SALE أولاً عبر advance_product_status.`, isError: true };
        const costing = await productCosting(ctx, productId);
        const outcome = await activateProduct(ctx, actor, productId);
        if (outcome.approvalRequired) {
          await ctx.db.patch(outcome.approvalId, { summary: `${s(input, "summary") ?? ""} | مكوّنات: ${costing.components.length}، هامش: ${costing.margin.marginPercent ?? "—"}%، استرشادية: ${costing.estimatedComponents}`.slice(0, 2000) });
          return { content: `أُنشئ طلب اعتماد تفعيل المنتج ${product.businessId} (${outcome.approvalId})؛ لن يُباع قبل موافقة المالك.`, approvalId: outcome.approvalId };
        }
        return { content: `فُعّل المنتج ${product.businessId}.` };
      }
      case "create_campaign": {
        const budget = n(input, "budgetOmr");
        const result = await createCampaign(ctx, actor, {
          name: s(input, "name") ?? "",
          objective: s(input, "objective") ?? "",
          platforms: list(input, "platforms") as Doc<"campaigns">["platforms"],
          startDate: ts(input, "startDate"),
          endDate: ts(input, "endDate"),
          targetAudience: s(input, "targetAudience"),
          budget: budget !== undefined ? { amount: budget, currency: "OMR" } : undefined,
          productIds: list(input, "productIds").map((x) => ctx.db.normalizeId("products", x)).filter((x): x is Id<"products"> => !!x),
        });
        return { content: `أُنشئت الحملة ${result.businessId} (معرّف ${result.id}) بحالة DRAFT؛ أضف منشوراتها عبر schedule_content.` };
      }
      case "propose_follow_up": {
        const leadId = id(ctx, "leads", s(input, "leadId"));
        if (!leadId) return { content: "leadId غير صالح", isError: true };
        const channel = s(input, "channel");
        if (!V.isOneOf(V.CHANNELS, channel)) return { content: "channel غير معياري", isError: true };
        const result = await proposeFollowUp(ctx, actor, agent.slug, { leadId, channel, message: s(input, "message") ?? "", purpose: s(input, "purpose") ?? "متابعة", followUpAt: ts(input, "followUpAt") });
        return { content: result.autoApproved ? "اعتُمدت رسالة المتابعة تلقائياً وفق قاعدة المالك." : "أُنشئ طلب اعتماد لرسالة المتابعة؛ لن تُرسل قبل موافقة المالك.", approvalId: result.approvalId };
      }
      case "pipeline_report":
        return { content: json(await pipelineReport(ctx, { staleDays: n(input, "staleDays") })) };
      case "get_report": {
        const kind = s(input, "kind");
        // Specialists see only their own domain; the executive sees everything.
        const allowed: Record<string, string[]> = { executive: ["monthly_series", "support", "agent_performance", "cost", "bookings"], sales: ["monthly_series", "bookings"], support: ["support", "bookings"], product: [] };
        if (!kind || !(allowed[agent.slug] ?? []).includes(kind)) return { content: `kind غير مسموح لهذا الوكيل. المسموح: ${(allowed[agent.slug] ?? []).join(", ") || "لا شيء"}`, isError: true };
        const month = s(input, "month");
        const validMonth = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined;
        switch (kind) {
          case "monthly_series":
            return { content: json(await monthlySeries(ctx, n(input, "months") ?? 6)) };
          case "support":
            return { content: json(await supportReport(ctx, { days: n(input, "days") ?? 30 })) };
          case "agent_performance":
            return { content: json(await agentPerformance(ctx, validMonth)) };
          case "cost":
            return { content: json(await costReport(ctx, validMonth)) };
          default:
            return { content: json(await bookingsReport(ctx)) };
        }
      }
      case "create_lead": {
        const result = await createRecord(ctx, actor, "leads", {
          contactName: s(input, "contactName"),
          contactPhone: s(input, "contactPhone"),
          contactEmail: s(input, "contactEmail"),
          channel: s(input, "channel"),
          stage: "NEW_LEAD",
          summary: s(input, "summary"),
          customerId: s(input, "customerId"),
          interestedProductId: s(input, "interestedProductId"),
          paxAdults: n(input, "paxAdults"),
          paxChildren: n(input, "paxChildren"),
        }, { acknowledgeDuplicates: true, contextRefs: refs });
        return { content: `أُنشئ العميل المحتمل ${result.businessId} (معرّف ${result.id}) بمرحلة NEW_LEAD.` };
      }
      case "update_lead_stage": {
        const leadId = id(ctx, "leads", s(input, "leadId"));
        if (!leadId) return { content: "leadId غير صالح", isError: true };
        await changeLeadStage(ctx, actor, leadId, s(input, "stage") as V.LeadStage, { lostReason: s(input, "lostReason"), note: s(input, "note") });
        return { content: `حُدّثت مرحلة العميل المحتمل إلى ${s(input, "stage")}.` };
      }
      case "create_quote_draft": {
        const leadId = id(ctx, "leads", s(input, "leadId"));
        const productId = id(ctx, "products", s(input, "productId"));
        if (!leadId || !productId) return { content: "leadId/productId غير صالح", isError: true };
        const result = await createQuoteDraft(ctx, actor, { leadId, productId, pax: n(input, "pax") ?? 1, discountPercent: n(input, "discountPercent"), validDays: n(input, "validDays") });
        return { content: json({ quote: result.businessId, quoteId: result.id, warnings: result.warnings, note: result.warnings.length ? "يجب إبلاغ المالك بهذه التحذيرات قبل الإرسال" : "لا تحذيرات" }) };
      }
      case "update_customer_note": {
        const customerId = id(ctx, "customers", s(input, "customerId"));
        if (!customerId) return { content: "customerId غير صالح", isError: true };
        const existing = await getRecord(ctx, actor, "customers", customerId, refs);
        if (!existing) return { content: "العميل غير موجود أو خارج نطاق المهمة", isError: true };
        const stamp = new Date().toISOString().slice(0, 10);
        const notes = `${existing.notes ? `${existing.notes}\n` : ""}[${stamp} ${agent.slug}] ${s(input, "note") ?? ""}`.slice(-4000);
        await updateRecord(ctx, actor, "customers", customerId, { notes }, { contextRefs: refs, reason: "customer_stated" });
        return { content: "أُضيفت الملاحظة إلى سجل العميل." };
      }
      case "escalate_to_executive": {
        const customerId = id(ctx, "customers", s(input, "customerId"));
        const subtaskId = await createTask(ctx, {
          title: `تصعيد من ${agent.slug}: ${(s(input, "summary") ?? "").slice(0, 60)}`,
          request: `تصعيد من الوكيل ${agent.slug} (المهمة ${task.businessId}):\n${s(input, "summary")}\n\nقيّم الحالة، واطلب قرار المالك عبر request_owner_decision إن لزم.`,
          origin: task.origin,
          agentSlug: "executive",
          requestedBy: actor,
          conversationId: task.conversationId,
          priority: (s(input, "urgency") as Doc<"tasks">["priority"]) ?? "HIGH",
          contextRefs: { ...refs, customerIds: customerId ? [...new Set([...refs.customerIds, customerId])] : refs.customerIds },
        });
        const sub = await ctx.db.get(subtaskId);
        return { content: `صُعّدت الحالة إلى الوكيل التنفيذي في المهمة ${sub?.businessId}.` };
      }
      case "propose_memory": {
        const subjectTable = s(input, "subjectTable");
        const subjectId = s(input, "subjectId");
        await proposeMemory(ctx, actor, {
          type: s(input, "type") as Doc<"memories">["type"],
          origin: s(input, "origin") as Doc<"memories">["origin"],
          agentSlug: agent.slug,
          content: s(input, "content") ?? "",
          subject: subjectTable && subjectId ? { table: subjectTable, recordId: subjectId } : undefined,
          confidence: n(input, "confidence"),
          taskId: task._id,
        });
        return { content: "سُجّل الاقتراح بحالة PROPOSED بانتظار مراجعة المالك." };
      }
      case "record_knowledge_gap":
        await recordKnowledgeGap(ctx, agent.slug, s(input, "question") ?? "", task._id);
        return { content: "سُجّلت فجوة المعرفة." };
      case "record_data_conflict": {
        const rawCandidates = Array.isArray(input.candidates) ? (input.candidates as Record<string, unknown>[]) : [];
        const candidates = rawCandidates.map((c) => ({
          value: c.value,
          source: { kind: (V.isOneOf(V.SOURCE_KINDS, c.sourceKind) ? c.sourceKind : "ai") as Doc<"dataConflicts">["candidates"][number]["source"]["kind"], ref: typeof c.sourceRef === "string" ? c.sourceRef : undefined },
          trustLevel: (V.isOneOf(V.TRUST_LEVELS, c.trustLevel) ? c.trustLevel : "E_AI_ESTIMATE") as V.TrustLevel,
          observedAt: typeof c.observedAt === "string" && !Number.isNaN(Date.parse(c.observedAt)) ? Date.parse(c.observedAt) : Date.now(),
          contractual: typeof c.contractual === "boolean" ? c.contractual : undefined,
        }));
        const result = await recordConflict(ctx, actor, { table: s(input, "table") ?? "", recordId: s(input, "recordId"), field: s(input, "field") ?? "", candidates, taskId: task._id });
        return { content: result.resolved ? `حُسم التعارض بقاعدة ${result.rule}: القيمة المعتمدة ${json(result.value)}` : "لم يُحسم التعارض تلقائياً؛ صُعّد إلى المالك." };
      }
      case "schedule_content": {
        const platform = s(input, "platform");
        if (!V.isOneOf(V.CONTENT_PLATFORMS, platform)) return { content: "platform غير معياري", isError: true };
        const scheduledAt = ts(input, "scheduledAt");
        if (!scheduledAt) return { content: "scheduledAt غير صالح", isError: true };
        const result = await scheduleContent(ctx, actor, agent.slug, {
          platform,
          caption: s(input, "caption") ?? "",
          captionEn: s(input, "captionEn"),
          hashtags: list(input, "hashtags"),
          visualIdea: s(input, "visualIdea"),
          scheduledAt,
          productId: id(ctx, "products", s(input, "productId")),
          campaignId: id(ctx, "campaigns", s(input, "campaignId")),
        });
        return { content: `أُضيف المنشور ${result.businessId} إلى تقويم النشر بانتظار اعتماد المالك.`, approvalId: result.approvalId };
      }
      case "propose_reply": {
        const interactionId = id(ctx, "interactions", s(input, "interactionId"));
        if (!interactionId) return { content: "interactionId غير صالح", isError: true };
        const outcome = await proposeReply(ctx, task, agent, {
          interactionId,
          kind: s(input, "kind"),
          confidence: n(input, "confidence"),
          reply: s(input, "reply") ?? "",
          faq: input.faq === true,
          estimatedBookingValueOmr: n(input, "estimatedBookingValueOmr"),
        });
        return { content: outcome.content, isError: outcome.isError, approvalId: outcome.approvalId };
      }
      // -------------------------------------------------------------- external
      case "send_customer_message": {
        const customerId = id(ctx, "customers", s(input, "customerId"));
        if (!customerId) return { content: "customerId غير صالح", isError: true };
        const customer = await getRecord(ctx, actor, "customers", customerId, refs);
        if (!customer) return { content: "العميل غير موجود أو خارج نطاق المهمة", isError: true };
        if (customer.consentStatus !== "GRANTED") return { content: `لا يمكن مراسلة العميل: حالة الموافقة ${String(customer.consentStatus)}`, isError: true };
        const channel = s(input, "channel");
        if (!V.isOneOf(V.CHANNELS, channel)) return { content: "channel غير معياري", isError: true };
        const { approvalId, autoApproved } = await createApproval(ctx, actor, {
          kind: "SEND_CUSTOMER_MESSAGE",
          agentSlug: agent.slug,
          taskId: task._id,
          title: `رسالة إلى ${String(customer.fullName)} عبر ${channel}`,
          summary: `${s(input, "purpose") ?? ""}: ${(s(input, "message") ?? "").slice(0, 200)}`,
          payload: { customerId, channel, message: s(input, "message"), purpose: s(input, "purpose") },
          toolName: "send_customer_message",
          targetTable: "customers",
          targetRecordId: customerId,
          severity: "D3",
        });
        return { content: autoApproved ? "اعتُمدت الرسالة تلقائياً وفق قاعدة المالك وستُرسل." : "أُنشئ طلب اعتماد للرسالة؛ لن تُرسل قبل موافقة المالك.", approvalId };
      }
      case "send_quote": {
        const quoteId = id(ctx, "quotes", s(input, "quoteId"));
        if (!quoteId) return { content: "quoteId غير صالح", isError: true };
        const quote = await ctx.db.get(quoteId);
        if (!quote) return { content: "العرض غير موجود", isError: true };
        if (quote.status !== "DRAFT" && quote.status !== "APPROVED") return { content: `العرض في حالة ${quote.status}`, isError: true };
        const channel = s(input, "channel");
        if (!V.isOneOf(V.CHANNELS, channel)) return { content: "channel غير معياري", isError: true };
        await ctx.db.patch(quoteId, { status: "PENDING_APPROVAL", updatedAt: Date.now(), updatedBy: actor });
        const { approvalId } = await createApproval(ctx, actor, {
          kind: "SEND_QUOTE",
          agentSlug: agent.slug,
          taskId: task._id,
          title: `إرسال العرض ${quote.businessId}`,
          summary: `${quote.priceWarnings.length ? `تحذيرات: ${quote.priceWarnings.join("؛ ")}. ` : ""}${(s(input, "message") ?? "").slice(0, 200)}`,
          payload: { quoteId, channel, message: s(input, "message"), totals: quote.totals, priceWarnings: quote.priceWarnings, productVersion: quote.productVersion, leadId: quote.leadId },
          toolName: "send_quote",
          targetTable: "quotes",
          targetRecordId: quoteId,
          severity: quote.priceWarnings.length ? "D4" : "D3",
        });
        await ctx.db.patch(quoteId, { approvalId });
        return { content: "أُنشئ طلب اعتماد لإرسال العرض؛ لن يُرسل قبل موافقة المالك.", approvalId };
      }
      default:
        return { content: `الأداة ${toolName} غير منفذة`, isError: true };
    }
  } catch (e) {
    return { content: `خطأ في الأداة ${toolName}: ${errorMessage(e)}`, isError: true };
  }
}

export function assertToolKnown(name: string) {
  if (!TOOLS_BY_NAME.has(name)) throw appError("NOT_FOUND", `أداة غير معروفة: ${name}`);
}
