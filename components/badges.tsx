"use client";

import { Badge } from "@/components/ui/badge";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * One tone per meaning, all from the theme tokens (no palette classes here):
 *   ok       → success-soft / success-text      (done, active, confirmed)
 *   progress → info-soft / info-text            (running)
 *   waiting  → warning-soft / warning-text      (needs a person or time)
 *   bad      → destructive-soft / destructive-text
 *   neutral  → secondary / muted-foreground     (queued, unknown)
 */
const TONE = {
  ok: "bg-success-soft text-success-text",
  progress: "bg-info-soft text-info-text",
  waiting: "bg-warning-soft text-warning-text",
  bad: "bg-destructive-soft text-destructive-text",
  neutral: "bg-secondary text-muted-foreground",
  violet: "bg-tone-violet-soft text-tone-violet-text",
  teal: "bg-tone-teal-soft text-tone-teal-text",
} as const;

type Tone = keyof typeof TONE;

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "ok",
  COMPLETED: "ok",
  CONFIRMED: "ok",
  APPROVED: "ok",
  EXECUTED: "ok",
  PUBLISHED: "ok",
  WON: "ok",
  RUNNING: "progress",
  IN_PROGRESS: "progress",
  QUEUED: "neutral",
  PENDING: "waiting",
  PENDING_APPROVAL: "waiting",
  WAITING_APPROVAL: "waiting",
  WAITING_SUBTASKS: "waiting",
  REVIEW: "waiting",
  REVIEW_DUE: "waiting",
  EXPIRING: "waiting",
  REQUIRES_VERIFICATION: "waiting",
  FAILED: "bad",
  CANCELLED: "bad",
  CANCELLING: "bad",
  REJECTED: "bad",
  EXPIRED: "bad",
  LOST: "bad",
  BUDGET_EXCEEDED: "bad",
  EXECUTION_FAILED: "bad",
  ESCALATED: "bad",
};

export function StatusBadge({ value, className }: { value: string | undefined | null; className?: string }) {
  const { locale } = useT();
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = STATUS_TONE[value] ?? "neutral";
  return <Badge className={cn(TONE[tone], className)}>{labelOf(value, locale)}</Badge>;
}

/** Trust ladder: verified → green, supplier → teal, official → blue, external → neutral, AI estimate → amber. */
const TRUST_TONE: Record<string, Tone> = {
  A_COMPANY_VERIFIED: "ok",
  B_SUPPLIER_CONFIRMED: "teal",
  C_OFFICIAL_SOURCE: "progress",
  D_RELIABLE_EXTERNAL: "neutral",
  E_AI_ESTIMATE: "waiting",
  CONTRACTED: "ok",
  SUPPLIER_CONFIRMED: "teal",
  LIVE_API: "progress",
  HISTORICAL: "neutral",
  ESTIMATED: "waiting",
};

/** Trust + freshness in one place so every price/availability/policy shows its provenance. */
export function TrustBadge({ trustLevel, rateTrust, freshness, verificationStatus }: { trustLevel?: string; rateTrust?: string; freshness?: string; verificationStatus?: string }) {
  const { locale } = useT();
  const primary = rateTrust ?? trustLevel;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {primary && <Badge className={TONE[TRUST_TONE[primary] ?? "neutral"]}>{labelOf(primary, locale)}</Badge>}
      {freshness && freshness !== "CURRENT" && <StatusBadge value={freshness} />}
      {verificationStatus && verificationStatus !== "HUMAN_VERIFIED" && <Badge variant="outline">{labelOf(verificationStatus, locale)}</Badge>}
    </span>
  );
}

const SEVERITY_TONE: Record<string, Tone> = { D4: "bad", D3: "waiting", D2: "progress", D1: "neutral" };

export function SeverityBadge({ value }: { value: string }) {
  const { locale } = useT();
  return <Badge className={TONE[SEVERITY_TONE[value] ?? "neutral"]}>{labelOf(value, locale)}</Badge>;
}

/** Each agent keeps a stable calm hue so it can be recognised at a glance across screens. */
const AGENT_TONE: Record<string, Tone> = { executive: "violet", product: "waiting", sales: "teal", support: "progress" };

export function AgentBadge({ slug }: { slug: string }) {
  const { locale } = useT();
  return <Badge className={TONE[AGENT_TONE[slug] ?? "neutral"]}>{labelOf(slug, locale)}</Badge>;
}
