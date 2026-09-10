"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LEAD_STAGES, LEAD_TRANSITIONS, LOST_REASONS } from "@/convex/lib/vocab";
import { formatDate, formatMoney } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

type Lead = NonNullable<ReturnType<typeof useQuery<typeof api.leads.pipeline>>>["leads"][number];

export default function PipelinePage() {
  const { t, locale } = useT();
  const data = useQuery(api.leads.pipeline);
  const changeStage = useMutation(api.leads.changeStage);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [stage, setStage] = useState<string>("");
  const [lostReason, setLostReason] = useState<string>("");
  const [note, setNote] = useState("");

  async function submit() {
    if (!selected || !stage) return;
    try {
      await changeStage({ leadId: selected._id as Id<"leads">, stage, lostReason: lostReason || undefined, note: note || undefined });
      toast.success(labelOf(stage, locale));
      setSelected(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.pipeline}
        description="العملاء المحتملون حسب المرحلة، والعروض التجارية المبنية على منتجات فعّالة فقط."
        actions={
          <Button variant="outline" size="sm" render={<Link href="/data/leads" />}>
            {t.data.newRecord}
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {LEAD_STAGES.map((s) => {
          const column = (data?.leads ?? []).filter((l) => l.stage === s);
          return (
            <div key={s} className="rounded-lg border bg-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between px-1">
                <StatusBadge value={s} />
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </div>
              <div className="space-y-2">
                {column.map((lead) => (
                  <button
                    key={lead._id}
                    type="button"
                    onClick={() => {
                      setSelected(lead);
                      setStage("");
                      setLostReason("");
                      setNote("");
                    }}
                    className="block w-full rounded-md border bg-background p-2 text-start text-sm hover:bg-muted"
                  >
                    <div className="font-medium">{lead.contactName}</div>
                    <div className="text-xs text-muted-foreground">
                      {labelOf(lead.channel, locale)} · {formatMoney(lead.expectedValue, locale)}
                    </div>
                    {lead.nextFollowUpAt && <div className="text-[10px] text-muted-foreground">متابعة: {formatDate(lead.nextFollowUpAt, locale)}</div>}
                    {lead.lostReason && <div className="text-[10px] text-destructive">{lead.lostReason}</div>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <section>
        <h2 className="mb-2 text-base font-medium">العروض التجارية</h2>
        {data?.quotes.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {data?.quotes.map((q) => (
            <div key={q._id} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{q.businessId}</span>
                <StatusBadge value={q.status} />
              </div>
              <div className="text-xs text-muted-foreground">
                {t.common.version} {q.version} · منتج {q.productVersion ?? "—"} · حتى {formatDate(q.validUntil, locale)}
              </div>
              <div className="mt-1 tabular-nums">{formatMoney(q.totals.customerSellingPrice, locale)}</div>
              {q.priceWarnings.length > 0 && (
                <ul className="mt-1 text-xs text-yellow-800">
                  {q.priceWarnings.map((w) => (
                    <li key={w}>⚠️ {w}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected?.contactName}</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">{selected.summary}</div>
              <div className="space-y-1.5">
                <Label>المرحلة الجديدة</Label>
                <Select value={stage || null} onValueChange={(v) => setStage(String(v ?? ""))} items={LEAD_TRANSITIONS[selected.stage as keyof typeof LEAD_TRANSITIONS].map((s) => ({ value: s, label: labelOf(s, locale) }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={labelOf(selected.stage, locale)} />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_TRANSITIONS[selected.stage as keyof typeof LEAD_TRANSITIONS].map((s) => (
                      <SelectItem key={s} value={s}>
                        {labelOf(s, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {stage === "LOST" && (
                <div className="space-y-1.5">
                  <Label>سبب الخسارة</Label>
                  <Select value={lostReason || null} onValueChange={(v) => setLostReason(String(v ?? ""))} items={LOST_REASONS.map((r) => ({ value: r, label: r }))}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {LOST_REASONS.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>ملاحظة</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submit} disabled={!stage || (stage === "LOST" && !lostReason)}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
