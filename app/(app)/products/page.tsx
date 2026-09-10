"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AskAgentButton } from "@/components/ask-agent-button";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, formatPercent, fromDateInputValue, toDateInputValue } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

type ProposedRate = NonNullable<ReturnType<typeof useQuery<typeof api.rates.proposed>>>[number];

function ConfirmRateDialog({ rate, onClose }: { rate: ProposedRate | null; onClose: () => void }) {
  const { t, locale } = useT();
  const confirm = useMutation(api.rates.confirm);
  const [trust, setTrust] = useState<"SUPPLIER_CONFIRMED" | "CONTRACTED">("SUPPLIER_CONFIRMED");
  const [amount, setAmount] = useState<string>("");
  const [terms, setTerms] = useState("");
  const [validTo, setValidTo] = useState("");
  const [evidence, setEvidence] = useState("");
  if (!rate) return null;
  return (
    <Dialog open={!!rate} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>تأكيد سعر استرشادي {rate.businessId}</DialogTitle>
          <DialogDescription>
            {rate.serviceDescription} — {formatMoney(rate.amount, locale)} · المصدر:{" "}
            <a href={rate.source.url} target="_blank" rel="noreferrer" className="text-primary underline" dir="ltr">
              {rate.source.url}
            </a>{" "}
            · رُصد {formatDate(rate.source.retrievedAt, locale, true)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>مستوى الثقة بعد التأكيد</Label>
            <Select value={trust} onValueChange={(v) => setTrust((v as typeof trust) ?? "SUPPLIER_CONFIRMED")} items={[{ value: "SUPPLIER_CONFIRMED", label: labelOf("SUPPLIER_CONFIRMED", locale) }, { value: "CONTRACTED", label: labelOf("CONTRACTED", locale) }]}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPPLIER_CONFIRMED">{labelOf("SUPPLIER_CONFIRMED", locale)}</SelectItem>
                <SelectItem value="CONTRACTED">{labelOf("CONTRACTED", locale)}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>المبلغ المؤكد ({rate.amount.currency})</Label>
            <Input type="number" dir="ltr" placeholder={String(rate.amount.amount)} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>ساري حتى</Label>
            <Input type="date" dir="ltr" defaultValue={toDateInputValue(rate.validTo)} onChange={(e) => setValidTo(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>مرجع الدليل (بريد/عقد)</Label>
            <Input value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>شروط الإلغاء المؤكدة</Label>
            <Textarea rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={rate.cancellationTerms} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() =>
              confirm({
                rateId: rate._id,
                rateTrust: trust,
                amount: amount ? Number(amount) : undefined,
                currency: rate.amount.currency,
                cancellationTerms: terms || undefined,
                validTo: validTo ? fromDateInputValue(validTo) : undefined,
                evidenceRef: evidence || undefined,
              })
                .then(() => {
                  toast.success(t.common.verify);
                  onClose();
                })
                .catch((e) => toast.error(e.message))
            }
          >
            {t.common.verify}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const { t, locale } = useT();
  const [search, setSearch] = useState("");
  const rows = useQuery(api.records.list, { entity: "products", search: search || undefined, limit: 200 });
  const proposed = useQuery(api.rates.proposed);
  const [confirming, setConfirming] = useState<ProposedRate | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.products}
        description="المنتجات والباقات بإصداراتها ومكوّناتها وأسعارها ومصادرها. الهامش يُحسب تلقائياً من حقول التسعير."
        actions={
          <>
            <AskAgentButton
              label="اطلب تصميم باقة"
              template="صمّم باقة سياحية جديدة: [الوجهة/الوجهات]، [عدد الأيام] أيام، لعائلة من [عدد] أفراد في موسم [الشتاء]. ابحث عن خيارات الفنادق والنقل والأنشطة مع أسعار استرشادية موثقة بالمصدر، واقترح التسعير بهامش 18%، وأعدّ البرنامج اليومي، ثم اطلب تفعيل الباقة."
            />
            <Button nativeButton={false} render={<Link href="/data/products?new=1" />} size="sm">
              {t.data.newRecord}
            </Button>
          </>
        }
      />

      {proposed && proposed.length > 0 && (
        <Card className="border-yellow-300 bg-yellow-50/60 dark:bg-yellow-950/20">
          <CardHeader>
            <CardTitle className="text-base">أسعار استرشادية من بحث الوكلاء بانتظار تأكيدك ({proposed.length})</CardTitle>
            <p className="text-xs text-muted-foreground">كل سعر هنا موسوم ESTIMATED مع رابط المصدر ووقت الرصد؛ لا يدخل عرضاً للعميل قبل تأكيد المورد.</p>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {proposed.slice(0, 12).map((r) => (
              <div key={r._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{r.serviceDescription}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.businessId} · {formatMoney(r.amount, locale)} · {labelOf(r.season, locale)} ·{" "}
                    <a href={r.source.url} target="_blank" rel="noreferrer" className="text-primary underline" dir="ltr">
                      المصدر
                    </a>{" "}
                    · {formatDate(r.source.retrievedAt, locale, true)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <TrustBadge rateTrust={r.rateTrust} freshness={r.freshness} />
                  <Button size="xs" onClick={() => setConfirming(r)}>
                    تأكيد مع المورد
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Input placeholder={t.common.search} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t.common.id}</TableHead>
              <TableHead>الاسم</TableHead>
              <TableHead>{t.common.version}</TableHead>
              <TableHead>{t.common.status}</TableHead>
              <TableHead>المدة</TableHead>
              <TableHead>سعر العميل</TableHead>
              <TableHead>الهامش</TableHead>
              <TableHead>{t.common.trust}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows?.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <EmptyState>{t.common.empty}</EmptyState>
                </TableCell>
              </TableRow>
            )}
            {rows?.map((p) => {
              const r = p as Record<string, unknown> & { pricing?: { customerSellingPrice?: { amount: number; currency: string } }; margin?: { marginPercent: number | null } };
              return (
                <TableRow key={String(r._id)}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {String(r.businessId)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/products/${String(r._id)}`} className="font-medium text-primary underline-offset-4 hover:underline">
                      {String(r.name)}
                    </Link>
                  </TableCell>
                  <TableCell dir="ltr">V{String(r.version)}</TableCell>
                  <TableCell>
                    <StatusBadge value={String(r.status)} />
                  </TableCell>
                  <TableCell>
                    {String(r.durationDays)} أيام / {String(r.durationNights)} ليالٍ
                  </TableCell>
                  <TableCell className="tabular-nums">{formatMoney(r.pricing?.customerSellingPrice, locale)}</TableCell>
                  <TableCell className="tabular-nums">{formatPercent(r.margin?.marginPercent ?? null)}</TableCell>
                  <TableCell>
                    <TrustBadge trustLevel={String(r.trustLevel)} freshness={String(r.freshness)} verificationStatus={String(r.verificationStatus)} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ConfirmRateDialog rate={confirming} onClose={() => setConfirming(null)} />
      <span className="hidden">{(confirming as { _id?: Id<"rates"> } | null)?._id}</span>
    </div>
  );
}
