"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { UploadCloudIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AGENT_SLUGS, CLASSIFICATIONS, DOCUMENT_TYPES, DOMAINS } from "@/convex/lib/vocab";
import { StatusBadge, TrustBadge } from "@/components/badges";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, fromDateInputValue } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface UploadMeta {
  title: string;
  documentType: string;
  domain: string;
  language: "ar" | "en";
  classification: string;
  allowedAgents: string[];
  relatedTable: string;
  relatedRecordId: string;
  validFrom?: number;
  validTo?: number;
}

const DEFAULT_META: UploadMeta = { title: "", documentType: "POLICY", domain: "CORPORATE_HR_ADMIN", language: "ar", classification: "INTERNAL", allowedAgents: [...AGENT_SLUGS], relatedTable: "", relatedRecordId: "" };

function UploadDialog({ open, onOpenChange, supersedes }: { open: boolean; onOpenChange: (o: boolean) => void; supersedes?: { _id: Id<"documents">; title: string; documentType: string; domain: string; classification: string; allowedAgents: string[]; language: "ar" | "en" } }) {
  const { t, locale } = useT();
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const register = useMutation(api.documents.register);
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState<UploadMeta>(supersedes ? { ...DEFAULT_META, title: supersedes.title, documentType: supersedes.documentType, domain: supersedes.domain, classification: supersedes.classification, allowedAgents: supersedes.allowedAgents, language: supersedes.language } : DEFAULT_META);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    if (!meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, "") }));
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error(`UPLOAD_FAILED_${res.status}`);
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await register({
        title: meta.title.trim() || file.name,
        documentType: meta.documentType,
        domain: meta.domain,
        language: meta.language,
        classification: meta.classification,
        allowedAgents: meta.allowedAgents,
        relatedEntity: meta.relatedTable && meta.relatedRecordId ? { table: meta.relatedTable, recordId: meta.relatedRecordId } : undefined,
        storageId,
        mimeType: file.type || undefined,
        sizeBytes: file.size,
        originalFileName: file.name,
        validFrom: meta.validFrom,
        validTo: meta.validTo,
        supersedesDocumentId: supersedes?._id,
      });
      toast.success("رُفع المستند وبدأت المعالجة (استخراج → اقتراح بيانات → فهرسة → مراجعة)");
      onOpenChange(false);
      setFile(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const sel = (label: string, value: string, options: readonly string[], onChange: (v: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options.map((o) => ({ value: o, label: labelOf(o, locale) }))}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {labelOf(o, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{supersedes ? `${t.knowledge.newVersion}: ${supersedes.title}` : t.knowledge.upload}</DialogTitle>
          <DialogDescription>{t.knowledge.notVisible}</DialogDescription>
        </DialogHeader>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn("flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm text-muted-foreground", dragging && "border-primary bg-muted")}
        >
          <UploadCloudIcon className="size-6" />
          {file ? (
            <span dir="ltr">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </span>
          ) : (
            t.knowledge.dropHere
          )}
          <input ref={inputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json,image/*" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>العنوان</Label>
            <Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </div>
          {sel(t.knowledge.documentType, meta.documentType, DOCUMENT_TYPES, (v) => setMeta({ ...meta, documentType: v }))}
          {sel(t.knowledge.domain, meta.domain, DOMAINS, (v) => setMeta({ ...meta, domain: v }))}
          {sel(t.knowledge.languageLabel, meta.language, ["ar", "en"], (v) => setMeta({ ...meta, language: v as "ar" | "en" }))}
          {sel(t.knowledge.classification, meta.classification, CLASSIFICATIONS, (v) => setMeta({ ...meta, classification: v }))}
          <div className="flex flex-col gap-1.5">
            <Label>{t.knowledge.validFrom}</Label>
            <Input type="date" dir="ltr" onChange={(e) => setMeta({ ...meta, validFrom: fromDateInputValue(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.knowledge.validTo}</Label>
            <Input type="date" dir="ltr" onChange={(e) => setMeta({ ...meta, validTo: fromDateInputValue(e.target.value) })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.knowledge.relatedEntity} — الجدول</Label>
            <Input placeholder="suppliers / products / destinations" dir="ltr" value={meta.relatedTable} onChange={(e) => setMeta({ ...meta, relatedTable: e.target.value.trim() })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t.knowledge.relatedEntity} — المعرّف</Label>
            <Input dir="ltr" value={meta.relatedRecordId} onChange={(e) => setMeta({ ...meta, relatedRecordId: e.target.value.trim() })} />
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label>{t.knowledge.allowedAgents}</Label>
            <div className="flex flex-wrap gap-3 rounded-lg border p-2 text-sm">
              {AGENT_SLUGS.map((a) => (
                <label key={a} className="flex items-center gap-1.5">
                  <Checkbox checked={meta.allowedAgents.includes(a)} onCheckedChange={(v) => setMeta({ ...meta, allowedAgents: v ? [...meta.allowedAgents, a] : meta.allowedAgents.filter((x) => x !== a) })} />
                  {labelOf(a, locale)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={!file || busy}>
            {busy ? t.common.loading : t.knowledge.upload}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function KnowledgePage() {
  const { t, locale } = useT();
  const docs = useQuery(api.documents.list, {});
  const [selectedId, setSelectedId] = useState<Id<"documents"> | null>(null);
  const detail = useQuery(api.documents.get, selectedId ? { documentId: selectedId } : "skip");
  const approve = useMutation(api.documents.approve);
  const archive = useMutation(api.documents.archive);
  const reindex = useMutation(api.documents.reindex);
  const decideProposal = useMutation(api.documents.decideProposal);
  const search = useAction(api.knowledge.search.search);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [versionOf, setVersionOf] = useState<NonNullable<typeof detail>["document"] | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Awaited<ReturnType<typeof search>> | null>(null);

  const doc = detail?.document;

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.knowledge.title}
        description="رفع → استخراج النص → اقتراح بيانات وصفية (AI_EXTRACTED) → تقطيع وفهرسة → مراجعة → اعتمادك → فعّال. لا يرى الوكلاء أي مستند قبل اعتماده، والإصدار القديم يبقى SUPERSEDED."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <UploadCloudIcon data-icon="inline-start" /> {t.knowledge.upload}
          </Button>
        }
      />
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!q.trim()) return;
          try {
            setHits(await search({ query: q, limit: 6 }));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : t.common.error);
          }
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.knowledge.searchKnowledge} className="max-w-md" />
        <Button type="submit" variant="outline">
          {t.common.search}
        </Button>
      </form>
      {hits && (
        <Card>
          <CardContent className="space-y-2 p-3 text-sm">
            {hits.length === 0 && <EmptyState>لا مقاطع معتمدة تطابق السؤال.</EmptyState>}
            {hits.map((h, i) => (
              <div key={i} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    {h.documentBusinessId} · {h.title} · V{h.version} {h.section ? `· ${h.section}` : ""}
                  </span>
                  <TrustBadge trustLevel={h.trustLevel} freshness={h.freshness} />
                </div>
                <div className="mt-1 line-clamp-4 whitespace-pre-wrap">{h.text}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      <div className={cn("grid gap-4", selectedId ? "xl:grid-cols-[1fr_420px]" : "")}>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.id}</TableHead>
                <TableHead>العنوان</TableHead>
                <TableHead>{t.knowledge.documentType}</TableHead>
                <TableHead>{t.common.version}</TableHead>
                <TableHead>{t.knowledge.lifecycle}</TableHead>
                <TableHead>{t.common.freshness}</TableHead>
                <TableHead>{t.knowledge.chunks}</TableHead>
                <TableHead>{t.knowledge.citations}</TableHead>
                <TableHead>{t.knowledge.proposals}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState>{t.common.empty}</EmptyState>
                  </TableCell>
                </TableRow>
              )}
              {docs?.map((d) => (
                <TableRow key={d._id} className={cn("cursor-pointer", d._id === selectedId && "bg-muted")} onClick={() => setSelectedId(d._id)}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {d.businessId}
                  </TableCell>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell>{d.documentType}</TableCell>
                  <TableCell dir="ltr">V{d.version}</TableCell>
                  <TableCell>
                    <StatusBadge value={d.lifecycle} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge value={d.freshness} />
                  </TableCell>
                  <TableCell>{d.extractionStatus === "EXTRACTED" ? d.chunkCount : labelOf(d.extractionStatus, locale)}</TableCell>
                  <TableCell>{d.citationCount}</TableCell>
                  <TableCell>{d.proposalsPending > 0 ? <span className="font-medium text-warning-text">{d.proposalsPending}</span> : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {selectedId && doc && (
          <Card className="max-h-[80vh] overflow-auto">
            <CardContent className="space-y-3 p-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{doc.title}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">
                    {doc.businessId} · V{doc.version} · {doc.originalFileName}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <StatusBadge value={doc.lifecycle} />
                  <TrustBadge trustLevel={doc.trustLevel} freshness={doc.freshness} verificationStatus={doc.verificationStatus} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {(doc.lifecycle === "REVIEW" || doc.lifecycle === "DRAFT") && (
                  <Button size="xs" onClick={() => approve({ documentId: doc._id }).then(() => toast.success(labelOf("ACTIVE", locale))).catch((e) => toast.error(e.message))}>
                    {t.knowledge.approve}
                  </Button>
                )}
                <Button size="xs" variant="outline" onClick={() => setVersionOf(doc)}>
                  {t.knowledge.newVersion}
                </Button>
                <Button size="xs" variant="outline" onClick={() => reindex({ documentId: doc._id }).then(() => toast.success("أُعيدت المعالجة"))}>
                  إعادة الفهرسة
                </Button>
                {doc.lifecycle !== "ARCHIVED" && (
                  <Button
                    size="xs"
                    variant="destructive"
                    onClick={() => {
                      const reason = window.prompt(t.common.reason);
                      if (reason) archive({ documentId: doc._id, reason }).catch((e) => toast.error(e.message));
                    }}
                  >
                    {t.knowledge.deactivate}
                  </Button>
                )}
                {detail?.fileUrl && (
                  <Button size="xs" variant="ghost" nativeButton={false} render={<a href={detail.fileUrl} target="_blank" rel="noreferrer" />}>
                    الملف الأصلي
                  </Button>
                )}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">{t.knowledge.documentType}</dt>
                <dd>
                  {doc.documentType} · {doc.domain}
                </dd>
                <dt className="text-muted-foreground">{t.knowledge.classification}</dt>
                <dd>{doc.classification}</dd>
                <dt className="text-muted-foreground">{t.knowledge.allowedAgents}</dt>
                <dd>{doc.allowedAgents.map((a) => labelOf(a, locale)).join("، ")}</dd>
                <dt className="text-muted-foreground">{t.knowledge.validTo}</dt>
                <dd>{formatDate(doc.validTo, locale)}</dd>
                <dt className="text-muted-foreground">الاستخراج</dt>
                <dd>
                  {doc.extractionStatus} {doc.extractionError ? `— ${doc.extractionError}` : `· ${doc.extractedCharCount ?? 0} حرفاً · ${doc.chunkCount} مقطعاً`}
                </dd>
                <dt className="text-muted-foreground">{t.knowledge.citations}</dt>
                <dd>{doc.citationCount}</dd>
              </dl>
              {doc.aiMetadata && (
                <div className="rounded-md border border-dashed p-2 text-xs">
                  <div className="mb-1 font-medium">{t.knowledge.aiMeta}</div>
                  <div>العنوان المقترح: {doc.aiMetadata.suggestedTitle ?? "—"}</div>
                  <div>
                    النوع: {doc.aiMetadata.suggestedType ?? "—"} · النطاق: {doc.aiMetadata.suggestedDomain ?? "—"}
                  </div>
                  <div className="text-muted-foreground">{doc.aiMetadata.summary}</div>
                  <div className="text-primary">{doc.aiMetadata.keywords.join(" · ")}</div>
                  <div className="text-muted-foreground">النموذج: {doc.aiMetadata.model}</div>
                </div>
              )}
              {doc.proposals.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium">{t.knowledge.proposals}</div>
                  <div className="space-y-1">
                    {doc.proposals.map((p) => (
                      <div key={p.id} className="rounded-md border p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <span>
                            {p.kind} · <StatusBadge value={p.status} />
                          </span>
                          {p.status === "PENDING" && (
                            <span className="flex gap-1">
                              <Button size="xs" onClick={() => decideProposal({ documentId: doc._id, proposalId: p.id, decision: "ACCEPTED" }).then(() => toast.success(t.knowledge.acceptProposal)).catch((e) => toast.error(e.message))}>
                                {t.knowledge.acceptProposal}
                              </Button>
                              <Button size="xs" variant="outline" onClick={() => decideProposal({ documentId: doc._id, proposalId: p.id, decision: "REJECTED" })}>
                                {t.common.reject}
                              </Button>
                            </span>
                          )}
                        </div>
                        <JsonView value={p.data} className="mt-1 max-h-32" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail?.family && detail.family.length > 1 && (
                <div className="text-xs">
                  <div className="mb-1 font-medium">الإصدارات</div>
                  {detail.family.map((f) => (
                    <button key={f._id} type="button" className="flex w-full justify-between py-0.5 hover:underline" onClick={() => setSelectedId(f._id)}>
                      <span dir="ltr">
                        {f.businessId} V{f.version}
                      </span>
                      <StatusBadge value={f.lifecycle} />
                    </button>
                  ))}
                </div>
              )}
              {doc.textPreview && (
                <details>
                  <summary className="cursor-pointer text-xs">معاينة النص</summary>
                  <div className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">{doc.textPreview}</div>
                </details>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      {versionOf && <UploadDialog open={!!versionOf} onOpenChange={(o) => !o && setVersionOf(null)} supersedes={{ _id: versionOf._id, title: versionOf.title, documentType: versionOf.documentType, domain: versionOf.domain, classification: versionOf.classification, allowedAgents: versionOf.allowedAgents, language: versionOf.language }} />}
    </div>
  );
}
