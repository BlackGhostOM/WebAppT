"use client";

import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export default function ApprovalsPage() {
  const { t, locale } = useT();
  const params = useSearchParams();
  const [status, setStatus] = useState<string>("PENDING");
  const list = useQuery(api.approvals.list, { status: status === "ALL" ? undefined : status, limit: 100 });
  const [selectedId, setSelectedId] = useState<Id<"approvals"> | null>((params.get("id") as Id<"approvals"> | null) ?? null);
  const detail = useQuery(api.approvals.get, selectedId ? { approvalId: selectedId } : "skip");
  const decide = useMutation(api.approvals.decide);
  const [reason, setReason] = useState("");
  const [edited, setEdited] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!selectedId && list && list.length > 0) setSelectedId(list[0]._id);
  }, [list, selectedId]);

  useEffect(() => {
    if (detail?.approval) {
      setEdited(JSON.stringify(detail.approval.payload, null, 2));
      setReason("");
      setEditing(false);
    }
  }, [detail?.approval?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(decision: "APPROVED" | "REJECTED" | "EDITED_APPROVED") {
    if (!selectedId) return;
    try {
      let editedPayload: unknown;
      if (decision === "EDITED_APPROVED") {
        editedPayload = JSON.parse(edited);
      }
      await decide({ approvalId: selectedId, decision, reason: reason || undefined, editedPayload });
      toast.success(labelOf(decision, locale));
      setSelectedId(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    }
  }

  const approval = detail?.approval;
  const payload = (approval?.payload ?? {}) as Record<string, unknown>;

  return (
    <div className="space-y-4">
      <PageHeader title={t.approvals.title} description="كل إجراء خارجي أو تغيير حساس ينتظر قرارك هنا. سبب الرفض يعود للوكيل ليتعلم." />
      <Tabs value={status} onValueChange={(v) => setStatus(String(v))}>
        <TabsList>
          {["PENDING", "APPROVED", "EXECUTED", "REJECTED", "ALL"].map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "ALL" ? t.common.all : labelOf(s, locale)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card className="max-h-[70vh] overflow-auto">
          <CardContent className="space-y-1 p-2">
            {list?.length === 0 && <EmptyState>{t.approvals.empty}</EmptyState>}
            {list?.map((a) => (
              <button
                key={a._id}
                type="button"
                onClick={() => setSelectedId(a._id)}
                className={cn("w-full rounded-md border p-2 text-start text-sm hover:bg-muted", a._id === selectedId && "border-primary bg-muted")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{a.title}</span>
                  <SeverityBadge value={a.severity} />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                  <AgentBadge slug={a.agentSlug} />
                  <StatusBadge value={a.kind} />
                  <span>{formatRelative(a.requestedAt, locale)}</span>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>

        <Card>
          {!approval ? (
            <CardContent className="p-6">
              <EmptyState>{t.common.details}</EmptyState>
            </CardContent>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                  <span>{approval.title}</span>
                  <span className="flex items-center gap-1">
                    <StatusBadge value={approval.status} />
                    <SeverityBadge value={approval.severity} />
                    <AgentBadge slug={approval.agentSlug} />
                  </span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{approval.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {approval.businessId} · {labelOf(approval.kind, locale)} · {formatDate(approval.requestedAt, locale, true)}
                  {detail?.task && ` · ${t.tasks.title}: ${detail.task.businessId}`}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <section>
                  <h3 className="mb-1 text-sm font-medium">{t.approvals.preview}</h3>
                  <PayloadPreview kind={approval.kind} payload={payload} />
                </section>
                {approval.status === "PENDING" ? (
                  <section className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="reason">{t.approvals.rejectReason}</Label>
                      <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
                    </div>
                    {editing && (
                      <div className="space-y-1.5">
                        <Label htmlFor="edited">{t.approvals.edited} (JSON)</Label>
                        <Textarea id="edited" dir="ltr" className="font-mono text-xs" rows={8} value={edited} onChange={(e) => setEdited(e.target.value)} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => act("APPROVED")}>{t.common.approve}</Button>
                      {editing ? (
                        <Button variant="secondary" onClick={() => act("EDITED_APPROVED")}>
                          {t.common.editAndApprove}
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={() => setEditing(true)}>
                          {t.common.edit}
                        </Button>
                      )}
                      <Button variant="destructive" onClick={() => act("REJECTED")} disabled={!reason.trim()}>
                        {t.common.reject}
                      </Button>
                    </div>
                  </section>
                ) : (
                  <section className="text-sm">
                    <div>
                      {labelOf(approval.status, locale)} · {formatDate(approval.decidedAt, locale, true)}
                    </div>
                    {approval.decisionReason && <div className="text-muted-foreground">{approval.decisionReason}</div>}
                    {approval.executionError && <div className="text-destructive">{approval.executionError}</div>}
                    {approval.executionResult !== undefined && <JsonView value={approval.executionResult} className="mt-2" />}
                  </section>
                )}
                <section>
                  <h3 className="mb-1 text-sm font-medium">{t.approvals.history}</h3>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {detail?.audit.map((a) => (
                      <li key={a._id}>
                        {formatDate(a.at, locale, true)} · {a.event} · {a.actor.type}:{a.actor.id.slice(0, 12)} {a.reason ? `· ${a.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                </section>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

function PayloadPreview({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const message = typeof payload.message === "string" ? payload.message : typeof payload.caption === "string" ? payload.caption : typeof payload.question === "string" ? payload.question : null;
  return (
    <div className="space-y-2">
      {message && <div className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm">{message}</div>}
      {kind === "SEND_QUOTE" && Array.isArray(payload.priceWarnings) && (payload.priceWarnings as string[]).length > 0 && (
        <ul className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
          {(payload.priceWarnings as string[]).map((w) => (
            <li key={w}>⚠️ {w}</li>
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
      <JsonView value={payload} />
    </div>
  );
}
