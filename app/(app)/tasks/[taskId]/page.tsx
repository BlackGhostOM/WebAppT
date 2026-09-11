"use client";

import { useMutation, useQuery } from "convex/react";
import { AlertTriangleIcon, BanIcon, BrainIcon, ChevronRightIcon, RotateCcwIcon, SquareIcon, StickyNoteIcon, WrenchIcon } from "lucide-react";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatNumber, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"]);
const RETRYABLE = new Set(["FAILED", "CANCELLED", "BUDGET_EXCEEDED"]);

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { t, locale } = useT();
  const data = useQuery(api.tasks.get, { taskId: taskId as Id<"tasks"> });
  const cancel = useMutation(api.tasks.requestCancelTask);
  const retry = useMutation(api.tasks.retry);
  const [stopOpen, setStopOpen] = useState(false);
  const [reason, setReason] = useState("");

  if (data === undefined)
    return (
      <div className="space-y-4" aria-busy>
        <div className="h-7 w-2/3 animate-pulse rounded bg-secondary" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-secondary" />
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl bg-secondary lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl bg-secondary" />
        </div>
      </div>
    );
  if (data === null) return <EmptyState title={t.common.empty} />;
  const { task, runs, children, approvals, parent, usage } = data;
  const active = ACTIVE.has(task.status);

  return (
    <div className="space-y-6">
      <nav aria-label="breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
        <Link href="/tasks" className="hover:text-foreground hover:underline">
          {t.tasks.title}
        </Link>
        <ChevronRightIcon className="size-3.5 rtl:rotate-180" aria-hidden />
        <span dir="ltr">{task.businessId}</span>
      </nav>
      <PageHeader
        className="mb-0"
        title={task.title}
        description={`${labelOf(task.origin, locale)} · ${formatDate(task._creationTime, locale, true)}`}
        actions={
          <>
            <AgentBadge slug={task.agentSlug} />
            <StatusBadge value={task.status} />
            {active && (
              <Button variant="destructive" onClick={() => setStopOpen(true)}>
                <SquareIcon data-icon="inline-start" /> {t.chat.stopWork}
              </Button>
            )}
            {RETRYABLE.has(task.status) && (
              <Button
                onClick={() =>
                  retry({ taskId: task._id })
                    .then(() => toast.success(t.common.retry))
                    .catch((e) => toast.error(e.message))
                }
              >
                <RotateCcwIcon data-icon="inline-start" /> {t.common.retry}
              </Button>
            )}
          </>
        }
      />
      {parent && (
        <p className="text-sm text-muted-foreground">
          {t.tasks.parent}:{" "}
          <Link href={`/tasks/${parent._id}`} className="text-primary-text underline-offset-4 hover:underline">
            <span dir="ltr">{parent.businessId}</span> — {parent.title}
          </Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t.tasks.request}</CardTitle>
            </CardHeader>
            <CardContent>
              <blockquote className="rounded-lg border border-border bg-secondary/50 p-4 text-sm leading-7 whitespace-pre-wrap">{task.request}</blockquote>
            </CardContent>
          </Card>

          {task.error && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive-soft p-4 text-sm text-destructive-text">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div className="min-w-0 whitespace-pre-wrap break-words">{task.error}</div>
            </div>
          )}

          {task.result && (
            <Card className="border-s-4 border-s-success">
              <CardHeader>
                <CardTitle>{t.tasks.result}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 whitespace-pre-wrap">{task.result}</CardContent>
            </Card>
          )}
          {task.partialResult && !task.result && (
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle>{t.tasks.partial}</CardTitle>
              </CardHeader>
              <CardContent className="text-sm leading-7 whitespace-pre-wrap">{task.partialResult}</CardContent>
            </Card>
          )}
          {task.cancelReason && (
            <p className="text-xs text-muted-foreground">
              {t.tasks.stopReason}: {task.cancelReason} — {task.cancelledBy?.type}:<span dir="ltr">{task.cancelledBy?.id.slice(0, 10)}</span>
            </p>
          )}

          {(task.citations.length > 0 || task.feedback.length > 0) && (
            <Card>
              <CardContent className="grid gap-6 md:grid-cols-2">
                {task.citations.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t.tasks.citations}</h3>
                    <ul className="space-y-1 text-xs">
                      {task.citations.map((c, i) => (
                        <li key={i} dir="ltr" className="truncate text-start text-muted-foreground">
                          {c.kind === "document" ? (
                            `document ${c.documentId} v${c.version} ${c.section ?? ""}`
                          ) : c.kind === "record" ? (
                            `${c.table}/${c.recordId}`
                          ) : (
                            <a href={c.url} target="_blank" rel="noreferrer" className="text-primary-text underline-offset-4 hover:underline">
                              {c.url}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {task.feedback.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">{t.tasks.ownerFeedback}</h3>
                    <ul className="list-disc space-y-1 ps-5 text-sm">
                      {task.feedback.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>{t.tasks.summary}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y text-sm">
                <Row label={t.common.status}>
                  <StatusBadge value={task.status} />
                </Row>
                <Row label={t.tasks.cost}>{formatUsd(task.costUsd)}</Row>
                <Row label={t.tasks.tokens}>
                  {formatNumber(task.inputTokens)} / {formatNumber(task.outputTokens)}
                </Row>
                <Row label={t.chat.steps}>{task.stepCount}</Row>
                <Row label={t.tasks.model}>
                  <span dir="ltr" className="font-mono text-xs">
                    {task.model ?? "—"}
                  </span>
                </Row>
                <Row label={t.tasks.createdAt}>{formatDate(task._creationTime, locale, true)}</Row>
                {task.finishedAt && <Row label={t.tasks.finishedAt}>{formatDate(task.finishedAt, locale, true)}</Row>}
              </dl>
              {usage.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
                    {t.tasks.tokens} · {usage.length}
                  </summary>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {usage.map((u) => (
                      <li key={u._id} dir="ltr" className="flex justify-between gap-2 font-mono">
                        <span className="truncate">{u.model}</span>
                        <span className="shrink-0">
                          {u.inputTokens}+{u.cacheReadTokens}c / {u.outputTokens} · {formatUsd(u.costUsd)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          {children.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t.tasks.subtasks}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {children.map((c) => (
                  <Link
                    key={c._id}
                    href={`/tasks/${c._id}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="truncate">{c.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <AgentBadge slug={c.agentSlug} />
                      <StatusBadge value={c.status} />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
          {approvals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t.approvals.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {approvals.map((a) => (
                  <Link
                    key={a._id}
                    href={`/approvals?id=${a._id}`}
                    className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-accent/50"
                  >
                    <span className="truncate">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <SeverityBadge value={a.severity} />
                      <StatusBadge value={a.status} />
                    </span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.tasks.runLog}</CardTitle>
        </CardHeader>
        <CardContent>
          {runs.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          <ol className="relative ms-3 space-y-4 border-s border-border ps-6">
            {runs.map((r) => (
              <RunStep key={r._id} run={r} locale={locale} inputLabel={t.tasks.input} outputLabel={t.tasks.output} stepLabel={t.tasks.step} />
            ))}
          </ol>
        </CardContent>
      </Card>

      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t.chat.stopWork}</DialogTitle>
            <DialogDescription>{task.title}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="cancel-reason">{t.common.reason}</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                cancel({ taskId: task._id, reason })
                  .then(() => {
                    toast.warning(t.common.stop);
                    setStopOpen(false);
                  })
                  .catch((e) => toast.error(e.message))
              }
            >
              {t.chat.stopWork}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end font-medium tabular-nums">{children}</dd>
    </div>
  );
}

type Run = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.get>>>["runs"][number];

const RUN_ICON: Record<string, { icon: typeof BrainIcon; tone: string }> = {
  MODEL_CALL: { icon: BrainIcon, tone: "bg-info-soft text-info-text" },
  TOOL_CALL: { icon: WrenchIcon, tone: "bg-secondary text-muted-foreground" },
  NOTE: { icon: StickyNoteIcon, tone: "bg-warning-soft text-warning-text" },
  CANCELLED: { icon: BanIcon, tone: "bg-destructive-soft text-destructive-text" },
  ERROR: { icon: AlertTriangleIcon, tone: "bg-destructive-soft text-destructive-text" },
};

function RunStep({
  run: r,
  locale,
  inputLabel,
  outputLabel,
  stepLabel,
}: {
  run: Run;
  locale: "ar" | "en";
  inputLabel: string;
  outputLabel: string;
  stepLabel: string;
}) {
  const meta = RUN_ICON[r.kind] ?? { icon: StickyNoteIcon, tone: "bg-secondary text-muted-foreground" };
  const Icon = meta.icon;
  return (
    <li className="relative">
      <span className={cn("absolute -start-[37px] top-0 flex size-6 items-center justify-center rounded-full", meta.tone)} aria-hidden>
        <Icon className="size-3.5" />
      </span>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {stepLabel} {r.stepIndex} · {r.kind}
          {r.toolName ? ` · ${r.toolName}` : ""}
          {r.model ? (
            <>
              {" · "}
              <span dir="ltr" className="font-mono">
                {r.model}
              </span>
            </>
          ) : null}
        </span>
        <span className="tabular-nums">
          {formatDate(r.createdAt, locale, true)}
          {r.durationMs !== undefined ? ` · ${formatNumber(r.durationMs)}ms` : ""}
          {r.costUsd !== undefined ? ` · ${formatUsd(r.costUsd)}` : ""}
        </span>
      </div>
      {r.note && <div className="mt-1 text-sm leading-6">{r.note}</div>}
      {(r.input !== undefined || r.output !== undefined) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.input !== undefined && (
            <details className="min-w-0 flex-1 basis-64">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">{inputLabel}</summary>
              <JsonView value={r.input} className="mt-1 max-h-60" />
            </details>
          )}
          {r.output !== undefined && (
            <details className="min-w-0 flex-1 basis-64">
              <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">{outputLabel}</summary>
              <JsonView value={r.output} className="mt-1 max-h-60" />
            </details>
          )}
        </div>
      )}
    </li>
  );
}
