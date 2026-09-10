/**
 * Entity definitions shared by the server (validation, defaults) and the UI
 * (schema-driven forms). This is the runtime companion of docs/DATA_DICTIONARY.md:
 * every manually editable master table is described once here.
 */
import * as V from "../convex/lib/vocab";

export type FieldType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "boolean"
  | "enum"
  | "date"
  | "money"
  | "ref"
  | "tags"
  | "email"
  | "phone"
  | "percent";

export interface FieldDef {
  name: string;
  labelAr: string;
  labelEn: string;
  type: FieldType;
  required?: boolean;
  options?: readonly string[];
  refTable?: EntityKey;
  min?: number;
  max?: number;
  /** Shown only to owners; stored STRICTLY_CONFIDENTIAL. */
  sensitive?: boolean;
  /** Hidden from the create form (computed/managed by the system). */
  readOnly?: boolean;
  helpAr?: string;
  section?: string;
}

export interface EntityDef {
  key: EntityKey;
  table: string;
  labelAr: string;
  labelEn: string;
  singularAr: string;
  domain: V.Domain;
  dataOwnerAgent: V.AgentSlug;
  defaultClassification: V.Classification;
  /** Field used as the list title. */
  titleField: string;
  /** Field holding the controlled lifecycle/status. */
  statusField: string;
  statusOptions: readonly string[];
  fields: FieldDef[];
  /** Duplicate detection strategy applied before create. */
  duplicateCheck?: "customer" | "supplier" | "hotel" | "booking" | "name";
  /** Whether the record carries validity fields (validFrom/validTo/freshness). */
  hasValidity?: boolean;
  /** Whether the record carries version fields. */
  hasVersion?: boolean;
  /** Extra guidance shown above the form. */
  hintAr?: string;
}

export type EntityKey =
  | "customers"
  | "suppliers"
  | "hotels"
  | "destinations"
  | "attractions"
  | "experiences"
  | "rates"
  | "products"
  | "bookings"
  | "leads"
  | "pricingRules"
  | "policies"
  | "decisionRegister";

const base = (overrides: Partial<FieldDef> & Pick<FieldDef, "name" | "labelAr" | "labelEn" | "type">): FieldDef => overrides;

