"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { CAMPAIGN_TRANSITIONS, CONTENT_PLATFORMS, CONTENT_TRANSITIONS } from "@/convex/lib/vocab";
import { AskAgentButton } from "@/components/ask-agent-button";
import { StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, fromDateInputValue } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const errMsg = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : fallback);

function startOfWeek(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 1) % 7; // Saturday-based week (Omani work week)
  return d.getTime() - day * DAY;
}

export default function ContentPage() {
  const { t, locale } = useT();
  const content = useQuery(api.contentApi.list);
  const campaigns = useQuery(api.contentApi.campaigns);
  const products = useQuery(api.records.list, { entity: "products", status: "ACTIVE", limit: 100 });
  const updateStatus = useMutation(api.contentApi.updateContentStatus);
  const createContent = useMutation(api.contentApi.createContentByOwner);
  const createCampaign = useMutation(api.contentApi.createCampaignByOwner);
  const updateCampaign = useMutation(api.contentApi.updateCampaignStatus);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(Date.now()));
  const [newOpen, setNewOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [selected, setSelected] = useState<Id<"contentCalendar"> | null>(null);
  const [form, setForm] = useState({ platform: "INSTAGRAM", caption: "", hashtags: "", visualIdea: "", date: "", time: "20:00", productId: "", campaignId: "" });
  const [campaignForm, setCampaignForm] = useState({ name: "", objective: "", platforms: ["INSTAGRAM"] as string[], startDate: "", endDate: "", targetAudience: "", budgetOmr: "" });
  const [rejectReason, setRejectReason] = useState("");

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => weekStart + i * DAY), [weekStart]);
  const current = content?.find((c) => c._id === selected) ?? null;

  async function submitContent() {
    const ts = form.date ? (fromDateInputValue(form.date) ?? Date.now()) + Number(form.time.split(":")[0]) * 3_600_000 + Number(form.time.split(":")[1] ?? 0) * 60_000 : Date.now();
    try {
      await createContent({
        platform: form.platform,
        caption: form.caption,
        hashtags: form.hashtags.split(/[\s,]+/).filter(Boolean),
        visualIdea: form.visualIdea || undefined,
        scheduledAt: ts,
        productId: (form.productId || undefined) as Id<"products"> | undefined,
        campaignId: (form.campaignId || undefined) as Id<"campaigns"> | undefined,
      });
      toast.success(t.common.save);
      setNewOpen(false);
      setForm({ ...form, caption: "", hashtags: "", visualIdea: "" });
    } catch (e) {
      toast.error(errMsg(e, t.common.error));
    }
  }

  async function submitCampaign() {
    try {
      await createCampaign({
        name: campaignForm.name,
        objective: campaignForm.objective,
        platforms: campaignForm.platforms,
        startDate: fromDateInputValue(campaignForm.startDate),
        endDate: fromDateInputValue(campaignForm.endDate),
        targetAudience: campaignForm.targetAudience || undefined,
        budgetOmr: campaignForm.budgetOmr ? Number(campaignForm.budgetOmr) : undefined,
      });
      toast.success(t.common.save);
      setCampaignOpen(false);
    } catch (e) {
      toast.error(errMsg(e, t.common.error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.content}
        description="منشورات إنستجرام وسناب شات المقترحة من وكيل المبيعات؛ لا يُنشر شيء قبل اعتمادك. النشر الفعلي على إنستجرام يعمل في وضع المحاكاة حتى ربط حساب Meta."
        actions={
          <>
            <AskAgentButton label="اطلب خطة محتوى" template="خطط حملة محتوى لأسبوعين على إنستجرام وسناب شات لباقاتنا الفعّالة في موسم الشتاء: 6 منشورات بنصوص عربية قصيرة وأفكار مرئية وهاشتاقات وأوقات نشر، ملتزمة بدليل الهوية، ودون ذكر أسعار إلا من منتج فعّال بصيغة «ابتداءً من»." />
            <Button size="sm" variant="outline" onClick={() => setCampaignOpen(true)}>
              حملة جديدة
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              إضافة منشور
            </Button>
          </>
        }
      />

      {campaigns && campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">الحملات</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {campaigns.map((c) => (
              <div key={c._id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <StatusBadge value={c.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {c.objective} · {c.platforms.map((p) => labelOf(p, locale)).join("، ")}
                  {c.budget ? ` · ${formatMoney(c.budget, locale)}` : ""}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {formatDate(c.startDate, locale)} → {formatDate(c.endDate, locale)} · {(content ?? []).filter((x) => x.campaignId === c._id).length} منشور
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {CAMPAIGN_TRANSITIONS[c.status].map((s) => (
                    <Button key={s} size="xs" variant="outline" onClick={() => updateCampaign({ campaignId: c._id, status: s }).catch((e) => toast.error(errMsg(e, t.common.error)))}>
                      {labelOf(s, locale)}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            الأسبوع {formatDate(weekStart, locale)} — {formatDate(weekStart + 6 * DAY, locale)}
          </CardTitle>
          <div className="flex gap-1">
            <Button size="xs" variant="outline" onClick={() => setWeekStart(weekStart - 7 * DAY)}>
              السابق
            </Button>
            <Button size="xs" variant="outline" onClick={() => setWeekStart(startOfWeek(Date.now()))}>
              اليوم
            </Button>
            <Button size="xs" variant="outline" onClick={() => setWeekStart(weekStart + 7 * DAY)}>
              التالي
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const items = (content ?? []).filter((c) => c.scheduledAt.timestamp >= d && c.scheduledAt.timestamp < d + DAY).sort((a, b) => a.scheduledAt.timestamp - b.scheduledAt.timestamp);
            const today = Date.now() >= d && Date.now() < d + DAY;
            return (
              <div key={d} className={cn("min-h-28 rounded-md border p-1.5", today && "border-primary")}>
                <div className="mb-1 text-xs font-medium">{formatDate(d, locale)}</div>
                <div className="space-y-1">
                  {items.map((c) => (
                    <button key={c._id} type="button" onClick={() => setSelected(c._id)} className={cn("block w-full rounded border p-1 text-start text-[11px] hover:bg-muted", c._id === selected && "border-primary bg-muted")}>
                      <div className="flex items-center justify-between gap-1">
                        <span>{labelOf(c.platform, locale)}</span>
                        <span className="text-muted-foreground">{new Date(c.scheduledAt.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Muscat" })}</span>
                      </div>
                      <div className="line-clamp-2">{c.caption}</div>
                      <StatusBadge value={c.status} className="mt-1 text-[9px]" />
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-2">
          <h2 className="text-base font-medium">كل المنشورات</h2>
          {content?.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          <div className="grid gap-2 md:grid-cols-2">
            {content?.map((c) => (
              <button key={c._id} type="button" onClick={() => setSelected(c._id)} className={cn("rounded-md border bg-background p-2 text-start text-sm hover:bg-muted", c._id === selected && "border-primary")}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{labelOf(c.platform, locale)}</span>
                  <span>{formatDate(c.scheduledAt.timestamp, locale, true)}</span>
                </div>
                <div className="mt-1 line-clamp-3 whitespace-pre-wrap">{c.caption}</div>
                <div className="mt-1 flex items-center justify-between">
                  <StatusBadge value={c.status} />
                  {c.hashtags.length > 0 && <span className="truncate text-xs text-primary">{c.hashtags.slice(0, 3).join(" ")}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <Card className="h-fit">
          <CardContent className="space-y-3 p-4 text-sm">
            {!current ? (
              <EmptyState>{t.common.details}</EmptyState>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium">{labelOf(current.platform, locale)}</span>
                  <StatusBadge value={current.status} />
                </div>
                <div className="text-xs text-muted-foreground">
                  {current.businessId} · {formatDate(current.scheduledAt.timestamp, locale, true)} (Asia/Muscat)
                </div>
                <div className="whitespace-pre-wrap rounded-md bg-muted p-2">{current.caption}</div>
                {current.captionEn && <div className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs" dir="ltr">{current.captionEn}</div>}
                {current.hashtags.length > 0 && <div className="text-xs text-primary">{current.hashtags.join(" ")}</div>}
                {current.visualIdea && <div className="text-xs text-muted-foreground">🎨 {current.visualIdea}</div>}
                {current.rejectionReason && <div className="text-xs text-destructive">سبب الرفض: {current.rejectionReason}</div>}
                {current.externalPostId && <div className="text-xs text-muted-foreground" dir="ltr">post: {current.externalPostId}</div>}
                {current.approvalId && current.status === "PENDING_APPROVAL" && (
                  <Link href={`/approvals?id=${current.approvalId}`} className="block text-xs text-primary underline-offset-4 hover:underline">
                    فتح طلب الاعتماد ←
                  </Link>
                )}
                <div className="space-y-2 border-t pt-2">
                  <div className="text-xs font-medium">إجراءات المالك</div>
                  <div className="flex flex-wrap gap-1">
                    {CONTENT_TRANSITIONS[current.status]
                      .filter((s) => s !== "REJECTED" && s !== "PENDING_APPROVAL")
                      .map((s) => (
                        <Button key={s} size="xs" variant={s === "PUBLISHED" ? "default" : "outline"} onClick={() => updateStatus({ contentId: current._id, status: s }).then(() => toast.success(labelOf(s, locale))).catch((e) => toast.error(errMsg(e, t.common.error)))}>
                          {s === "PUBLISHED" ? "نشر الآن (محاكاة)" : labelOf(s, locale)}
                        </Button>
                      ))}
                  </div>
                  {CONTENT_TRANSITIONS[current.status].includes("REJECTED") && (
                    <div className="flex gap-1">
                      <Input placeholder={t.approvals.rejectReason} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      <Button size="sm" variant="destructive" disabled={!rejectReason.trim()} onClick={() => updateStatus({ contentId: current._id, status: "REJECTED", reason: rejectReason }).then(() => setRejectReason("")).catch((e) => toast.error(errMsg(e, t.common.error)))}>
                        {t.common.reject}
                      </Button>
                    </div>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>إضافة منشور (يُعتمد مباشرة لأنك المالك)</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>المنصة</Label>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: String(v ?? "INSTAGRAM") })} items={CONTENT_PLATFORMS.map((p) => ({ value: p, label: labelOf(p, locale) }))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTENT_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {labelOf(p, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الحملة</Label>
              <Select value={form.campaignId || null} onValueChange={(v) => setForm({ ...form, campaignId: String(v ?? "") })} items={(campaigns ?? []).map((c) => ({ value: c._id, label: c.name }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {(campaigns ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>التاريخ</Label>
              <Input type="date" dir="ltr" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الوقت (مسقط)</Label>
              <Input type="time" dir="ltr" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>النص</Label>
              <Textarea rows={4} value={form.caption} onChange={(e) => setForm({ ...form, caption: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الهاشتاقات</Label>
              <Input value={form.hashtags} onChange={(e) => setForm({ ...form, hashtags: e.target.value })} placeholder="#عمان #مسقط" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>المنتج المروَّج (فعّال)</Label>
              <Select value={form.productId || null} onValueChange={(v) => setForm({ ...form, productId: String(v ?? "") })} items={(products ?? []).map((p) => ({ value: String(p._id), label: String(p.name) }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  {(products ?? []).map((p) => (
                    <SelectItem key={String(p._id)} value={String(p._id)}>
                      {String(p.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>الفكرة المرئية</Label>
              <Input value={form.visualIdea} onChange={(e) => setForm({ ...form, visualIdea: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submitContent} disabled={!form.caption.trim()}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={campaignOpen} onOpenChange={setCampaignOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>حملة جديدة</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>الاسم</Label>
              <Input value={campaignForm.name} onChange={(e) => setCampaignForm({ ...campaignForm, name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>الهدف</Label>
              <Textarea rows={2} value={campaignForm.objective} onChange={(e) => setCampaignForm({ ...campaignForm, objective: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>المنصات</Label>
              <div className="flex flex-wrap gap-3 rounded-lg border p-2 text-sm">
                {CONTENT_PLATFORMS.map((p) => (
                  <label key={p} className="flex items-center gap-1.5">
                    <Checkbox checked={campaignForm.platforms.includes(p)} onCheckedChange={(v) => setCampaignForm({ ...campaignForm, platforms: v ? [...campaignForm.platforms, p] : campaignForm.platforms.filter((x) => x !== p) })} /> {labelOf(p, locale)}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>من</Label>
              <Input type="date" dir="ltr" value={campaignForm.startDate} onChange={(e) => setCampaignForm({ ...campaignForm, startDate: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>إلى</Label>
              <Input type="date" dir="ltr" value={campaignForm.endDate} onChange={(e) => setCampaignForm({ ...campaignForm, endDate: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الجمهور</Label>
              <Input value={campaignForm.targetAudience} onChange={(e) => setCampaignForm({ ...campaignForm, targetAudience: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>الميزانية (ر.ع)</Label>
              <Input type="number" dir="ltr" value={campaignForm.budgetOmr} onChange={(e) => setCampaignForm({ ...campaignForm, budgetOmr: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCampaignOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submitCampaign} disabled={!campaignForm.name.trim() || !campaignForm.objective.trim() || campaignForm.platforms.length === 0}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
