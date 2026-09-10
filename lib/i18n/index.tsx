"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ar, type Dictionary } from "./ar";
import { en } from "./en";

export type Locale = "ar" | "en";

const DICTS: Record<Locale, Dictionary> = { ar, en };
const STORAGE_KEY = "ops-center-locale";

interface LocaleContextValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  t: Dictionary;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue>({ locale: "ar", dir: "rtl", t: ar, setLocale: () => {} });

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ar");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "ar") setLocaleState(stored);
    } catch {
      // storage unavailable
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo<LocaleContextValue>(() => ({ locale, dir: locale === "ar" ? "rtl" : "ltr", t: DICTS[locale], setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  return useContext(LocaleContext);
}

/** Arabic labels for controlled-vocabulary values shown in the UI. */
export const VOCAB_AR: Record<string, string> = {
  // trust & verification
  A_COMPANY_VERIFIED: "موثّق من الشركة",
  B_SUPPLIER_CONFIRMED: "مؤكد من المورد",
  C_OFFICIAL_SOURCE: "مصدر رسمي",
  D_RELIABLE_EXTERNAL: "مصدر خارجي موثوق",
  E_AI_ESTIMATE: "تقدير ذكاء اصطناعي",
  HUMAN_VERIFIED: "تحقق بشري",
  AUTO_VERIFIED: "تحقق آلي",
  AI_EXTRACTED: "مستخرج آلياً",
  MIGRATED_UNVERIFIED: "مُرحَّل غير متحقق",
  UNVERIFIED: "غير متحقق",
  CURRENT: "حديث",
  EXPIRING: "قرب الانتهاء",
  EXPIRED: "منتهٍ",
  REQUIRES_VERIFICATION: "يحتاج تحققاً",
  // rate trust
  CONTRACTED: "متعاقد عليه",
  SUPPLIER_CONFIRMED: "مؤكد من المورد",
  LIVE_API: "واجهة برمجية حية",
  HISTORICAL: "تاريخي",
  ESTIMATED: "استرشادي — يحتاج تأكيداً من المورد",
  // tasks
  QUEUED: "في الانتظار",
  RUNNING: "جارٍ",
  WAITING_APPROVAL: "بانتظار الاعتماد",
  WAITING_SUBTASKS: "بانتظار المهام الفرعية",
  COMPLETED: "مكتملة",
  FAILED: "فشلت",
  CANCELLING: "يجري الإيقاف",
  CANCELLED: "أُوقفت",
  BUDGET_EXCEEDED: "تجاوزت الميزانية",
  // approvals
  PENDING: "بانتظار القرار",
  APPROVED: "معتمد",
  REJECTED: "مرفوض",
  EDITED_APPROVED: "معتمد بعد تعديل",
  EXECUTED: "نُفِّذ",
  EXECUTION_FAILED: "فشل التنفيذ",
  SEND_CUSTOMER_MESSAGE: "إرسال رسالة لعميل",
  SEND_QUOTE: "إرسال عرض سعر",
  PUBLISH_CONTENT: "نشر محتوى",
  CONFIRM_BOOKING: "تأكيد حجز",
  SENSITIVE_CHANGE: "تغيير حساس",
  RATE_PROPOSAL: "مقترح سعر",
  MEMORY_PROMOTION: "ترقية ذاكرة",
  DATA_MERGE: "دمج بيانات",
  OTHER: "قرار",
  // agents
  executive: "التنفيذي",
  product: "المنتجات",
  sales: "المبيعات",
  support: "خدمة العملاء",
  // lifecycle
  DRAFT: "مسودة",
  REVIEW: "قيد المراجعة",
  ACTIVE: "فعّال",
  REVIEW_DUE: "تستحق المراجعة",
  SUPERSEDED: "استُبدل",
  ARCHIVED: "مؤرشف",
  INACTIVE: "غير فعّال",
  // product lifecycle
  IDEA: "فكرة",
  CONCEPT: "تصور",
  DESIGN: "تصميم",
  COSTING: "تسعير",
  QA: "مراجعة الجودة",
  APPROVAL: "اعتماد",
  READY_FOR_SALE: "جاهز للبيع",
  SUSPENDED: "موقوف",
  // leads
  NEW_LEAD: "جديد",
  QUALIFIED: "مؤهل",
  REQUIREMENTS_COLLECTED: "جُمعت المتطلبات",
  PROPOSAL_PREPARED: "أُعدّ العرض",
  QUOTE_SENT: "أُرسل العرض",
  NEGOTIATION: "تفاوض",
  WON: "فاز",
  LOST: "خسر",
  // bookings
  INQUIRY: "استفسار",
  TENTATIVE: "مبدئي",
  PENDING_CONFIRMATION: "بانتظار التأكيد",
  CONFIRMED: "مؤكد",
  IN_PROGRESS: "قيد التنفيذ",
  NO_SHOW: "لم يحضر",
  PLANNED: "مخطط",
  REQUESTED: "مطلوب من المورد",
  AMENDED: "معدَّل",
  // channels
  INSTAGRAM: "إنستجرام",
  WHATSAPP: "واتساب",
  WEBSITE: "الموقع",
  EMAIL: "بريد",
  PHONE: "هاتف",
  SNAPCHAT: "سناب شات",
  // severity
  D1: "D1 منخفض",
  D2: "D2 متوسط",
  D3: "D3 حساس",
  D4: "D4 حرج",
  // interactions
  CLASSIFIED: "مصنّفة",
  REPLY_PROPOSED: "رد مقترح",
  REPLY_APPROVED: "رد معتمد",
  REPLIED: "تم الرد",
  ESCALATED: "مصعّدة",
  CLOSED: "مغلقة",
  COMPLAINT: "شكوى",
  BOOKING_REQUEST: "طلب حجز",
  FOLLOW_UP: "متابعة",
  FEEDBACK: "ملاحظات",
  // content
  PENDING_APPROVAL: "بانتظار الاعتماد",
  SCHEDULED: "مجدول",
  PUBLISHED: "منشور",
};

export function labelOf(value: string | undefined | null, locale: Locale = "ar"): string {
  if (value === undefined || value === null) return "—";
  if (locale === "ar") return VOCAB_AR[value] ?? value;
  return value;
}
