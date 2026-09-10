"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { formatDate } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const GROUPS = ["PENDING_APPROVAL", "APPROVED", "SCHEDULED", "PUBLISHED", "REJECTED", "DRAFT"] as const;

export default function ContentPage() {
  const { t, locale } = useT();
  const content = useQuery(api.contentApi.list);
  return (
    <div className="space-y-4">
      <PageHeader title={t.nav.content} description="منشورات إنستجرام وسناب شات المقترحة من وكيل المبيعات؛ لا يُنشر شيء قبل اعتمادك في صندوق الاعتماد." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {GROUPS.map((status) => {
          const column = (content ?? []).filter((c) => c.status === status);
          if (column.length === 0 && status === "DRAFT") return null;
          return (
            <div key={status} className="rounded-lg border bg-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <StatusBadge value={status} />
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </div>
              <div className="space-y-2">
                {column.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
                {column.map((c) => (
                  <div key={c._id} className="rounded-md border bg-background p-2 text-sm">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>{labelOf(c.platform, locale)}</span>
                      <span>{formatDate(c.scheduledAt.timestamp, locale, true)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap">{c.caption}</div>
                    {c.hashtags.length > 0 && <div className="mt-1 text-xs text-primary">{c.hashtags.join(" ")}</div>}
                    {c.visualIdea && <div className="mt-1 text-xs text-muted-foreground">🎨 {c.visualIdea}</div>}
                    {c.rejectionReason && <div className="mt-1 text-xs text-destructive">{c.rejectionReason}</div>}
                    {c.approvalId && c.status === "PENDING_APPROVAL" && (
                      <Link href={`/approvals?id=${c.approvalId}`} className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline">
                        {t.approvals.title} ←
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
