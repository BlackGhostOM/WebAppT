"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import { useT } from "@/lib/i18n";

export default function ProductsPage() {
  const { t, locale } = useT();
  const [search, setSearch] = useState("");
  const rows = useQuery(api.records.list, { entity: "products", search: search || undefined, limit: 200 });

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.products}
        description="المنتجات والباقات بإصداراتها ومكوّناتها وأسعارها ومصادرها. الهامش يُحسب تلقائياً من حقول التسعير."
        actions={
          <Button render={<Link href="/data/products" />} size="sm">
            {t.data.newRecord}
          </Button>
        }
      />
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
    </div>
  );
}
