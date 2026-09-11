"use client";

import { ChevronRightIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * List on the start side, details on the end side. On phones only one is
 * visible at a time: the list until the user picks something, then the detail
 * with a back button. Used by the approval inbox and the customer inbox so
 * both screens behave identically.
 */
export function MasterDetail({
  list,
  detail,
  showDetailOnMobile,
  onBack,
  listWidth = "360px",
  className,
}: {
  list: ReactNode;
  detail: ReactNode;
  showDetailOnMobile: boolean;
  onBack: () => void;
  listWidth?: string;
  className?: string;
}) {
  const { t } = useT();
  return (
    <div className={cn("lg:grid lg:items-start lg:gap-4 lg:grid-cols-[var(--list-w)_1fr]", className)} style={{ "--list-w": listWidth } as CSSProperties}>
      <div className={cn(showDetailOnMobile && "hidden lg:block")}>{list}</div>
      <div className={cn(!showDetailOnMobile && "hidden lg:block", "min-w-0")}>
        {showDetailOnMobile && (
          <Button variant="ghost" size="sm" className="mb-2 -ms-2 lg:hidden" onClick={onBack}>
            <ChevronRightIcon data-icon="inline-start" className="ltr:rotate-180" />
            {t.common.back}
          </Button>
        )}
        {detail}
      </div>
    </div>
  );
}

/** Scrollable list surface; keeps its own scroll on large screens so the detail stays put. */
export function MasterList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Card className="gap-0 py-0 lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto">
      <CardContent className={cn("space-y-1.5 p-2", className)}>{children}</CardContent>
    </Card>
  );
}

/** One selectable row: whole row clickable, 44px minimum, primary-soft when selected. */
export function MasterListItem({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "block w-full min-h-11 rounded-lg border border-transparent px-3 py-2.5 text-start text-sm transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
        selected ? "border-primary/40 bg-primary-soft" : "bg-card",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Placeholder rows while the list query is loading. */
export function MasterListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="h-3.5 w-2/3 animate-pulse rounded bg-secondary" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-secondary" />
        </div>
      ))}
    </div>
  );
}
