"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatDate, formatNumber, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"]);

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { t, locale } = useT();
  const data = useQuery(api.tasks.get, { taskId: taskId as Id<"tasks"> });
  const cancel = useMutation(api.tasks.requestCancelTask);
  const retry = useMutation(api.tasks.retry);
  const [reason, setReason] = useState("");

  if (data === undefined) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  if (data === null) return <EmptyState>{t.common.empty}</EmptyState>;
  const { task, runs, children, approvals, parent, usage } = data;

  return (
    <div className="space-y-4">
      <PageHeader
        title={task.title}
        description={`${task.businessId} · ${labelOf(task.origin, locale)} · ${formatDate(task._creationTime, locale, true)}`}
        actions={
          <>
            <AgentBadge slug={task.agentSlug} />
            <StatusBadge value={task.status} />
            {ACTIVE.has(task.status) && (
              <span className="flex items-center gap-1">
                <Input placeholder={t.common.reason} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 w-40" />
                <Button variant="destructive" size="sm" onClick={() => cancel({ taskId: task._id, reason }).then(() => toast.warning(t.common.stop))}>
                  {t.chat.stopWork}
                </Button>
              </span>
            )}
            {["FAILED", "CANCELLED", "BUDGET_EXCEEDED"].includes(task.status) && (
              <Button size="sm" variant="outline" onClick={() => retry({ taskId: task._id }).then(() => toast.success(t.common.retry)).catch((e) => toast.error(e.message))}>
                {t.common.retry}
              </Button>
            )}
          </>
        }
      />
      {parent && (
        <p className="text-sm text-muted-foreground">
          ↑ {t.tasks.subtasks}:{" "}
          <Link href={`/tasks/${parent._id}`} className="text-primary underline-offset-4 hover:underline">
            {parent.businessId} — {parent.title}
          </Link>
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t.tasks.request}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="whitespace-pre-wrap rounded-md bg-muted p-3">{task.request}</div>
            {task.result && (
              <>
                <h3 className="font-medium">{t.tasks.result}</h3>
                <div className="whitespace-pre-wrap rounded-md border p-3">{task.result}</div>
              </>
            )}
            {task.partialResult && !task.result && (
              <>
                <h3 className="font-medium">{t.tasks.partial}</h3>
                <div className="whitespace-pre-wrap rounded-md border border-dashed p-3">{task.partialResult}</div>
              </>
            )}
            {task.error && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-destructive">{task.error}</div>}
            {task.cancelReason && (
              <div className="text-xs text-muted-foreground">
                {t.common.stop}: {task.cancelReason} — {task.cancelledBy?.type}:{task.cancelledBy?.id.slice(0, 10)}
              </div>
            )}
            {task.citations.length > 0 && (
              <div>
                <h3 className="font-medium">{t.tasks.citations}</h3>
                <ul className="list-disc ps-5 text-xs text-muted-foreground">
                  {task.citations.map((c, i) => (
                    <li key={i} dir="ltr" className="text-start">
                      {c.kind === "document" ? `document ${c.documentId} v${c.version} ${c.section ?? ""}` : c.kind === "record" ? `${c.table}/${c.recordId}` : c.url}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {task.feedback.length > 0 && (
              <div>
                <h3 className="font-medium">ملاحظات المالك</h3>
                <ul className="list-disc ps-5 text-xs">
                  {task.feedback.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t.tasks.cost}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.tasks.cost}</span>
              <span className="tabular-nums">{formatUsd(task.costUsd)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.tasks.tokens}</span>
              <span className="tabular-nums">
                {formatNumber(task.inputTokens)} / {formatNumber(task.outputTokens)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t.chat.steps}</span>
              <span>{task.stepCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">النموذج</span>
              <span dir="ltr" className="font-mono text-xs">
                {task.model ?? "—"}
              </span>
            </div>
            {usage.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                {usage.map((u) => (
                  <li key={u._id} dir="ltr" className="flex justify-between">
                    <span>{u.model}</span>
                    <span>
                      {u.inputTokens}+{u.cacheReadTokens}c / {u.outputTokens} · {formatUsd(u.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {children.length > 0 && (
              <div className="pt-3">
                <h3 className="mb-1 font-medium">{t.tasks.subtasks}</h3>
                {children.map((c) => (
                  <Link key={c._id} href={`/tasks/${c._id}`} className="flex items-center justify-between gap-1 rounded-md border p-1.5 text-xs hover:bg-muted">
                    <span className="truncate">{c.title}</span>
                    <span className="flex items-center gap-1">
                      <AgentBadge slug={c.agentSlug} />
                      <StatusBadge value={c.status} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
            {approvals.length > 0 && (
              <div className="pt-3">
                <h3 className="mb-1 font-medium">{t.approvals.title}</h3>
                {approvals.map((a) => (
                  <Link key={a._id} href={`/approvals?id=${a._id}`} className="flex items-center justify-between gap-1 rounded-md border p-1.5 text-xs hover:bg-muted">
                    <span className="truncate">{a.title}</span>
                    <span className="flex items-center gap-1">
                      <SeverityBadge value={a.severity} />
                      <StatusBadge value={a.status} />
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.tasks.runLog}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2 text-sm">
            {runs.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
            {runs.map((r) => (
              <li key={r._id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                  <span>
                    #{r.stepIndex} · {r.kind}
                    {r.toolName ? ` · ${r.toolName} (${r.toolKind})` : ""}
                    {r.model ? ` · ${r.model}` : ""}
                  </span>
                  <span>
                    {formatDate(r.createdAt, locale, true)}
                    {r.durationMs !== undefined ? ` · ${r.durationMs}ms` : ""}
                    {r.costUsd !== undefined ? ` · ${formatUsd(r.costUsd)}` : ""}
                  </span>
                </div>
                {r.note && <div className="mt-1">{r.note}</div>}
                {r.input !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs">input</summary>
                    <JsonView value={r.input} />
                  </details>
                )}
                {r.output !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs">output</summary>
                    <JsonView value={r.output} />
                  </details>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
