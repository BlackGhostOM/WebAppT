"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatTone = "default" | "warn" | "good" | "primary";

const VALUE_TONE: Record<StatTone, string> = {
  default: "text-foreground",
  warn: "text-warning-text",
  good: "text-success-text",
  primary: "text-primary-text",
};

/**
 * One number with a label and, at most, one supporting line. Shared by the
 * dashboard, reports and pipeline so every KPI reads the same way. Pass `href`
 * to make the whole card a link (it then gets a hover state and a focus ring).
 */
export function StatCard({ label, value, hint, tone = "default", href, icon, className }: { label: string; value: ReactNode; hint?: ReactNode; tone?: StatTone; href?: string; icon?: ReactNode; className?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {icon && <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>{icon}</span>}
      </div>
      <div className={cn("mt-2 text-2xl font-semibold tabular-nums leading-none", VALUE_TONE[tone])}>{value}</div>
      {hint ? <div className="mt-2 truncate text-xs text-muted-foreground">{hint}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} className={cn("block rounded-xl border border-border bg-card p-4 shadow-xs transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none", className)}>
        {body}
      </Link>
    );
  }
  return <Card className={cn("gap-0 p-4", className)}>{body}</Card>;
}

/** Placeholder with the same footprint as StatCard, for loading states. */
export function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-xl border border-border bg-card p-4 shadow-xs", className)} aria-hidden>
      <div className="h-3 w-24 animate-pulse rounded bg-secondary" />
      <div className="mt-3 h-7 w-16 animate-pulse rounded bg-secondary" />
      <div className="mt-3 h-3 w-32 animate-pulse rounded bg-secondary" />
    </div>
  );
}
