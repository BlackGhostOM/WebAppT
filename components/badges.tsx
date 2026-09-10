"use client";

import { Badge } from "@/components/ui/badge";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  CONFIRMED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  EXECUTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  PUBLISHED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  WON: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  RUNNING: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  IN_PROGRESS: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  QUEUED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  PENDING_APPROVAL: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  WAITING_APPROVAL: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  WAITING_SUBTASKS: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REVIEW_DUE: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  EXPIRING: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  REQUIRES_VERIFICATION: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  CANCELLED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  CANCELLING: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  EXPIRED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  LOST: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  BUDGET_EXCEEDED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  EXECUTION_FAILED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  ESCALATED: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

export function StatusBadge({ value, className }: { value: string | undefined | null; className?: string }) {
  const { locale } = useT();
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge className={cn("border-transparent", STATUS_TONE[value] ?? "bg-muted text-foreground", className)}>{labelOf(value, locale)}</Badge>;
}

const TRUST_TONE: Record<string, string> = {
  A_COMPANY_VERIFIED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  B_SUPPLIER_CONFIRMED: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  C_OFFICIAL_SOURCE: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  D_RELIABLE_EXTERNAL: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  E_AI_ESTIMATE: "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100",
  CONTRACTED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  SUPPLIER_CONFIRMED: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
  LIVE_API: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
  HISTORICAL: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  ESTIMATED: "bg-yellow-200 text-yellow-900 dark:bg-yellow-900 dark:text-yellow-100",
};

/** Trust + freshness in one place so every price/availability/policy shows its provenance. */
export function TrustBadge({ trustLevel, rateTrust, freshness, verificationStatus }: { trustLevel?: string; rateTrust?: string; freshness?: string; verificationStatus?: string }) {
  const { locale } = useT();
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {rateTrust && <Badge className={cn("border-transparent", TRUST_TONE[rateTrust])}>{labelOf(rateTrust, locale)}</Badge>}
      {trustLevel && !rateTrust && <Badge className={cn("border-transparent", TRUST_TONE[trustLevel])}>{labelOf(trustLevel, locale)}</Badge>}
      {freshness && freshness !== "CURRENT" && <StatusBadge value={freshness} />}
      {verificationStatus && verificationStatus !== "HUMAN_VERIFIED" && <Badge variant="outline">{labelOf(verificationStatus, locale)}</Badge>}
    </span>
  );
}

export function SeverityBadge({ value }: { value: string }) {
  const { locale } = useT();
  const tone = value === "D4" ? "bg-red-100 text-red-800" : value === "D3" ? "bg-amber-100 text-amber-900" : value === "D2" ? "bg-sky-100 text-sky-800" : "bg-muted text-foreground";
  return <Badge className={cn("border-transparent", tone)}>{labelOf(value, locale)}</Badge>;
}

export function AgentBadge({ slug }: { slug: string }) {
  const { locale } = useT();
  const tone: Record<string, string> = {
    executive: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
    product: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    sales: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
    support: "bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-200",
  };
  return <Badge className={cn("border-transparent", tone[slug] ?? "bg-muted")}>{labelOf(slug, locale)}</Badge>;
}
