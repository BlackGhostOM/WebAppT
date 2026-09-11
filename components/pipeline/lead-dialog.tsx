"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CHANNELS, LEAD_TRANSITIONS, LOST_REASONS } from "@/convex/lib/vocab";
import { StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

function Picker({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { id: string; label: string }[]; placeholder?: string }) {
  return (
    <Select value={value || null} onValueChange={(v) => onChange(String(v ?? ""))} items={options.map((o) => ({ value: o.id, label: o.label }))}>
      <SelectTrigger className="w-full">
        <SelectValue placeholder={placeholder ?? "—"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const errMsg = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : fallback);

export function LeadDialog({ leadId, onClose }: { leadId: Id<"leads"> | null; onClose: () => void }) {
  const { t, locale } = useT();
  const data = useQuery(api.leads.get, leadId ? { leadId } : "skip");
  const changeStage = useMutation(api.leads.changeStage);
  const createQuote = useMutation(api.leads.createQuote);
  const sendQuote = useMutation(api.leads.sendQuote);
  const logMessage = useMutation(api.leads.logMessage);
  const [stage, setStage] = useState("");
  const [lostReason, setLostReason] = useState("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState({ productId: "", pax: "2", discount: "", validDays: "7" });
  const [message, setMessage] = useState({ channel: "WHATSAPP", direction: "OUTBOUND", body: "" });
  const [sendChannel, setSendChannel] = useState("WHATSAPP");

  if (!leadId) return null;
  const lead = data?.lead;

  return (
    <Dialog open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>{lead?.contactName ?? t.common.loading}</span>
            {lead && (
              <span className="flex items-center gap-1 text-xs">
                <StatusBadge value={lead.stage} /> <span className="font-mono text-muted-foreground" dir="ltr">{lead.businessId}</span>
              </span>
            )}
          </DialogTitle>
        </DialogHeader>
        {!lead ? (
          <div className="text-sm text-muted-foreground">{t.common.loading}</div>
        ) : (
          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">{t.common.details}</TabsTrigger>
              <TabsTrigger value="quotes">العروض ({data?.quotes.length ?? 0})</TabsTrigger>
              <TabsTrigger value="messages">الرسائل ({data?.interactions.length ?? 0})</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="space-y-3 pt-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">القناة</dt>
                <dd>{labelOf(lead.channel, locale)}</dd>
                <dt className="text-muted-foreground">الهاتف / البريد</dt>
                <dd dir="ltr" className="text-start">
                  {lead.contactPhone ?? "—"} · {lead.contactEmail ?? "—"}
                </dd>
                <dt className="text-muted-foreground">القيمة المتوقعة</dt>
                <dd>{formatMoney(lead.expectedValue, locale)}</dd>
                <dt className="text-muted-foreground">السفر</dt>
                <dd>
                  {formatDate(lead.travelDateFrom, locale)} → {formatDate(lead.travelDateTo, locale)} · {lead.paxAdults ?? 0}+{lead.paxChildren ?? 0}
                </dd>
                <dt className="text-muted-foreground">آخر تواصل / المتابعة</dt>
                <dd>
                  {formatDate(lead.lastContactAt, locale, true)} · {formatDate(lead.nextFollowUpAt, locale, true)}
                </dd>
                <dt className="text-muted-foreground">المنتج المهتم به</dt>
                <dd>{data?.product ? `${data.product.name} (${data.product.businessId})` : "—"}</dd>
                {data?.customer && (
                  <>
                    <dt className="text-muted-foreground">سجل العميل</dt>
                    <dd>
                      <Link href={`/data/customers?id=${data.customer._id}`} className="text-primary underline-offset-4 hover:underline">
                        {data.customer.fullName} ({data.customer.businessId})
                      </Link>{" "}
                      · موافقة {labelOf(data.customer.consentStatus, locale)}
                    </dd>
                  </>
                )}
              </dl>
              {lead.summary && <div className="rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{lead.summary}</div>}
              {data && data.approvals.length > 0 && (
                <div className="rounded-lg border border-warning/40 bg-warning-soft p-2 text-xs text-warning-text">
                  بانتظار اعتمادك: {data.approvals.map((a) => a.title).join("؛ ")} —{" "}
                  <Link href="/approvals" className="text-primary underline">
                    {t.approvals.title}
                  </Link>
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label>المرحلة الجديدة</Label>
                  <Picker value={stage} onChange={setStage} options={LEAD_TRANSITIONS[lead.stage].map((s) => ({ id: s, label: labelOf(s, locale) }))} placeholder={labelOf(lead.stage, locale)} />
                </div>
                {stage === "LOST" && (
                  <div className="flex flex-col gap-1.5">
                    <Label>سبب الخسارة</Label>
                    <Picker value={lostReason} onChange={setLostReason} options={LOST_REASONS.map((r) => ({ id: r, label: r }))} />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <Label>ملاحظة</Label>
                  <Input value={note} onChange={(e) => setNote(e.target.value)} />
                </div>
              </div>
              <Button
                size="sm"
                disabled={!stage || (stage === "LOST" && !lostReason)}
                onClick={() =>
                  changeStage({ leadId: lead._id, stage, lostReason: lostReason || undefined, note: note || undefined })
                    .then(() => {
                      toast.success(labelOf(stage, locale));
                      setStage("");
                    })
                    .catch((e) => toast.error(errMsg(e, t.common.error)))
                }
              >
                {t.common.save}
              </Button>
            </TabsContent>

            <TabsContent value="quotes" className="space-y-3 pt-3 text-sm">
              {data?.quotes.length === 0 && <EmptyState>لا عروض بعد.</EmptyState>}
              {data?.quotes.map((q) => (
                <div key={q._id} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {q.businessId} · V{q.version} · منتج {q.productVersion ?? "—"}
                    </span>
                    <StatusBadge value={q.status} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatMoney(q.totals.customerSellingPrice, locale)} · صالح حتى {formatDate(q.validUntil, locale)}
                  </div>
                  {q.priceWarnings.length > 0 && (
                    <ul className="mt-1 text-xs text-warning-text">
                      {q.priceWarnings.map((w) => (
                        <li key={w}>⚠️ {w}</li>
                      ))}
                    </ul>
                  )}
                  {(q.status === "DRAFT" || q.status === "APPROVED") && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Picker value={sendChannel} onChange={setSendChannel} options={CHANNELS.map((c) => ({ id: c, label: labelOf(c, locale) }))} />
                      <Button size="xs" onClick={() => sendQuote({ quoteId: q._id, channel: sendChannel, message: `نرسل لكم عرض السعر ${q.businessId}` }).then(() => toast.success("أُرسل العرض (محاكاة)")).catch((e) => toast.error(errMsg(e, t.common.error)))}>
                        إرسال العرض الآن
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <div className="rounded-md border border-dashed p-3">
                <div className="mb-2 text-xs font-medium">عرض جديد (من منتج فعّال فقط)</div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <Picker value={quote.productId} onChange={(v) => setQuote({ ...quote, productId: v })} options={(data?.activeProducts ?? []).map((p) => ({ id: p._id, label: `${p.name} V${p.version} — ${formatMoney(p.customerSellingPrice, locale)}` }))} placeholder="اختر منتجاً فعّالاً" />
                  </div>
                  <Input type="number" dir="ltr" placeholder="الأفراد" value={quote.pax} onChange={(e) => setQuote({ ...quote, pax: e.target.value })} />
                  <Input type="number" dir="ltr" placeholder="خصم %" value={quote.discount} onChange={(e) => setQuote({ ...quote, discount: e.target.value })} />
                </div>
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={!quote.productId}
                  onClick={() =>
                    createQuote({ leadId: lead._id, productId: quote.productId as Id<"products">, pax: Number(quote.pax) || 1, discountPercent: quote.discount ? Number(quote.discount) : undefined, validDays: Number(quote.validDays) || 7 })
                      .then((r) => toast.success(`${r.businessId}${r.warnings.length ? ` — ${r.warnings.length} تحذير` : ""}`))
                      .catch((e) => toast.error(errMsg(e, t.common.error)))
                  }
                >
                  إنشاء مسودة العرض
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="messages" className="space-y-3 pt-3 text-sm">
              {data?.interactions.length === 0 && <EmptyState>لا رسائل مسجّلة.</EmptyState>}
              {data?.interactions.map((i) => (
                <div key={i._id} className={`rounded-md border p-2 ${i.direction === "OUTBOUND" ? "bg-muted/40" : ""}`}>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {i.direction === "INBOUND" ? "وارد" : i.direction === "OUTBOUND" ? "صادر" : "ملاحظة"} · {labelOf(i.channel, locale)} {i.kind ? `· ${labelOf(i.kind, locale)}` : ""}
                    </span>
                    <span>{formatDate(i.receivedAt, locale, true)}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap">{i.body}</div>
                </div>
              ))}
              <div className="rounded-md border border-dashed p-3">
                <div className="mb-2 text-xs font-medium">تسجيل رسالة (واردة من العميل أو صادرة أرسلتها بنفسك)</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Picker value={message.channel} onChange={(v) => setMessage({ ...message, channel: v })} options={CHANNELS.map((c) => ({ id: c, label: labelOf(c, locale) }))} />
                  <Picker value={message.direction} onChange={(v) => setMessage({ ...message, direction: v })} options={[{ id: "INBOUND", label: "واردة" }, { id: "OUTBOUND", label: "صادرة" }, { id: "INTERNAL_NOTE", label: "ملاحظة داخلية" }]} />
                </div>
                <Textarea className="mt-2" rows={3} value={message.body} onChange={(e) => setMessage({ ...message, body: e.target.value })} />
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={!message.body.trim()}
                  onClick={() =>
                    logMessage({ leadId: lead._id, customerId: lead.customerId, channel: message.channel, direction: message.direction, body: message.body })
                      .then(() => {
                        toast.success(t.common.save);
                        setMessage({ ...message, body: "" });
                      })
                      .catch((e) => toast.error(errMsg(e, t.common.error)))
                  }
                >
                  تسجيل
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
