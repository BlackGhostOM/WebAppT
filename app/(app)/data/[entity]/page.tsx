"use client";

import { useMutation, useQuery } from "convex/react";
import { ArchiveIcon, ChevronRightIcon, PencilIcon, SearchIcon, ShieldCheckIcon, TableIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { ImportDialog } from "@/components/data/import-dialog";
import { RecordFormDialog } from "@/components/data/record-form";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ENTITIES, type EntityKey } from "@/lib/entities";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
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
  const rows = useQuery(
    api.records.list,
    def ? { entity: def.key, search: search || undefined, status: status === "ALL" ? undefined : status, limit: 200 } : "skip",
  ) as AnyRecord[] | undefined;
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"));
  const detail = useQuery(api.records.get, def && selectedId ? { entity: def.key, id: selectedId } : "skip");
  // `?new=1` opens the create form on first render.
  const [formOpen, setFormOpen] = useState(() => params.get("new") === "1");
  const [editing, setEditing] = useState<AnyRecord | undefined>(undefined);
  const [importOpen, setImportOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState("");
  const archive = useMutation(api.records.archive);
  const verify = useMutation(api.records.verify);

  if (!def) return <EmptyState title={t.data.unknownEntity} />;
  const columns = def.fields.filter((f) => !f.sensitive && f.type !== "textarea").slice(0, 6);
  const record = detail?.record as AnyRecord | undefined;
  const title = locale === "ar" ? def.labelAr : def.labelEn;

  return (
    <div className="space-y-4">
      <nav aria-label="breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/data" className="hover:text-foreground hover:underline">
          {t.data.title}
        </Link>
        <ChevronRightIcon className="size-3.5 rtl:rotate-180" aria-hidden />
        <span>{title}</span>
      </nav>
      <PageHeader
        className="mb-0"
        title={title}
        description={def.hintAr}
        actions={
          <>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              {t.data.import}
            </Button>
            <Button
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-hint" aria-hidden />
          <Input placeholder={t.common.search} aria-label={t.common.search} value={search} onChange={(e) => setSearch(e.target.value)} className="ps-9" />
        </div>
        <Select
          value={status}
          onValueChange={(v) => setStatus(String(v ?? "ALL"))}
          items={[{ value: "ALL", label: t.common.all }, ...def.statusOptions.map((s) => ({ value: s, label: labelOf(s, locale) }))]}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label={t.common.status}>
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
        {rows && (
          <span className="ms-auto text-xs text-muted-foreground tabular-nums">
            {formatNumber(rows.length)} {t.data.records}
          </span>
        )}
      </div>

      <div className={cn("grid gap-4 lg:items-start", selectedId ? "xl:grid-cols-[1fr_400px]" : "")}>
        <div className="max-h-[70dvh] overflow-auto rounded-xl border border-border bg-card">
          <Table className="[&_tbody_tr:nth-child(even)]:bg-secondary/30">
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
              {rows === undefined &&
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} aria-hidden>
                    <TableCell colSpan={columns.length + 2}>
                      <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
                    </TableCell>
                  </TableRow>
                ))}
              {rows?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length + 2} className="whitespace-normal">
                    <EmptyState
                      icon={<TableIcon />}
                      title={t.common.empty}
                      className="border-0 bg-transparent"
                      action={
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(undefined);
                            setFormOpen(true);
                          }}
                        >
                          {t.data.newRecord}
                        </Button>
                      }
                    />
                  </TableCell>
                </TableRow>
              )}
              {rows?.map((r) => (
                <TableRow key={r._id} className="cursor-pointer" aria-selected={r._id === selectedId} onClick={() => setSelectedId(r._id)}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {String(r.businessId)}
                  </TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.name} className="max-w-56 truncate">
                      {c.name === def.statusField ? (
                        <StatusBadge value={String(r[c.name])} />
                      ) : c.type === "ref" ? (
                        String(r[c.name] ?? "—").slice(0, 8)
                      ) : (
                        cell(r[c.name] ?? (r.pricing as Record<string, unknown> | undefined)?.[c.name], locale)
                      )}
                    </TableCell>
                  ))}
                  <TableCell>
                    <TrustBadge
                      trustLevel={r.trustLevel as string}
                      freshness={r.freshness as string | undefined}
                      verificationStatus={r.verificationStatus as string}
                      rateTrust={r.rateTrust as string | undefined}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {selectedId && (
          <Card className="gap-0 py-0 xl:sticky xl:top-20 xl:max-h-[calc(100dvh-6rem)] xl:overflow-auto">
            {!record ? (
              <CardContent className="space-y-3 py-4" aria-busy>
                <div className="h-5 w-1/2 animate-pulse rounded bg-secondary" />
                <div className="h-40 animate-pulse rounded-lg bg-secondary" />
              </CardContent>
            ) : (
              <>
                <CardHeader className="border-b py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-heading text-base font-semibold">{String(record[def.titleField])}</div>
                      <div className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {String(record.businessId)}
                      </div>
                    </div>
                    <Button size="icon-sm" variant="ghost" aria-label={t.common.close} onClick={() => setSelectedId(null)}>
                      <XIcon />
                    </Button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TrustBadge
                      trustLevel={record.trustLevel as string}
                      freshness={record.freshness as string | undefined}
                      verificationStatus={record.verificationStatus as string}
                      rateTrust={record.rateTrust as string | undefined}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {record.verificationStatus !== "HUMAN_VERIFIED" && (
                      <Button
                        size="sm"
                        onClick={() =>
                          verify({ entity: def.key, id: record._id })
                            .then(() => toast.success(t.common.verify))
                            .catch((e) => toast.error(e.message))
                        }
                      >
                        <ShieldCheckIcon data-icon="inline-start" /> {t.common.verify}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={record.verificationStatus === "HUMAN_VERIFIED" ? "default" : "outline"}
                      onClick={() => {
                        setEditing(record);
                        setFormOpen(true);
                      }}
                    >
                      <PencilIcon data-icon="inline-start" /> {t.common.edit}
                    </Button>
                    {!record.archivedAt && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ms-auto text-destructive-text hover:bg-destructive-soft"
                        onClick={() => setArchiveOpen(true)}
                      >
                        <ArchiveIcon data-icon="inline-start" /> {t.common.archive}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 py-4 text-sm">
                  <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
                    {def.fields.map((f) => {
                      const value = record[f.name] ?? (record.pricing as Record<string, unknown> | undefined)?.[f.name];
                      if (value === undefined) return null;
                      return (
                        <div key={f.name} className="contents">
                          <dt className="text-xs leading-6 text-muted-foreground">{locale === "ar" ? f.labelAr : f.labelEn}</dt>
                          <dd className="leading-6 break-words whitespace-pre-wrap">
                            {f.name === def.statusField ? <StatusBadge value={String(value)} /> : cell(value, locale)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <details className="text-xs">
                    <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">{t.common.source}</summary>
                    <JsonView value={record.source} className="mt-2 max-h-40" />
                  </details>
                  {record.margin !== undefined && (
                    <details className="text-xs">
                      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">{t.data.margin}</summary>
                      <JsonView value={record.margin} className="mt-2 max-h-40" />
                    </details>
                  )}
                  <div>
                    <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{t.data.auditTrail}</h3>
                    <ol className="relative ms-2 space-y-2 border-s border-border ps-4 text-xs">
                      {detail?.audit.map((a) => (
                        <li key={a._id} className="relative">
                          <span className="absolute -start-[21px] top-1.5 size-2 rounded-full bg-border" aria-hidden />
                          <div className="font-medium">
                            {a.event} <span className="font-normal text-muted-foreground">({a.severity})</span>
                          </div>
                          <div className="text-muted-foreground">
                            {formatDate(a.at, locale, true)} · {a.actor.type}:<span dir="ltr">{a.actor.id.slice(0, 10)}</span>
                            {a.newValue !== undefined && a.event === "UPDATE" && <span dir="ltr"> · {Object.keys(a.newValue as object).join(", ")}</span>}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                </CardContent>
              </>
            )}
          </Card>
        )}
      </div>

      <RecordFormDialog def={def} open={formOpen} onOpenChange={setFormOpen} existing={editing} onSaved={(id) => setSelectedId(id)} />
      <ImportDialog def={def} open={importOpen} onOpenChange={setImportOpen} />

      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.data.archiveTitle}</DialogTitle>
            <DialogDescription>{t.data.archiveHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="archive-reason">{t.common.reason}</Label>
            <Input id="archive-reason" value={archiveReason} onChange={(e) => setArchiveReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setArchiveOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              disabled={!archiveReason.trim() || !record}
              onClick={() =>
                record &&
                archive({ entity: def.key, id: record._id, reason: archiveReason.trim() })
                  .then(() => {
                    setArchiveOpen(false);
                    setArchiveReason("");
                    setSelectedId(null);
                    toast.success(t.common.archive);
                  })
                  .catch((e) => toast.error(e.message))
              }
            >
              {t.common.archive}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
