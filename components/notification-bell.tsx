"use client";

import { useMutation, useQuery } from "convex/react";
import { BellIcon, CheckCheckIcon, ChevronLeftIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRelative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  CRITICAL: "bg-destructive text-destructive-foreground",
  WARNING: "bg-amber-500 text-white",
  INFO: "bg-primary text-primary-foreground",
};

/**
 * One badge for everything that needs the owner: pending approvals, open customer
 * messages, follow-ups, knowledge/data gaps, conflicts, memory proposals and
 * unread notifications — not just the notifications table.
 */
export function NotificationBell() {
  const { t, locale } = useT();
  const attention = useQuery(api.settings.attention);
  const markRead = useMutation(api.settings.markNotificationRead);
  const markAll = useMutation(api.settings.markAllNotificationsRead);
  const [open, setOpen] = useState(false);
  const total = attention?.total ?? 0;
  const tone = TONE[attention?.highest ?? "INFO"] ?? TONE.INFO;
  type ItemKey = keyof typeof t.attention;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative inline-flex size-8 items-center justify-center rounded-lg hover:bg-muted"
        aria-label={`${t.attention.title}${total ? ` (${total})` : ""}`}
      >
        <BellIcon className={cn("size-4", total > 0 && "text-foreground")} />
        {total > 0 && <span className={cn("absolute -top-1 -end-1 min-w-4 rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums", tone)}>{total > 99 ? "99+" : total}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">{t.attention.title}</span>
          {(attention?.latest.length ?? 0) > 0 && (
            <Button size="xs" variant="ghost" onClick={() => markAll({})}>
              <CheckCheckIcon data-icon="inline-start" /> {t.attention.markAllRead}
            </Button>
          )}
        </div>
        {attention === undefined ? (
          <div className="p-3 text-sm text-muted-foreground">{t.common.loading}</div>
        ) : total === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">{t.attention.empty}</div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <ul className="divide-y">
              {attention.items.map((item) => (
                <li key={item.key}>
                  <Link href={item.href} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-muted">
                    <span>{t.attention[item.key as ItemKey] ?? item.key}</span>
                    <span className="flex items-center gap-1">
                      <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs font-semibold tabular-nums", TONE[item.severity])}>{item.count}</span>
                      <ChevronLeftIcon className="size-3.5 text-muted-foreground rtl:rotate-0 ltr:rotate-180" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {attention.latest.length > 0 && (
              <div className="border-t">
                <div className="px-3 pt-2 text-xs font-medium text-muted-foreground">{t.attention.latest}</div>
                <ul className="divide-y">
                  {attention.latest.map((n) => (
                    <li key={n._id} className="px-3 py-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className={cn("truncate font-medium", n.severity === "CRITICAL" && "text-destructive")}>{n.title}</div>
                          <div className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">{n.body}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{formatRelative(n.createdAt, locale)}</div>
                        </div>
                        <Button size="xs" variant="ghost" aria-label={t.attention.markRead} onClick={() => markRead({ notificationId: n._id })}>
                          ✓
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        <Link href="/settings?tab=governance" onClick={() => setOpen(false)} className="block border-t px-3 py-2 text-center text-xs text-primary underline-offset-4 hover:underline">
          {t.attention.openGovernance}
        </Link>
      </PopoverContent>
    </Popover>
  );
}
