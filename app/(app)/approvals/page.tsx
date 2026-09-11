"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangleIcon, CheckSquareIcon, ClipboardListIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import { MasterDetail, MasterList, MasterListItem, MasterListSkeleton } from "@/components/master-detail";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const STATUS_TABS = ["PENDING", "APPROVED", "EXECUTED", "REJECTED", "ALL"] as const;

export default function ApprovalsPage() {
  const { t, locale } = useT();
  const params = useSearchParams();
  const [status, setStatus] = useState<string>("PENDING");
  const list = useQuery(api.approvals.list, { status: status === "ALL" ? undefined : status, limit: 100 });
  const [chosenId, setSelectedId] = useState<Id<"approvals"> | null>((params.get("id") as Id<"approvals"> | null) ?? null);
  // Fall back to the first row without an effect; the detail panel is keyed by id so its drafts reset on change.
  const selectedId = chosenId ?? list?.[0]?._id ?? null;
  const detail = useQuery(api.approvals.get, selectedId ? { approvalId: selectedId } : "skip");
  const decide = useMutation(api.approvals.decide);
  const [reason, setReason] = useState("");
  const [edited, setEdited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editing = edited !== null;

  async function act(decision: "APPROVED" | "REJECTED" | "EDITED_APPROVED") {
    if (!selectedId) return;
    setBusy(true);
    try {
      let editedPayload: unknown;
      if (decision === "EDITED_APPROVED") {
        editedPayload = JSON.parse(edited ?? "{}");
      }
      await decide({ approvalId: selectedId, decision, reason: reason || undefined, editedPayload });
      toast.success(labelOf(decision, locale));
      setSelectedId(null);
      setReason("");
      setEdited(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const approval = detail?.approval;
  const payload = (approval?.payload ?? {}) as Record<string, unknown>;
  const pendingCount = status === "PENDING" ? list?.length : undefined;

  const listPane = (
    <MasterList>
      {list === undefined && <MasterListSkeleton />}
      {list?.length === 0 && <EmptyState icon={<CheckSquareIcon />} title={t.approvals.empty} className="border-0 bg-transparent" />}
      {list?.map((a) => (
        <MasterListItem key={a._id} selected={a._id === selectedId} onClick={() => setSelectedId(a._id)}>
          <div className="flex items-start justify-between gap-2">
            <span className="line-clamp-2 font-medium leading-5">{a.title}</span>
            <SeverityBadge value={a.severity} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <AgentBadge slug={a.agentSlug} />
            <span>{labelOf(a.kind, locale)}</span>
            <span aria-hidden>·</span>
            <span>{formatRelative(a.requestedAt, locale)}</span>
          </div>
        </MasterListItem>
      ))}
    </MasterList>
  );

  const detailPane = !selectedId ? (
    <Card>
      <CardContent>
        <EmptyState icon={<ClipboardListIcon />} title={t.common.details}>
          {t.approvals.selectOne}
        </EmptyState>
      </CardContent>
    </Card>
  ) : !approval ? (
    <Card>
      <CardContent className="space-y-3" aria-busy>
        <div className="h-5 w-1/2 animate-pulse rounded bg-secondary" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-secondary" />
        <div className="h-24 animate-pulse rounded-lg bg-secondary" />
      </CardContent>
    </Card>
  ) : (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge value={approval.status} />
          <SeverityBadge value={approval.severity} />
          <AgentBadge slug={approval.agentSlug} />
        </div>
        <CardTitle className="text-lg text-balance">{approval.title}</CardTitle>
        {approval.summary && <p className="text-sm leading-6 text-muted-foreground">{approval.summary}</p>}
        <p className="text-xs text-muted-foreground">
          <span dir="ltr">{approval.businessId}</span> · {labelOf(approval.kind, locale)} · {t.approvals.requested}{" "}
          {formatDate(approval.requestedAt, locale, true)}
          {detail?.task && (
            <>
              {" "}
              · {t.tasks.title}: <span dir="ltr">{detail.task.businessId}</span>
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t.approvals.preview}</h3>
          <PayloadPreview kind={approval.kind} payload={payload} />
        </section>

        {approval.status === "PENDING" ? (
          <section className="space-y-4 rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
            <h3 className="text-sm font-semibold">{t.approvals.decision}</h3>
            {editing && (
              <div className="space-y-1.5">
                <Label htmlFor="edited">{t.approvals.edited} (JSON)</Label>
                <Textarea id="edited" dir="ltr" className="font-mono text-xs" rows={8} value={edited ?? ""} onChange={(e) => setEdited(e.target.value)} />
                <p className="text-xs text-muted-foreground">{t.approvals.editHint}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reason">{t.common.reason}</Label>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
              <p className="text-xs text-muted-foreground">{t.approvals.reasonHint}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editing ? (
                <>
                  <Button onClick={() => act("EDITED_APPROVED")} disabled={busy}>
                    {t.common.editAndApprove}
                  </Button>
                  <Button variant="ghost" onClick={() => setEdited(null)} disabled={busy}>
                    {t.common.cancel}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => act("APPROVED")} disabled={busy}>
                    {t.common.approve}
                  </Button>
                  <Button variant="outline" onClick={() => setEdited(JSON.stringify(approval.payload, null, 2))} disabled={busy}>
                    {t.common.edit}
                  </Button>
                </>
              )}
              <span className="flex-1" />
              <Button variant="destructive" onClick={() => act("REJECTED")} disabled={busy || !reason.trim()}>
                {t.common.reject}
              </Button>
            </div>
          </section>
        ) : (
          <section className="space-y-1 rounded-xl border bg-secondary/50 p-4 text-sm">
            <div className="font-medium">
              {labelOf(approval.status, locale)} · {formatDate(approval.decidedAt, locale, true)}
            </div>
            {approval.decisionReason && <div className="text-muted-foreground">{approval.decisionReason}</div>}
            {approval.executionError && <div className="text-destructive-text">{approval.executionError}</div>}
            {approval.executionResult !== undefined && <JsonView value={approval.executionResult} className="mt-2" />}
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">{t.approvals.history}</h3>
          <ol className="relative ms-2 space-y-3 border-s border-border ps-4">
            {detail?.audit.map((a) => (
              <li key={a._id} className="relative text-xs">
                <span className="absolute -start-[21px] top-1 size-2 rounded-full bg-border" aria-hidden />
                <div className="font-medium text-foreground">{a.event}</div>
                <div className="text-muted-foreground">
                  {formatDate(a.at, locale, true)} · {a.actor.type}:<span dir="ltr">{a.actor.id.slice(0, 12)}</span>
                  {a.reason ? ` · ${a.reason}` : ""}
                </div>
              </li>
            ))}
          </ol>
        </section>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t.approvals.title} description={t.approvals.description} />
      <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
        <TabsList>
          {STATUS_TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "ALL" ? t.common.all : labelOf(s, locale)}
              {s === "PENDING" && pendingCount ? (
                <span className="ms-1 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground tabular-nums">{pendingCount}</span>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <MasterDetail list={listPane} detail={detailPane} showDetailOnMobile={chosenId !== null} onBack={() => setSelectedId(null)} />
    </div>
  );
}

function PayloadPreview({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const message =
    typeof payload.message === "string"
      ? payload.message
      : typeof payload.caption === "string"
        ? payload.caption
        : typeof payload.question === "string"
          ? payload.question
          : null;
  return (
    <div className="space-y-3">
      {message && <blockquote className="rounded-lg border border-border bg-card p-4 text-sm leading-7 whitespace-pre-wrap">{message}</blockquote>}
      {kind === "SEND_QUOTE" && Array.isArray(payload.priceWarnings) && (payload.priceWarnings as string[]).length > 0 && (
        <ul className="space-y-1 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-text">
          {(payload.priceWarnings as string[]).map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
      {kind === "OTHER" && Array.isArray(payload.options) && (
        <div className="text-sm">
          <div className="font-medium">الخيارات:</div>
          <ul className="list-disc ps-5">
            {(payload.options as string[]).map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
          {typeof payload.recommendation === "string" && <div className="mt-1 text-muted-foreground">التوصية: {payload.recommendation}</div>}
        </div>
      )}
      <details className="group">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">JSON</summary>
        <JsonView value={payload} className="mt-2" />
      </details>
    </div>
  );
}
