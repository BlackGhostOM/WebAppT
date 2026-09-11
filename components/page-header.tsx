import { ChevronLeftIcon, InboxIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Screen title row: title + one-line purpose on the start side, actions on the end side (wraps on phones). */
export function PageHeader({ title, description, actions, className }: { title: string; description?: string; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-balance md:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Titled block inside a screen: keeps related content together with a descriptive heading and optional end-side link/action. */
export function Section({ title, description, action, children, className }: { title: string; description?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Empty state: quiet dashed box with an icon, a short title and, when useful,
 * the one action that fills it. `children` alone still works as the message.
 */
export function EmptyState({ icon, title, action, children, className }: { icon?: ReactNode; title?: string; action?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/60 px-6 py-8 text-center", className)}>
      <span className="text-hint [&_svg]:size-6" aria-hidden>
        {icon ?? <InboxIcon />}
      </span>
      {title && <div className="text-sm font-medium text-foreground">{title}</div>}
      {children && <div className="max-w-sm text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** "See more" link with a direction-aware chevron (points forward in both RTL and LTR). */
export function MoreLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-1 text-sm font-medium text-primary-text underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none rounded", className)}>
      {children}
      <ChevronLeftIcon className="size-4 ltr:rotate-180" aria-hidden />
    </Link>
  );
}

/** Raw data for audit/debug contexts: always LTR and monospace, never the main way to read a record. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre dir="ltr" className={cn("max-h-80 overflow-auto rounded-lg border border-border bg-secondary p-3 text-left font-mono text-xs leading-relaxed text-foreground", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}
