"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function InboxPage() {
  const { t, locale } = useT();
  const [status, setStatus] = useState<string>("ALL");
  const rows = useQuery(api.contentApi.inbox, { status: status === "ALL" ? undefined : status, limit: 100 });
  const [selected, setSelected] = useState<string | null>(null);
  const current = rows?.find((r) => r._id === selected) ?? rows?.[0];

  return (
    <div className="space-y-4">
      <PageHeader title={t.nav.inbox} description="الرسائل من كل القنوات في صندوق واحد. الردود المقترحة من وكيل خدمة العملاء تُعتمد من صندوق الاعتماد. (قنوات إنستجرام/الموقع/واتساب تُربط في المرحلة الثالثة؛ الآن تُعرض الرسائل المسجّلة والصادرة المعتمدة.)" />
      <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
        <TabsList>
          <TabsTrigger value="ALL">{t.common.all}</TabsTrigger>
          {["NEW", "REPLY_PROPOSED", "ESCALATED", "REPLIED", "CLOSED"].map((s) => (
            <TabsTrigger key={s} value={s}>
              {labelOf(s, locale)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="max-h-[70vh] overflow-auto">
          <CardContent className="space-y-1 p-2">
            {rows?.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
            {rows?.map((r) => (
              <button key={r._id} type="button" onClick={() => setSelected(r._id)} className={cn("w-full rounded-md border p-2 text-start text-sm hover:bg-muted", current?._id === r._id && "border-primary bg-muted")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{r.customerName ?? r.externalSenderId ?? "عميل غير معروف"}</span>
                  <StatusBadge value={r.status} />
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {labelOf(r.channel, locale)} · {r.direction === "INBOUND" ? "وارد" : r.direction === "OUTBOUND" ? "صادر" : "ملاحظة"} · {formatDate(r.receivedAt, locale, true)}
                </div>
                <div className="mt-1 line-clamp-2 text-xs">{r.body}</div>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4 text-sm">
            {!current ? (
              <EmptyState>{t.common.details}</EmptyState>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{current.customerName ?? current.externalSenderId ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {current.businessId} · {labelOf(current.channel, locale)} · {formatDate(current.receivedAt, locale, true)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {current.kind && <StatusBadge value={current.kind} />}
                    <StatusBadge value={current.status} />
                  </div>
                </div>
                <div className="whitespace-pre-wrap rounded-md bg-muted p-3">{current.body}</div>
                {current.aiClassification && (
                  <div className="text-xs text-muted-foreground">
                    تصنيف آلي: {labelOf(current.aiClassification.kind, locale)} (ثقة {current.aiClassification.confidence}) · {current.aiClassification.model}
                    {current.aiClassification.escalated && " · مصعّدة"}
                  </div>
                )}
                {current.proposedReply && (
                  <div>
                    <div className="mb-1 text-xs font-medium">الرد المقترح</div>
                    <div className="whitespace-pre-wrap rounded-md border p-3">{current.proposedReply}</div>
                    {current.approvalId && (
                      <Link href={`/approvals?id=${current.approvalId}`} className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline">
                        {t.approvals.title} ←
                      </Link>
                    )}
                  </div>
                )}
                {current.customerId && (
                  <Link href={`/data/customers?id=${current.customerId}`} className="text-xs text-primary underline-offset-4 hover:underline">
                    سجل العميل {current.customerBusinessId} ←
                  </Link>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
