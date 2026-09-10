"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

export default function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const { t, locale } = useT();
  const data = useQuery(api.products.costing, { productId: productId as Id<"products"> });
  const activate = useMutation(api.products.activate);
  const newVersion = useMutation(api.products.newVersion);
  const removeComponent = useMutation(api.products.removeComponent);

  if (data === undefined) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  if (data === null) return <EmptyState>{t.common.empty}</EmptyState>;
  const { product, components, pricing, margin, estimatedComponents, itineraries, family } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`${product.name} — V${product.version}`}
        description={`${product.businessId} · ${product.productType} · ${product.durationDays} أيام / ${product.durationNights} ليالٍ`}
        actions={
          <>
            <StatusBadge value={product.status} />
            <TrustBadge trustLevel={product.trustLevel} freshness={product.freshness} verificationStatus={product.verificationStatus} />
            <Button size="sm" variant="outline" render={<Link href={`/data/products?id=${product._id}`} />}>
              {t.common.edit}
            </Button>
            {product.status !== "ACTIVE" && product.status !== "ARCHIVED" && (
              <Button size="sm" onClick={() => activate({ productId: product._id }).then(() => toast.success(labelOf("ACTIVE", locale))).catch((e) => toast.error(e.message))}>
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
          </>
        }
      />
      {estimatedComponents > 0 && (
        <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">⚠️ {estimatedComponents} مكوّن بسعر استرشادي (ESTIMATED) — يحتاج تأكيداً من المورد قبل استخدامه في عرض للعميل.</div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">المكوّنات</CardTitle>
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
                  <TableHead>ثقة السعر</TableHead>
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
                      <TrustBadge trustLevel={c.trustLevel} rateTrust={c.rateTrust} />
                    </TableCell>
                    <TableCell>
                      {product.status !== "ACTIVE" && (
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
                      <EmptyState>لا مكوّنات بعد — يضيفها وكيل المنتجات أو أنت من صفحة الإدخال.</EmptyState>
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
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">البرنامج اليومي</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {itineraries.length === 0 && <EmptyState>لا برنامج يومي مسجّل.</EmptyState>}
          {itineraries.map((d) => (
            <div key={d._id} className="rounded-md border p-2">
              <div className="font-medium">
                اليوم {d.dayNumber}: {d.title}
              </div>
              <div className="text-muted-foreground">{d.description}</div>
            </div>
          ))}
          <div className="whitespace-pre-wrap text-muted-foreground">{product.summary}</div>
        </CardContent>
      </Card>
    </div>
  );
}
