"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COMPONENT_TYPES, PRODUCT_TRANSITIONS, RATE_BASES } from "@/convex/lib/vocab";
import { AskAgentButton } from "@/components/ask-agent-button";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

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

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { t, locale } = useT();
  const data = useQuery(api.products.costing, { productId: productId as Id<"products"> });
  const pickers = useQuery(api.products.pickers);
  const activate = useMutation(api.products.activate);
  const newVersion = useMutation(api.products.newVersion);
  const removeComponent = useMutation(api.products.removeComponent);
  const addComponent = useMutation(api.products.addComponent);
  const saveDay = useMutation(api.products.saveItineraryDay);
  const updateRecord = useMutation(api.records.update);
  const [componentOpen, setComponentOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState<number | null>(null);
  const [comp, setComp] = useState({ componentType: "HOTEL", description: "", dayNumber: "", quantity: "1", unit: "PER_NIGHT", supplierId: "", hotelId: "", rateId: "", supplierCost: "", customerSellingPrice: "" });
  const [day, setDay] = useState({ title: "", description: "", destinationId: "", overnightHotelId: "", breakfast: true, lunch: false, dinner: false });

  if (data === undefined) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  if (data === null) return <EmptyState>{t.common.empty}</EmptyState>;
  const { product, components, pricing, margin, estimatedComponents, itineraries, family } = data;
  const editable = product.status !== "ACTIVE" && product.status !== "ARCHIVED";
  const nextStatuses = PRODUCT_TRANSITIONS[product.status].filter((s) => s !== "ACTIVE");

  async function submitComponent() {
    try {
      await addComponent({
        productId: product._id,
        componentType: comp.componentType,
        description: comp.description,
        dayNumber: comp.dayNumber ? Number(comp.dayNumber) : undefined,
        quantity: Number(comp.quantity) || 1,
        unit: comp.unit,
        supplierId: (comp.supplierId || undefined) as Id<"suppliers"> | undefined,
        hotelId: (comp.hotelId || undefined) as Id<"hotels"> | undefined,
        rateId: (comp.rateId || undefined) as Id<"rates"> | undefined,
        supplierCost: comp.supplierCost ? { amount: Number(comp.supplierCost), currency: "OMR" } : undefined,
        customerSellingPrice: comp.customerSellingPrice ? { amount: Number(comp.customerSellingPrice), currency: "OMR" } : undefined,
      });
      toast.success(t.common.save);
      setComponentOpen(false);
      setComp({ ...comp, description: "", rateId: "", supplierCost: "", customerSellingPrice: "" });
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
    }
  }

  async function submitDay() {
    if (dayOpen === null) return;
    try {
      await saveDay({
        productId: product._id,
        dayNumber: dayOpen,
        title: day.title,
        description: day.description,
        destinationId: (day.destinationId || undefined) as Id<"destinations"> | undefined,
        overnightHotelId: (day.overnightHotelId || undefined) as Id<"hotels"> | undefined,
        meals: { breakfast: day.breakfast, lunch: day.lunch, dinner: day.dinner },
      });
      toast.success(t.common.save);
      setDayOpen(null);
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${product.name} — V${product.version}`}
        description={`${product.businessId} · ${product.productType} · ${product.durationDays} أيام / ${product.durationNights} ليالٍ · ${labelOf(product.status, locale)}`}
        actions={
          <>
            <StatusBadge value={product.status} />
            <TrustBadge trustLevel={product.trustLevel} freshness={product.freshness} verificationStatus={product.verificationStatus} />
            <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/data/products?id=${product._id}`} />}>
              {t.common.edit}
            </Button>
            {editable && nextStatuses.length > 0 && (
              <Select value={null} onValueChange={(v) => v && updateRecord({ entity: "products", id: product._id, data: { status: String(v) } }).then(() => toast.success(labelOf(String(v), locale))).catch((e) => toast.error(e.data?.message ?? e.message))} items={nextStatuses.map((s) => ({ value: s, label: labelOf(s, locale) }))}>
                <SelectTrigger size="sm" className="w-44">
                  <SelectValue placeholder="الانتقال إلى مرحلة…" />
                </SelectTrigger>
                <SelectContent>
                  {nextStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {labelOf(s, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {product.status === "READY_FOR_SALE" && (
              <Button size="sm" onClick={() => activate({ productId: product._id }).then(() => toast.success(labelOf("ACTIVE", locale))).catch((e) => toast.error(e.data?.message ?? e.message))}>
                تفعيل للبيع
              </Button>
            )}
            {product.status === "ACTIVE" && (
              <>
                <Button size="sm" variant="secondary" onClick={() => newVersion({ productId: product._id, kind: "minor" }).then((r) => toast.success(`V${r.version}`))}>
                  إصدار فرعي V+0.1
                </Button>
                <Button size="sm" variant="secondary" onClick={() => newVersion({ productId: product._id, kind: "major" }).then((r) => toast.success(`V${r.version}`))}>
                  إصدار رئيسي V+1
                </Button>
              </>
            )}
            <AskAgentButton label="اطلب من وكيل المنتجات" template={`راجع المنتج ${product.businessId} (${product.name} V${product.version}): تحقق من المكوّنات والأسعار، وابحث عن بدائل أفضل سعراً مع مصادر موثقة، وحدّث البرنامج اليومي إن لزم، وقدّم ملخصاً بالهامش.`} />
          </>
        }
      />
      {estimatedComponents > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900 dark:bg-yellow-950/30 dark:text-yellow-200">⚠️ {estimatedComponents} مكوّن بسعر استرشادي (ESTIMATED) — يحتاج تأكيداً من المورد قبل استخدامه في عرض للعميل. أكّد الأسعار من صفحة الباقات.</div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">المكوّنات</CardTitle>
            {editable && (
              <Button size="sm" variant="outline" onClick={() => setComponentOpen(true)}>
                إضافة مكوّن
              </Button>
            )}
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>اليوم</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>الوصف</TableHead>
                  <TableHead>الكمية</TableHead>
                  <TableHead>تكلفة المورد</TableHead>
                  <TableHead>سعر العميل</TableHead>
                  <TableHead>ثقة السعر ومصدره</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {components.map((c) => (
                  <TableRow key={c._id}>
                    <TableCell>{c.dayNumber ?? "—"}</TableCell>
                    <TableCell>{c.componentType}</TableCell>
                    <TableCell>{c.description}</TableCell>
                    <TableCell>
                      {c.quantity} × {c.unit}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatMoney(c.pricing.supplierCost, locale)}</TableCell>
                    <TableCell className="tabular-nums">{formatMoney(c.pricing.customerSellingPrice, locale)}</TableCell>
                    <TableCell>
                      <TrustBadge trustLevel={c.trustLevel} rateTrust={c.rateTrust} freshness={c.rate?.freshness} />
                      {c.rate?.source.url && (
                        <a href={c.rate.source.url} target="_blank" rel="noreferrer" className="ms-1 text-xs text-primary underline" dir="ltr">
                          المصدر
                        </a>
                      )}
                      {c.rate?.source.retrievedAt && <span className="ms-1 text-[10px] text-muted-foreground">{formatDate(c.rate.source.retrievedAt, locale, true)}</span>}
                    </TableCell>
                    <TableCell>
                      {editable && (
                        <Button size="xs" variant="ghost" onClick={() => removeComponent({ componentId: c._id }).catch((e) => toast.error(e.message))}>
                          {t.common.archive}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {components.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState>لا مكوّنات بعد — يضيفها وكيل المنتجات أو أنت.</EmptyState>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">التسعير (للفرد)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(["supplierCost", "internalCost", "minSellingPrice", "recommendedSellingPrice", "customerSellingPrice"] as const).map((k) => (
              <div key={k} className="flex justify-between">
                <span className="text-muted-foreground">{k}</span>
                <span className="tabular-nums">{formatMoney(product.pricing[k], locale)}</span>
              </div>
            ))}
            <div className="mt-2 border-t pt-2 font-medium">من المكوّنات</div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">إجمالي التكلفة</span>
              <span className="tabular-nums">{formatMoney({ amount: margin.totalCostBase, currency: "OMR" }, locale)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">سعر البيع</span>
              <span className="tabular-nums">{formatMoney(pricing.customerSellingPrice, locale)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>الهامش</span>
              <span className="tabular-nums">
                {formatMoney({ amount: margin.marginBase, currency: "OMR" }, locale)} ({formatPercent(margin.marginPercent)})
              </span>
            </div>
            {product.targetMarginPercent !== undefined && <div className="text-xs text-muted-foreground">الهامش المستهدف {product.targetMarginPercent}%</div>}
            <div className="mt-3 border-t pt-2 text-xs">
              <div className="mb-1 font-medium">الإصدارات</div>
              {family.map((f) => (
                <Link key={f._id} href={`/products/${f._id}`} className="flex justify-between py-0.5 hover:underline">
                  <span dir="ltr">
                    {f.businessId} V{f.version}
                  </span>
                  <StatusBadge value={f.status} />
                </Link>
              ))}
            </div>
            {product.citations.length > 0 && (
              <div className="mt-3 border-t pt-2 text-xs">
                <div className="mb-1 font-medium">{t.tasks.citations}</div>
                {product.citations.slice(0, 8).map((c, i) => (
                  <div key={i} dir="ltr" className="truncate text-muted-foreground">
                    {c.kind === "web" ? c.url : c.kind === "record" ? `${c.table}/${c.recordId}` : `doc ${c.documentId}`}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">البرنامج اليومي</CardTitle>
          {editable && (
            <div className="flex flex-wrap gap-1">
              {Array.from({ length: product.durationDays }, (_, i) => i + 1).map((n) => {
                const existing = itineraries.find((d) => d.dayNumber === n);
                return (
                  <Button
                    key={n}
                    size="xs"
                    variant={existing ? "outline" : "secondary"}
                    onClick={() => {
                      setDay({ title: existing?.title ?? "", description: existing?.description ?? "", destinationId: existing?.destinationId ?? "", overnightHotelId: existing?.overnightHotelId ?? "", breakfast: existing?.meals.breakfast ?? true, lunch: existing?.meals.lunch ?? false, dinner: existing?.meals.dinner ?? false });
                      setDayOpen(n);
                    }}
                  >
                    يوم {n}
                  </Button>
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {itineraries.length === 0 && <EmptyState>لا برنامج يومي مسجّل — أضف الأيام من الأزرار أعلاه أو اطلب من الوكيل.</EmptyState>}
          {itineraries.map((d) => (
            <div key={d._id} className="rounded-md border p-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  اليوم {d.dayNumber}: {d.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {[d.meals.breakfast && "إفطار", d.meals.lunch && "غداء", d.meals.dinner && "عشاء"].filter(Boolean).join(" · ") || "بلا وجبات"}
                </span>
              </div>
              <div className="text-muted-foreground">{d.description}</div>
            </div>
          ))}
          <div className="whitespace-pre-wrap text-muted-foreground">{product.summary}</div>
        </CardContent>
      </Card>

      <Dialog open={componentOpen} onOpenChange={setComponentOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>إضافة مكوّن</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="النوع">
              <Picker value={comp.componentType} onChange={(v) => setComp({ ...comp, componentType: v })} options={COMPONENT_TYPES.map((c) => ({ id: c, label: c }))} />
            </Field>
            <Field label="الوحدة">
              <Picker value={comp.unit} onChange={(v) => setComp({ ...comp, unit: v })} options={RATE_BASES.map((c) => ({ id: c, label: c }))} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="الوصف">
                <Input value={comp.description} onChange={(e) => setComp({ ...comp, description: e.target.value })} />
              </Field>
            </div>
            <Field label="اليوم">
              <Input type="number" dir="ltr" value={comp.dayNumber} onChange={(e) => setComp({ ...comp, dayNumber: e.target.value })} />
            </Field>
            <Field label="الكمية">
              <Input type="number" dir="ltr" value={comp.quantity} onChange={(e) => setComp({ ...comp, quantity: e.target.value })} />
            </Field>
            <Field label="المورد">
              <Picker value={comp.supplierId} onChange={(v) => setComp({ ...comp, supplierId: v })} options={pickers?.suppliers ?? []} />
            </Field>
            <Field label="الفندق">
              <Picker value={comp.hotelId} onChange={(v) => setComp({ ...comp, hotelId: v })} options={(pickers?.hotels ?? []).filter((h) => !comp.supplierId || h.supplierId === comp.supplierId)} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="السعر المرتبط (يملأ تكلفة المورد ويحمل مستوى ثقته)">
                <Picker value={comp.rateId} onChange={(v) => setComp({ ...comp, rateId: v })} options={(pickers?.rates ?? []).filter((r) => (!comp.supplierId || r.supplierId === comp.supplierId) && (!comp.hotelId || r.hotelId === comp.hotelId || !r.hotelId))} />
              </Field>
            </div>
            <Field label="تكلفة المورد (ر.ع، اختياري)">
              <Input type="number" dir="ltr" value={comp.supplierCost} onChange={(e) => setComp({ ...comp, supplierCost: e.target.value })} />
            </Field>
            <Field label="سعر العميل (ر.ع)">
              <Input type="number" dir="ltr" value={comp.customerSellingPrice} onChange={(e) => setComp({ ...comp, customerSellingPrice: e.target.value })} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComponentOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submitComponent} disabled={!comp.description.trim()}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dayOpen !== null} onOpenChange={(o) => !o && setDayOpen(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>اليوم {dayOpen}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="العنوان">
              <Input value={day.title} onChange={(e) => setDay({ ...day, title: e.target.value })} />
            </Field>
            <Field label="الوصف">
              <Textarea rows={4} value={day.description} onChange={(e) => setDay({ ...day, description: e.target.value })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="الوجهة">
                <Picker value={day.destinationId} onChange={(v) => setDay({ ...day, destinationId: v })} options={pickers?.destinations ?? []} />
              </Field>
              <Field label="فندق الإقامة">
                <Picker value={day.overnightHotelId} onChange={(v) => setDay({ ...day, overnightHotelId: v })} options={pickers?.hotels ?? []} />
              </Field>
            </div>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <Checkbox checked={day.breakfast} onCheckedChange={(v) => setDay({ ...day, breakfast: !!v })} /> إفطار
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={day.lunch} onCheckedChange={(v) => setDay({ ...day, lunch: !!v })} /> غداء
              </label>
              <label className="flex items-center gap-1.5">
                <Checkbox checked={day.dinner} onCheckedChange={(v) => setDay({ ...day, dinner: !!v })} /> عشاء
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDayOpen(null)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submitDay} disabled={!day.title.trim()}>
              {t.common.save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