export const ENTITIES: Record<EntityKey, EntityDef> = {
  customers: {
    key: "customers",
    table: "customers",
    labelAr: "العملاء",
    labelEn: "Customers",
    singularAr: "عميل",
    domain: "CUSTOMER",
    dataOwnerAgent: "support",
    defaultClassification: "CUSTOMER_CONFIDENTIAL",
    titleField: "fullName",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    duplicateCheck: "customer",
    hintAr: "الحد الأدنى من البيانات فقط. الجنسية وبيانات الهوية تُخزَّن عند الحاجة التشغيلية فقط وبتصنيف سري للغاية.",
    fields: [
      base({ name: "fullName", labelAr: "الاسم الكامل", labelEn: "Full name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "customerType", labelAr: "نوع العميل", labelEn: "Customer type", type: "enum", options: V.CUSTOMER_TYPES, required: true }),
      base({ name: "phone", labelAr: "الهاتف", labelEn: "Phone", type: "phone" }),
      base({ name: "email", labelAr: "البريد الإلكتروني", labelEn: "Email", type: "email" }),
      base({ name: "preferredLanguage", labelAr: "اللغة المفضلة", labelEn: "Preferred language", type: "enum", options: V.LANGUAGES, required: true }),
      base({ name: "preferredChannel", labelAr: "قناة التواصل المفضلة", labelEn: "Preferred channel", type: "enum", options: V.CHANNELS }),
      base({ name: "city", labelAr: "المدينة", labelEn: "City", type: "text", max: 80 }),
      base({ name: "consentStatus", labelAr: "حالة الموافقة على التواصل", labelEn: "Consent status", type: "enum", options: V.CONSENT_STATUSES, required: true }),
      base({ name: "nationality", labelAr: "الجنسية (سري للغاية)", labelEn: "Nationality", type: "text", sensitive: true, max: 60 }),
      base({ name: "idDocumentRef", labelAr: "مرجع وثيقة الهوية (سري للغاية)", labelEn: "ID document ref", type: "text", sensitive: true, max: 60 }),
      base({ name: "tags", labelAr: "وسوم", labelEn: "Tags", type: "tags" }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  suppliers: {
    key: "suppliers",
    table: "suppliers",
    labelAr: "الموردون",
    labelEn: "Suppliers",
    singularAr: "مورد",
    domain: "SUPPLIER_CONTRACT",
    dataOwnerAgent: "product",
    defaultClassification: "CONFIDENTIAL",
    titleField: "name",
    statusField: "status",
    statusOptions: V.SUPPLIER_STATUSES,
    duplicateCheck: "supplier",
    fields: [
      base({ name: "name", labelAr: "اسم المورد", labelEn: "Name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", max: 120 }),
      base({ name: "supplierType", labelAr: "نوع المورد", labelEn: "Supplier type", type: "enum", options: V.SUPPLIER_TYPES, required: true }),
      base({ name: "status", labelAr: "حالة المورد", labelEn: "Status", type: "enum", options: V.SUPPLIER_STATUSES, required: true }),
      base({ name: "contactName", labelAr: "اسم جهة الاتصال", labelEn: "Contact name", type: "text", max: 120 }),
      base({ name: "phone", labelAr: "الهاتف", labelEn: "Phone", type: "phone" }),
      base({ name: "email", labelAr: "البريد الإلكتروني", labelEn: "Email", type: "email" }),
      base({ name: "website", labelAr: "الموقع الإلكتروني", labelEn: "Website", type: "text", max: 200 }),
      base({ name: "city", labelAr: "المدينة", labelEn: "City", type: "text", max: 80 }),
      base({ name: "paymentTerms", labelAr: "شروط الدفع", labelEn: "Payment terms", type: "text", max: 300 }),
      base({ name: "bankAccountRef", labelAr: "مرجع الحساب البنكي (آخر 4 أرقام فقط — D4)", labelEn: "Bank account ref", type: "text", sensitive: true, max: 40 }),
      base({ name: "tags", labelAr: "وسوم", labelEn: "Tags", type: "tags" }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  hotels: {
    key: "hotels",
    table: "hotels",
    labelAr: "الفنادق",
    labelEn: "Hotels",
    singularAr: "فندق",
    domain: "SUPPLIER_CONTRACT",
    dataOwnerAgent: "product",
    defaultClassification: "INTERNAL",
    titleField: "name",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    duplicateCheck: "hotel",
    fields: [
      base({ name: "name", labelAr: "اسم الفندق", labelEn: "Name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", max: 120 }),
      base({ name: "destinationId", labelAr: "الوجهة", labelEn: "Destination", type: "ref", refTable: "destinations", required: true }),
      base({ name: "supplierId", labelAr: "المورد", labelEn: "Supplier", type: "ref", refTable: "suppliers" }),
      base({ name: "category", labelAr: "التصنيف", labelEn: "Category", type: "enum", options: V.HOTEL_CATEGORIES, required: true }),
      base({ name: "address", labelAr: "العنوان", labelEn: "Address", type: "text", max: 200 }),
      base({ name: "amenities", labelAr: "المرافق", labelEn: "Amenities", type: "tags" }),
      base({ name: "childPolicy", labelAr: "سياسة الأطفال", labelEn: "Child policy", type: "textarea", max: 500 }),
      base({ name: "checkInTime", labelAr: "وقت الدخول", labelEn: "Check-in", type: "text", max: 10 }),
      base({ name: "checkOutTime", labelAr: "وقت الخروج", labelEn: "Check-out", type: "text", max: 10 }),
      base({ name: "phone", labelAr: "الهاتف", labelEn: "Phone", type: "phone" }),
      base({ name: "email", labelAr: "البريد الإلكتروني", labelEn: "Email", type: "email" }),
      base({ name: "website", labelAr: "الموقع الإلكتروني", labelEn: "Website", type: "text", max: 200 }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  destinations: {
    key: "destinations",
    table: "destinations",
    labelAr: "الوجهات",
    labelEn: "Destinations",
    singularAr: "وجهة",
    domain: "DESTINATION_EXPERIENCE",
    dataOwnerAgent: "product",
    defaultClassification: "PUBLIC",
    titleField: "name",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    duplicateCheck: "name",
    fields: [
      base({ name: "name", labelAr: "الاسم", labelEn: "Name", type: "text", required: true, min: 2, max: 100 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", required: true, max: 100 }),
      base({ name: "kind", labelAr: "النوع", labelEn: "Kind", type: "enum", options: V.DESTINATION_KINDS, required: true }),
      base({ name: "governorate", labelAr: "المحافظة", labelEn: "Governorate", type: "text", max: 80 }),
      base({ name: "description", labelAr: "الوصف", labelEn: "Description", type: "textarea", max: 3000 }),
      base({ name: "bestSeasons", labelAr: "أفضل المواسم", labelEn: "Best seasons", type: "tags", options: V.SEASONS }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  attractions: {
    key: "attractions",
    table: "attractions",
    labelAr: "المعالم",
    labelEn: "Attractions",
    singularAr: "معلم",
    domain: "DESTINATION_EXPERIENCE",
    dataOwnerAgent: "product",
    defaultClassification: "PUBLIC",
    titleField: "name",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    duplicateCheck: "name",
    fields: [
      base({ name: "name", labelAr: "الاسم", labelEn: "Name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", max: 120 }),
      base({ name: "destinationId", labelAr: "الوجهة", labelEn: "Destination", type: "ref", refTable: "destinations", required: true }),
      base({ name: "category", labelAr: "الفئة", labelEn: "Category", type: "text", max: 60 }),
      base({ name: "description", labelAr: "الوصف", labelEn: "Description", type: "textarea", max: 3000 }),
      base({ name: "visitDurationMinutes", labelAr: "مدة الزيارة (دقائق)", labelEn: "Visit duration (min)", type: "integer", min: 0, max: 1440 }),
      base({ name: "entryFee", labelAr: "رسم الدخول", labelEn: "Entry fee", type: "money" }),
      base({ name: "openingHours", labelAr: "ساعات العمل", labelEn: "Opening hours", type: "text", max: 120 }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  experiences: {
    key: "experiences",
    table: "experiences",
    labelAr: "التجارب",
    labelEn: "Experiences",
    singularAr: "تجربة",
    domain: "DESTINATION_EXPERIENCE",
    dataOwnerAgent: "product",
    defaultClassification: "PUBLIC",
    titleField: "name",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    duplicateCheck: "name",
    fields: [
      base({ name: "name", labelAr: "الاسم", labelEn: "Name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", max: 120 }),
      base({ name: "destinationId", labelAr: "الوجهة", labelEn: "Destination", type: "ref", refTable: "destinations" }),
      base({ name: "supplierId", labelAr: "المورد المشغّل", labelEn: "Operator", type: "ref", refTable: "suppliers" }),
      base({ name: "description", labelAr: "الوصف", labelEn: "Description", type: "textarea", max: 3000 }),
      base({ name: "durationHours", labelAr: "المدة (ساعات)", labelEn: "Duration (hours)", type: "number", min: 0, max: 240 }),
      base({ name: "difficulty", labelAr: "الصعوبة", labelEn: "Difficulty", type: "enum", options: V.DIFFICULTY_LEVELS }),
      base({ name: "minPax", labelAr: "الحد الأدنى للأفراد", labelEn: "Min pax", type: "integer", min: 1 }),
      base({ name: "maxPax", labelAr: "الحد الأقصى للأفراد", labelEn: "Max pax", type: "integer", min: 1 }),
      base({ name: "seasons", labelAr: "المواسم", labelEn: "Seasons", type: "tags", options: V.SEASONS }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  rates: {
    key: "rates",
    table: "rates",
    labelAr: "الأسعار",
    labelEn: "Rates",
    singularAr: "سعر",
    domain: "RATES_COMMERCIAL",
    dataOwnerAgent: "product",
    defaultClassification: "CONFIDENTIAL",
    titleField: "serviceDescription",
    statusField: "status",
    statusOptions: V.RATE_STATUSES,
    hasValidity: true,
    hasVersion: true,
    hintAr: "الأسعار المُدخلة يدوياً تُوسم موثوقة من الشركة. أي سعر مصدره بحث الوكلاء يُسجَّل تلقائياً كـ ESTIMATED ولا يُستخدم في عرض للعميل دون اعتمادك.",
    fields: [
      base({ name: "supplierId", labelAr: "المورد", labelEn: "Supplier", type: "ref", refTable: "suppliers", required: true }),
      base({ name: "hotelId", labelAr: "الفندق", labelEn: "Hotel", type: "ref", refTable: "hotels" }),
      base({ name: "experienceId", labelAr: "التجربة", labelEn: "Experience", type: "ref", refTable: "experiences" }),
      base({ name: "componentType", labelAr: "نوع المكوّن", labelEn: "Component type", type: "enum", options: V.COMPONENT_TYPES, required: true }),
      base({ name: "serviceType", labelAr: "رمز الخدمة", labelEn: "Service type code", type: "text", required: true, max: 40, helpAr: "من البيانات المرجعية refServiceTypes مثل HOTEL_ROOM أو VEHICLE_4X4" }),
      base({ name: "serviceDescription", labelAr: "وصف الخدمة", labelEn: "Service description", type: "text", required: true, max: 200 }),
      base({ name: "roomType", labelAr: "نوع الغرفة", labelEn: "Room type", type: "text", max: 60 }),
      base({ name: "rateBasis", labelAr: "أساس السعر", labelEn: "Rate basis", type: "enum", options: V.RATE_BASES, required: true }),
      base({ name: "amount", labelAr: "المبلغ", labelEn: "Amount", type: "money", required: true }),
      base({ name: "season", labelAr: "الموسم", labelEn: "Season", type: "enum", options: V.SEASONS, required: true }),
      base({ name: "validFrom", labelAr: "ساري من", labelEn: "Valid from", type: "date", required: true }),
      base({ name: "validTo", labelAr: "ساري حتى", labelEn: "Valid to", type: "date", required: true }),
      base({ name: "taxesIncluded", labelAr: "الضرائب والرسوم مشمولة", labelEn: "Taxes included", type: "boolean" }),
      base({ name: "taxesPercent", labelAr: "نسبة الضرائب والرسوم %", labelEn: "Taxes %", type: "percent", min: 0, max: 100 }),
      base({ name: "cancellationTerms", labelAr: "شروط الإلغاء", labelEn: "Cancellation terms", type: "textarea", required: true, max: 1000 }),
      base({ name: "rateTrust", labelAr: "مستوى ثقة السعر", labelEn: "Rate trust", type: "enum", options: V.RATE_TRUSTS, required: true }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RATE_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  products: {
    key: "products",
    table: "products",
    labelAr: "المنتجات والباقات",
    labelEn: "Products",
    singularAr: "منتج",
    domain: "TOURISM_PRODUCT",
    dataOwnerAgent: "product",
    defaultClassification: "INTERNAL",
    titleField: "name",
    statusField: "status",
    statusOptions: V.PRODUCT_LIFECYCLE,
    hasValidity: true,
    hasVersion: true,
    hintAr: "الهامش يُحسب تلقائياً من حقول التسعير الخمسة ولا يُدخل يدوياً. لا يُباع منتج إلا بحالة ACTIVE وإصدار معتمد.",
    fields: [
      base({ name: "name", labelAr: "اسم المنتج", labelEn: "Name", type: "text", required: true, min: 3, max: 140 }),
      base({ name: "nameEn", labelAr: "الاسم بالإنجليزية", labelEn: "Name (EN)", type: "text", max: 140 }),
      base({ name: "productType", labelAr: "نوع المنتج", labelEn: "Product type", type: "enum", options: V.PRODUCT_TYPES, required: true }),
      base({ name: "status", labelAr: "مرحلة دورة الحياة", labelEn: "Lifecycle", type: "enum", options: V.PRODUCT_LIFECYCLE, required: true }),
      base({ name: "destinationIds", labelAr: "الوجهات", labelEn: "Destinations", type: "tags", refTable: "destinations" }),
      base({ name: "durationDays", labelAr: "عدد الأيام", labelEn: "Days", type: "integer", required: true, min: 1, max: 60 }),
      base({ name: "durationNights", labelAr: "عدد الليالي", labelEn: "Nights", type: "integer", required: true, min: 0, max: 60 }),
      base({ name: "summary", labelAr: "ملخص", labelEn: "Summary", type: "textarea", required: true, max: 3000 }),
      base({ name: "highlights", labelAr: "أبرز المعالم", labelEn: "Highlights", type: "tags" }),
      base({ name: "inclusions", labelAr: "يشمل", labelEn: "Inclusions", type: "tags" }),
      base({ name: "exclusions", labelAr: "لا يشمل", labelEn: "Exclusions", type: "tags" }),
      base({ name: "terms", labelAr: "الشروط", labelEn: "Terms", type: "textarea", max: 3000 }),
      base({ name: "supplierCost", labelAr: "تكلفة الموردين (للفرد)", labelEn: "Supplier cost", type: "money", section: "pricing" }),
      base({ name: "internalCost", labelAr: "التكلفة الداخلية (للفرد)", labelEn: "Internal cost", type: "money", section: "pricing" }),
      base({ name: "minSellingPrice", labelAr: "الحد الأدنى لسعر البيع", labelEn: "Min selling price", type: "money", section: "pricing" }),
      base({ name: "recommendedSellingPrice", labelAr: "سعر البيع المقترح", labelEn: "Recommended price", type: "money", section: "pricing" }),
      base({ name: "customerSellingPrice", labelAr: "سعر البيع للعميل", labelEn: "Customer price", type: "money", section: "pricing" }),
      base({ name: "targetMarginPercent", labelAr: "الهامش المستهدف %", labelEn: "Target margin %", type: "percent", min: 0, max: 100 }),
      base({ name: "minPax", labelAr: "الحد الأدنى للأفراد", labelEn: "Min pax", type: "integer", min: 1 }),
      base({ name: "maxPax", labelAr: "الحد الأقصى للأفراد", labelEn: "Max pax", type: "integer", min: 1 }),
      base({ name: "seasons", labelAr: "المواسم", labelEn: "Seasons", type: "tags", options: V.SEASONS }),
      base({ name: "validFrom", labelAr: "ساري من", labelEn: "Valid from", type: "date" }),
      base({ name: "validTo", labelAr: "ساري حتى", labelEn: "Valid to", type: "date" }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  bookings: {
    key: "bookings",
    table: "bookings",
    labelAr: "الحجوزات",
    labelEn: "Bookings",
    singularAr: "حجز",
    domain: "BOOKING_OPERATIONS",
    dataOwnerAgent: "support",
    defaultClassification: "CUSTOMER_CONFIDENTIAL",
    titleField: "businessId",
    statusField: "status",
    statusOptions: V.BOOKING_STATUSES,
    duplicateCheck: "booking",
    hintAr: "لا تصبح خدمة الحجز مؤكدة دون سجل دليل تأكيد من المورد (المرجع، التاريخ، السعر المؤكد، شروط الإلغاء).",
    fields: [
      base({ name: "customerId", labelAr: "العميل", labelEn: "Customer", type: "ref", refTable: "customers", required: true }),
      base({ name: "leadId", labelAr: "العميل المحتمل", labelEn: "Lead", type: "ref", refTable: "leads" }),
      base({ name: "productId", labelAr: "المنتج", labelEn: "Product", type: "ref", refTable: "products" }),
      base({ name: "status", labelAr: "حالة الحجز", labelEn: "Status", type: "enum", options: V.BOOKING_STATUSES, required: true }),
      base({ name: "paymentStatus", labelAr: "حالة الدفع", labelEn: "Payment status", type: "enum", options: V.PAYMENT_STATUSES, required: true }),
      base({ name: "travelDateFrom", labelAr: "تاريخ بداية الرحلة", labelEn: "Travel from", type: "date", required: true }),
      base({ name: "travelDateTo", labelAr: "تاريخ نهاية الرحلة", labelEn: "Travel to", type: "date", required: true }),
      base({ name: "paxAdults", labelAr: "عدد البالغين", labelEn: "Adults", type: "integer", required: true, min: 1, max: 200 }),
      base({ name: "paxChildren", labelAr: "عدد الأطفال", labelEn: "Children", type: "integer", required: true, min: 0, max: 200 }),
      base({ name: "totalSellingPrice", labelAr: "إجمالي سعر البيع", labelEn: "Total selling price", type: "money", required: true }),
      base({ name: "totalSupplierCost", labelAr: "إجمالي تكلفة الموردين", labelEn: "Total supplier cost", type: "money" }),
      base({ name: "specialRequests", labelAr: "طلبات خاصة", labelEn: "Special requests", type: "textarea", max: 2000 }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  leads: {
    key: "leads",
    table: "leads",
    labelAr: "العملاء المحتملون",
    labelEn: "Leads",
    singularAr: "عميل محتمل",
    domain: "SALES_CRM",
    dataOwnerAgent: "sales",
    defaultClassification: "CUSTOMER_CONFIDENTIAL",
    titleField: "contactName",
    statusField: "stage",
    statusOptions: V.LEAD_STAGES,
    hintAr: "عند اختيار المرحلة LOST يلزم تحديد سبب الخسارة من القائمة المعيارية.",
    fields: [
      base({ name: "contactName", labelAr: "اسم جهة الاتصال", labelEn: "Contact name", type: "text", required: true, min: 2, max: 120 }),
      base({ name: "contactPhone", labelAr: "الهاتف", labelEn: "Phone", type: "phone" }),
      base({ name: "contactEmail", labelAr: "البريد الإلكتروني", labelEn: "Email", type: "email" }),
      base({ name: "customerId", labelAr: "سجل العميل", labelEn: "Customer", type: "ref", refTable: "customers" }),
      base({ name: "channel", labelAr: "المصدر/القناة", labelEn: "Channel", type: "enum", options: V.CHANNELS, required: true }),
      base({ name: "stage", labelAr: "المرحلة", labelEn: "Stage", type: "enum", options: V.LEAD_STAGES, required: true }),
      base({ name: "lostReason", labelAr: "سبب الخسارة", labelEn: "Lost reason", type: "enum", options: V.LOST_REASONS }),
      base({ name: "interestedProductId", labelAr: "المنتج المهتم به", labelEn: "Interested product", type: "ref", refTable: "products" }),
      base({ name: "expectedValue", labelAr: "القيمة المتوقعة", labelEn: "Expected value", type: "money" }),
      base({ name: "travelDateFrom", labelAr: "تاريخ السفر المتوقع من", labelEn: "Travel from", type: "date" }),
      base({ name: "travelDateTo", labelAr: "إلى", labelEn: "Travel to", type: "date" }),
      base({ name: "paxAdults", labelAr: "عدد البالغين", labelEn: "Adults", type: "integer", min: 0 }),
      base({ name: "paxChildren", labelAr: "عدد الأطفال", labelEn: "Children", type: "integer", min: 0 }),
      base({ name: "nextFollowUpAt", labelAr: "المتابعة القادمة", labelEn: "Next follow-up", type: "date" }),
      base({ name: "summary", labelAr: "ملخص الطلب", labelEn: "Summary", type: "textarea", max: 2000 }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 2000 }),
    ],
  },
  pricingRules: {
    key: "pricingRules",
    table: "pricingRules",
    labelAr: "قواعد التسعير",
    labelEn: "Pricing rules",
    singularAr: "قاعدة تسعير",
    domain: "RATES_COMMERCIAL",
    dataOwnerAgent: "product",
    defaultClassification: "CONFIDENTIAL",
    titleField: "name",
    statusField: "status",
    statusOptions: V.RECORD_STATUSES,
    hasValidity: true,
    fields: [
      base({ name: "name", labelAr: "اسم القاعدة", labelEn: "Name", type: "text", required: true, max: 120 }),
      base({ name: "kind", labelAr: "النوع", labelEn: "Kind", type: "enum", options: V.PRICING_RULE_KINDS, required: true }),
      base({ name: "value", labelAr: "القيمة", labelEn: "Value", type: "number", required: true }),
      base({ name: "unit", labelAr: "الوحدة", labelEn: "Unit", type: "enum", options: ["PERCENT", "OMR"], required: true }),
      base({ name: "priority", labelAr: "الأولوية", labelEn: "Priority", type: "integer", required: true, min: 0, max: 100 }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.RECORD_STATUSES, required: true }),
      base({ name: "validFrom", labelAr: "ساري من", labelEn: "Valid from", type: "date" }),
      base({ name: "validTo", labelAr: "ساري حتى", labelEn: "Valid to", type: "date" }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 1000 }),
    ],
  },
  policies: {
    key: "policies",
    table: "policies",
    labelAr: "السياسات",
    labelEn: "Policies",
    singularAr: "سياسة",
    domain: "CORPORATE_HR_ADMIN",
    dataOwnerAgent: "executive",
    defaultClassification: "INTERNAL",
    titleField: "title",
    statusField: "lifecycle",
    statusOptions: V.DOCUMENT_LIFECYCLE,
    hasValidity: true,
    hasVersion: true,
    fields: [
      base({ name: "title", labelAr: "عنوان السياسة", labelEn: "Title", type: "text", required: true, max: 160 }),
      base({ name: "category", labelAr: "الفئة", labelEn: "Category", type: "enum", options: V.POLICY_CATEGORIES, required: true }),
      base({ name: "summary", labelAr: "ملخص", labelEn: "Summary", type: "textarea", required: true, max: 1000 }),
      base({ name: "body", labelAr: "نص السياسة", labelEn: "Body", type: "textarea", required: true, max: 20000 }),
      base({ name: "lifecycle", labelAr: "الحالة", labelEn: "Lifecycle", type: "enum", options: V.DOCUMENT_LIFECYCLE, required: true }),
      base({ name: "appliesToAgents", labelAr: "تنطبق على الوكلاء", labelEn: "Applies to agents", type: "tags", options: V.AGENT_SLUGS }),
      base({ name: "validFrom", labelAr: "نافذة من", labelEn: "Effective from", type: "date" }),
      base({ name: "validTo", labelAr: "نافذة حتى", labelEn: "Effective to", type: "date" }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 1000 }),
    ],
  },
  decisionRegister: {
    key: "decisionRegister",
    table: "decisionRegister",
    labelAr: "سجل القرارات",
    labelEn: "Decision register",
    singularAr: "قرار",
    domain: "CORPORATE_HR_ADMIN",
    dataOwnerAgent: "executive",
    defaultClassification: "INTERNAL",
    titleField: "title",
    statusField: "status",
    statusOptions: V.DECISION_STATUSES,
    fields: [
      base({ name: "title", labelAr: "عنوان القرار", labelEn: "Title", type: "text", required: true, max: 160 }),
      base({ name: "kind", labelAr: "نوع القرار", labelEn: "Kind", type: "enum", options: V.DECISION_KINDS, required: true }),
      base({ name: "description", labelAr: "الوصف", labelEn: "Description", type: "textarea", required: true, max: 4000 }),
      base({ name: "reason", labelAr: "السبب", labelEn: "Reason", type: "textarea", required: true, max: 2000 }),
      base({ name: "effectiveFrom", labelAr: "نافذ من", labelEn: "Effective from", type: "date", required: true }),
      base({ name: "effectiveTo", labelAr: "ينتهي في", labelEn: "Effective to", type: "date" }),
      base({ name: "scopeAgent", labelAr: "نطاق: الوكيل", labelEn: "Scope: agent", type: "enum", options: V.AGENT_SLUGS }),
      base({ name: "scopeDomain", labelAr: "نطاق: المجال", labelEn: "Scope: domain", type: "enum", options: V.DOMAINS }),
      base({ name: "status", labelAr: "الحالة", labelEn: "Status", type: "enum", options: V.DECISION_STATUSES, required: true }),
      base({ name: "notes", labelAr: "ملاحظات", labelEn: "Notes", type: "textarea", max: 1000 }),
    ],
  },
};

export const ENTITY_KEYS = Object.keys(ENTITIES) as EntityKey[];

export function entityDef(key: string): EntityDef {
  const def = ENTITIES[key as EntityKey];
  if (!def) throw new Error(`UNKNOWN_ENTITY:${key}`);
  return def;
}
