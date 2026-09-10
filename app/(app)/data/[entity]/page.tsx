"use client";

import { useMutation, useQuery } from "convex/react";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { ImportDialog } from "@/components/data/import-dialog";
import { RecordFormDialog } from "@/components/data/record-form";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ENTITIES, type EntityKey } from "@/lib/entities";
import { formatDate, formatMoney } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AnyRecord = { _id: string } & Record<string, unknown>;

function cell(value: unknown, locale: "ar" | "en"): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object" && "amount" in (value as object)) return formatMoney(value as { amount: number; currency: string }, locale);
  if (Array.isArray(value)) return value.map((v) => labelOf(String(v), locale)).join("، ");
  if (typeof value === "number" && value > 1_000_000_000_000) return formatDate(value, locale);
  if (typeof value === "boolean") return value ? "✓" : "✗";
  return labelOf(String(value), locale);
}

export default function EntityPage() {
  const { entity } = useParams<{ entity: string }>();
  const params = useSearchParams();
  const { t, locale } = useT();
  const def = ENTITIES[entity as EntityKey];
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("ALL");
  const rows = useQuery(api.records.list, def ? { entity: def.key, search: search || undefined, status: status === "ALL" ? undefined : status, limit: 200 } : "skip") as AnyRecord[] | undefined;
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const detail = useQuery(api.records.get, def && selectedId ? { entity: def.key, id: selectedId } : "skip");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AnyRecord | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const archive = useMutation(api.records.archive);
  const verify = useMutation(api.records.verify);

  useEffect(() => {
    if (params.get("new") === "1") setFormOpen(true);
  }, [params]);

  if (!def) return <EmptyState>كيان غير معروف</EmptyState>;
  const columns = def.fields.filter((f) => !f.sensitive && f.type !== "textarea").slice(0, 6);
  const record = detail?.record as AnyRecord | undefined;

  return (
    <div className="space-y-4">
      <PageHeader
        title={locale === "ar" ? def.labelAr : def.labelEn}
        description={def.hintAr}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              {t.data.import}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              {t.data.newRecord}
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Input placeholder={t.common.search} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={status} onValueChange={(v) => setStatus(String(v ?? "ALL"))} items={[{ value: "ALL", label: t.common.all }, ...def.statusOptions.map((s) => ({ value: s, label: labelOf(s, locale) }))]}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t.common.all}</SelectItem>
            {def.statusOptions.map((s) => (
              <SelectItem key={s} value={s}>
                {labelOf(s, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={cn("grid gap-4", selectedId ? "xl:grid-cols-[1fr_380px]" : "")}>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.id}</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.name}>{locale === "ar" ? c.labelAr : c.labelEn}</TableHead>
                ))}
                <TableHead>{t.common.trust}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length + 2}>
                    <EmptyState>{t.common.empty}</EmptyState>
                  </TableCell>
                </TableRow>
              )}
              {rows?.map((r) => (
                <TableRow key={r._id} className={cn("cursor-pointer", r._id === selectedId && "bg-muted")} onClick={() => setSelectedId(r._id)}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {String(r.businessId)}
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.name} className="max-w-56 truncate">
                      {c.name === def.statusField ? <StatusBadge value={String(r[c.name])} /> : c.type === "ref" ? String(r[c.name] ?? "—").slice(0, 8) : cell(r[c.name] ?? (r.pricing as Record<string, unknown> | undefined)?.[c.name], locale)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <TrustBadge trustLevel={r.trustLevel as string} freshness={r.freshness as string | undefined} verificationStatus={r.verificationStatus as string} rateTrust={r.rateTrust as string | undefined} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {selectedId && (
          <Card className="max-h-[80vh] overflow-auto">
            <CardContent className="space-y-3 p-4 text-sm">
              {!record ? (
                <div className="text-muted-foreground">{t.common.loading}</div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{String(record[def.titleField])}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {String(record.businessId)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => {
                          setEditing(record);
                          setFormOpen(true);
                        }}
                      >
                        {t.common.edit}
                      </Button>
                      {record.verificationStatus !== "HUMAN_VERIFIED" && (
                        <Button size="xs" onClick={() => verify({ entity: def.key, id: record._id }).then(() => toast.success(t.common.verify)).catch((e) => toast.error(e.message))}>
                          {t.common.verify}
                        </Button>
                      )}
                      {!record.archivedAt && (
                        <Button
                          size="xs"
                          variant="destructive"
                          onClick={() => {
                            const reason = window.prompt(t.common.reason);
                            if (reason) archive({ entity: def.key, id: record._id, reason }).then(() => setSelectedId(null)).catch((e) => toast.error(e.message));
                          }}
                        >
                          {t.common.archive}
                        </Button>
                      )}
                      <Button size="xs" variant="ghost" onClick={() => setSelectedId(null)}>
                        {t.common.close}
                      </Button>
                    </div>
                  </div>
                  <TrustBadge trustLevel={record.trustLevel as string} freshness={record.freshness as string | undefined} verificationStatus={record.verificationStatus as string} rateTrust={record.rateTrust as string | undefined} />
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    {def.fields.map((f) => {
                      const value = record[f.name] ?? (record.pricing as Record<string, unknown> | undefined)?.[f.name];
                      if (value === undefined) return null;
                      return (
                        <div key={f.name} className="contents">
                          <dt className="text-muted-foreground">{locale === "ar" ? f.labelAr : f.labelEn}</dt>
                          <dd className="whitespace-pre-wrap break-words">{cell(value, locale)}</dd>
                        </div>
                      );
                    })}
                    <dt className="text-muted-foreground">{t.common.source}</dt>
                    <dd>
                      <JsonView value={record.source} className="max-h-24" />
                    </dd>
                    {record.margin !== undefined && (
                      <>
                        <dt className="text-muted-foreground">الهامش</dt>
                        <dd>
                          <JsonView value={record.margin} className="max-h-24" />
                        </dd>
                      </>
                    )}
                  </dl>
                  <div>
                    <div className="mb-1 text-xs font-medium">{t.data.auditTrail}</div>
                    <ul className="space-y-1 text-[11px] text-muted-foreground">
                      {detail?.audit.map((a) => (
                        <li key={a._id}>
                          {formatDate(a.at, locale, true)} · {a.event} ({a.severity}) · {a.actor.type}:{a.actor.id.slice(0, 10)}
                          {a.newValue !== undefined && a.event === "UPDATE" && <span dir="ltr"> · {Object.keys(a.newValue as object).join(", ")}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <RecordFormDialog def={def} open={formOpen} onOpenChange={setFormOpen} existing={editing} onSaved={(id) => setSelectedId(id)} />
      <ImportDialog def={def} open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
