"use client";

import { useMutation, useQuery } from "convex/react";
import { InboxIcon, MessageSquareTextIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-dialog";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { MasterDetail, MasterList, MasterListItem, MasterListSkeleton } from "@/components/master-detail";
import { EmptyState, MoreLink, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : fallback);

const INBOX_TABS = ["ALL", "NEW", "REPLY_PROPOSED", "ESCALATED", "REPLIED", "CLOSED", "FOLLOW_UPS"] as const;

export default function InboxPage() {
  const { t, locale } = useT();
  const params = useSearchParams();
  const [tab, setTab] = useState<string>("ALL");
  const stats = useQuery(api.inbox.stats);
  const rows = useQuery(api.inbox.list, tab === "FOLLOW_UPS" ? "skip" : { status: tab === "ALL" ? undefined : tab, limit: 150 });
  const [selected, setSelected] = useState<Id<"interactions"> | null>((params.get("id") as Id<"interactions"> | null) ?? null);
  const visible = rows?.filter((r) => tab !== "ALL" || r.direction === "INBOUND" || !r.customerId) ?? rows;
  const currentId = selected ?? visible?.[0]?._id ?? null;

  const listPane = (
    <MasterList>
      {visible === undefined && <MasterListSkeleton rows={6} />}
      {visible?.length === 0 && <EmptyState icon={<InboxIcon />} title={t.common.empty} className="border-0 bg-transparent" />}
      {visible?.map((r) => (
        <MasterListItem key={r._id} selected={currentId === r._id} onClick={() => setSelected(r._id)}>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-medium">{r.customerName ?? r.externalSenderId ?? t.inbox.unknownSender}</span>
            <StatusBadge value={r.status} />
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {labelOf(r.channel, locale)} · {r.direction === "INBOUND" ? t.inbox.inbound : r.direction === "OUTBOUND" ? t.inbox.outbound : t.inbox.note}
            {r.kind && ` · ${labelOf(r.kind, locale)}`} · {formatRelative(r.receivedAt, locale)}
          </div>
          <div className="mt-1.5 line-clamp-2 text-sm leading-5 text-foreground/80">{r.body}</div>
        </MasterListItem>
      ))}
    </MasterList>
  );

  const detailPane = currentId ? (
    <ThreadPanel key={currentId} interactionId={currentId} />
  ) : (
    <Card>
      <CardContent>
        <EmptyState icon={<MessageSquareTextIcon />} title={t.common.details}>
          {t.inbox.selectOne}
        </EmptyState>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.nav.inbox}
        description={t.inbox.description}
        actions={
          <>
            {stats?.instagramMode === "mock" && <SimulateInboundDialog onCreated={(id) => setSelected(id)} />}
            <EndpointsHint />
          </>
        }
      />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          {INBOX_TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "ALL" ? t.common.all : s === "FOLLOW_UPS" ? t.inbox.followUps : labelOf(s, locale)}
              {stats && (s === "NEW" || s === "REPLY_PROPOSED" || s === "ESCALATED") && stats[s] > 0 && (
                <span
                  className={cn(
                    "ms-1 rounded-full px-1.5 text-xs font-semibold tabular-nums",
                    s === "ESCALATED" ? "bg-destructive-text text-white" : "bg-primary text-primary-foreground",
                  )}
                >
                  {stats[s]}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "FOLLOW_UPS" ? (
        <FollowUpsPanel />
      ) : (
        <MasterDetail list={listPane} detail={detailPane} showDetailOnMobile={selected !== null} onBack={() => setSelected(null)} />
      )}
    </div>
  );
}

function EndpointsHint() {
  const { t } = useT();
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) return null;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none rounded px-1 py-1 hover:text-foreground">{t.inbox.webhookUrl}</summary>
      <div className="mt-1 space-y-1 rounded-lg border bg-secondary/60 p-2 text-start" dir="ltr">
        <div>
          <span className="text-foreground">Instagram webhook:</span> <code className="font-mono">{site}/webhooks/instagram</code>
        </div>
        <div>
          <span className="text-foreground">Contact form:</span> <code className="font-mono">POST {site}/api/contact</code> ·{" "}
          <Link href="/contact" className="underline">
            /contact
          </Link>
        </div>
      </div>
    </details>
  );
}

function ThreadPanel({ interactionId }: { interactionId: Id<"interactions"> }) {
  const { t, locale } = useT();
  const data = useQuery(api.inbox.thread, { interactionId });
  const decide = useMutation(api.approvals.decide);
  const replyByOwner = useMutation(api.inbox.replyByOwner);
  const setStatus = useMutation(api.inbox.setStatus);
  const reprocess = useMutation(api.inbox.reprocess);
  const [reply, setReply] = useState("");
  // null = not editing; the panel is keyed by interaction id, so state resets when the selection changes.
  const [edited, setEdited] = useState<string | null>(null);
  const editing = edited !== null;
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (data === undefined)
    return (
      <Card>
        <CardContent className="space-y-3" aria-busy>
          <div className="h-5 w-1/3 animate-pulse rounded bg-secondary" />
          <div className="h-24 animate-pulse rounded-lg bg-secondary" />
          <div className="h-16 animate-pulse rounded-lg bg-secondary" />
        </CardContent>
      </Card>
    );
  if (data === null)
    return (
      <Card>
        <CardContent>
          <EmptyState>{t.common.empty}</EmptyState>
        </CardContent>
      </Card>
    );
  const { interaction, customer, messages, task, escalatedTask, approval, bookings, leads, identities, followUps } = data;
  const pending = approval?.status === "PENDING";
  const canReprocess =
    interaction.direction === "INBOUND" &&
    !["REPLIED", "CLOSED"].includes(interaction.status) &&
    (!task || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) &&
    !pending;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e, t.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
      <Card>
        <CardHeader className="gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-lg">{customer?.fullName ?? interaction.externalSenderId ?? t.inbox.unknownSender}</CardTitle>
              <div className="text-xs text-muted-foreground">
                <span dir="ltr">{interaction.businessId}</span> · {labelOf(interaction.channel, locale)} · {formatDate(interaction.receivedAt, locale, true)}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {interaction.kind && <StatusBadge value={interaction.kind} />}
              <StatusBadge value={interaction.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 text-sm">
          {/* Conversation */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">{t.inbox.thread}</h3>
            <div className="max-h-[45vh] space-y-2 overflow-auto rounded-xl border border-border bg-background p-3">
              {messages.map((m) => (
                <div key={m._id} className={cn("flex", m.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-xl px-3 py-2 text-sm leading-6",
                      m.direction === "INBOUND"
                        ? "bg-card border border-border"
                        : m.direction === "OUTBOUND"
                          ? "bg-primary-soft"
                          : "border border-dashed border-border",
                      m._id === interaction._id && "ring-2 ring-ring/40",
                    )}
                  >
                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-medium">
                        {m.direction === "INBOUND" ? t.inbox.inbound : m.direction === "OUTBOUND" ? t.inbox.outbound : t.inbox.note}
                      </span>
                      <span>{labelOf(m.channel, locale)}</span>
                      <span>{formatDate(m.receivedAt, locale, true)}</span>
                      {m.deliveryStatus && <Badge variant="outline">{labelOf(m.deliveryStatus, locale)}</Badge>}
                    </div>
                    <div className="whitespace-pre-wrap">{m.body}</div>
                    {m.deliveryError && <div className="mt-1 text-xs text-destructive-text">{m.deliveryError}</div>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Decision: proposed reply */}
          {interaction.proposedReply && (
            <section className="space-y-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{t.inbox.proposedReply}</h3>
                <span className="flex items-center gap-1.5">
                  {approval && <SeverityBadge value={approval.severity} />}
                  {approval && <StatusBadge value={approval.status} />}
                  {approval && <MoreLink href={`/approvals?id=${approval._id}`}>{approval.businessId}</MoreLink>}
                </span>
              </div>
              {editing ? (
                <Textarea rows={5} value={edited ?? ""} onChange={(e) => setEdited(e.target.value)} autoFocus />
              ) : (
                <blockquote className="rounded-lg border border-border bg-card p-3 leading-7 whitespace-pre-wrap">{interaction.proposedReply}</blockquote>
              )}
              {pending && approval ? (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="reject-reason">{t.inbox.reason}</Label>
                    <Textarea id="reject-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!editing ? (
                      <>
                        <Button disabled={busy} onClick={() => run(() => decide({ approvalId: approval._id, decision: "APPROVED" }), t.inbox.approveSend)}>
                          {t.inbox.approveSend}
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => setEdited(interaction.proposedReply ?? "")}>
                          {t.common.edit}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          disabled={busy || !(edited ?? "").trim()}
                          onClick={() =>
                            run(
                              () =>
                                decide({
                                  approvalId: approval._id,
                                  decision: "EDITED_APPROVED",
                                  editedPayload: { ...(approval.payload as Record<string, unknown>), message: (edited ?? "").trim() },
                                  reason: reason || undefined,
                                }),
                              t.inbox.editSend,
                            )
                          }
                        >
                          {t.inbox.editSend}
                        </Button>
                        <Button variant="ghost" onClick={() => setEdited(null)}>
                          {t.common.cancel}
                        </Button>
                      </>
                    )}
                    <span className="flex-1" />
                    <Button
                      variant="destructive"
                      disabled={busy || !reason.trim()}
                      onClick={() => run(() => decide({ approvalId: approval._id, decision: "REJECTED", reason }), t.inbox.rejectReply)}
                    >
                      {t.inbox.rejectReply}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{t.inbox.decisionHint}</p>
                </div>
              ) : (
                approval?.decisionReason && <div className="text-xs text-muted-foreground">{approval.decisionReason}</div>
              )}
            </section>
          )}

          {/* Owner's direct reply / status */}
          {interaction.direction === "INBOUND" && interaction.status !== "CLOSED" && (
            <section className="space-y-2">
              <Label htmlFor="owner-reply" className="text-xs font-semibold text-muted-foreground">
                {t.inbox.ownerReply}
              </Label>
              <Textarea id="owner-reply" rows={3} placeholder={t.inbox.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={interaction.proposedReply && pending ? "outline" : "default"}
                  disabled={busy || !reply.trim()}
                  onClick={() =>
                    run(async () => {
                      await replyByOwner({ interactionId, message: reply });
                      setReply("");
                    }, t.inbox.sendReply)
                  }
                >
                  {t.inbox.sendReply}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => setStatus({ interactionId, status: "CLOSED" }), t.inbox.close)}>
                  {t.inbox.close}
                </Button>
              </div>
            </section>
          )}
          {interaction.status === "CLOSED" && (
            <Button variant="outline" disabled={busy} onClick={() => run(() => setStatus({ interactionId, status: "NEW" }), t.inbox.reopen)}>
              {t.inbox.reopen}
            </Button>
          )}

          {/* Processing details (secondary) */}
          <details className="rounded-lg border border-border bg-secondary/40 text-xs">
            <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 font-medium select-none">
              {t.inbox.aiClassification}
              {interaction.aiClassification ? (
                <>
                  <StatusBadge value={interaction.aiClassification.kind} />
                  <span className="text-muted-foreground">
                    {t.inbox.confidence} {Math.round(interaction.aiClassification.confidence * 100)}%
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">{task ? labelOf(task.status, locale) : t.inbox.noTask}</span>
              )}
            </summary>
            <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-muted-foreground">
              {interaction.aiClassification && <span dir="ltr">{interaction.aiClassification.model}</span>}
              {interaction.aiClassification?.escalated && (
                <Badge variant="outline">
                  {t.inbox.escalated}
                  {interaction.aiClassification.escalationReason ? ` (${interaction.aiClassification.escalationReason})` : ""}
                </Badge>
              )}
              {task && (
                <Link href={`/tasks/${task._id}`} className="underline-offset-4 hover:underline">
                  {task.businessId} · {labelOf(task.status, locale)}
                  {task.model ? ` · ${task.model}` : ""}
                </Link>
              )}
              {escalatedTask && (
                <Link href={`/tasks/${escalatedTask._id}`} className="underline-offset-4 hover:underline">
                  {escalatedTask.businessId} · {labelOf(escalatedTask.status, locale)}
                  {escalatedTask.model ? ` · ${escalatedTask.model}` : ""}
                </Link>
              )}
              {task?.error && <span className="text-destructive-text">{task.error}</span>}
              {canReprocess && (
                <Button size="xs" variant="outline" disabled={busy} onClick={() => run(() => reprocess({ interactionId }), t.inbox.reprocess)}>
                  {t.inbox.reprocess}
                </Button>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t.inbox.customer}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {customer ? (
            <>
              <div>
                <div className="font-medium">{customer.fullName}</div>
                <MoreLink href={`/data/customers?id=${customer._id}`} className="text-xs">
                  {customer.businessId}
                </MoreLink>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">{t.inbox.customerType}</dt>
                <dd>{labelOf(customer.customerType, locale)}</dd>
                {customer.phone && (
                  <>
                    <dt className="text-muted-foreground">{t.contact.phone}</dt>
                    <dd dir="ltr" className="text-start">
                      {customer.phone}
                    </dd>
                  </>
                )}
                {customer.email && (
                  <>
                    <dt className="text-muted-foreground">{t.contact.email}</dt>
                    <dd dir="ltr" className="text-start">
                      {customer.email}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t.common.language}</dt>
                <dd>{customer.preferredLanguage === "ar" ? "العربية" : "English"}</dd>
                <dt className="text-muted-foreground">{t.inbox.consent}</dt>
                <dd>
                  <StatusBadge value={customer.consentStatus} />
                </dd>
                <dt className="text-muted-foreground">{t.common.trust}</dt>
                <dd>{labelOf(customer.verificationStatus, locale)}</dd>
              </dl>
              {customer.notes && <div className="rounded-lg bg-secondary p-2 text-xs whitespace-pre-wrap">{customer.notes}</div>}
              {identities.length > 0 && (
                <SideList title={t.inbox.identities}>
                  {identities.map((i, idx) => (
                    <li key={idx} className="text-muted-foreground">
                      {labelOf(i.channel, locale)} {i.handle ? <span dir="ltr">@{i.handle}</span> : ""} · {formatRelative(i.lastSeenAt, locale)}
                    </li>
                  ))}
                </SideList>
              )}
              <SideList title={t.inbox.bookings} empty={bookings.length === 0}>
                {bookings.map((b) => (
                  <li key={b._id} className="flex items-center justify-between gap-2">
                    <span>
                      {b.businessId} · {formatDate(b.travelDateFrom, locale)}
                    </span>
                    <StatusBadge value={b.status} />
                  </li>
                ))}
              </SideList>
              <SideList title={t.inbox.leads} empty={leads.length === 0}>
                {leads.map((l) => (
                  <li key={l._id} className="flex items-center justify-between gap-2">
                    <Link href="/pipeline" className="underline-offset-4 hover:underline">
                      {l.businessId}
                    </Link>
                    <StatusBadge value={l.stage} />
                  </li>
                ))}
              </SideList>
              {followUps.length > 0 && (
                <SideList title={t.inbox.followUps}>
                  {followUps.map((f) => (
                    <li key={f._id} className="flex items-center justify-between gap-2">
                      <span>
                        {labelOf(f.kind, locale)} · {formatDate(f.dueAt, locale)}
                      </span>
                      <StatusBadge value={f.status} />
                    </li>
                  ))}
                </SideList>
              )}
            </>
          ) : (
            <EmptyState>{t.inbox.unknownSender}</EmptyState>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SideList({ title, empty, children }: { title: string; empty?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold text-muted-foreground">{title}</div>
      {empty ? <div className="text-xs text-hint">—</div> : <ul className="space-y-1 text-xs">{children}</ul>}
    </div>
  );
}

function FollowUpsPanel() {
  const { t, locale } = useT();
  const rows = useQuery(api.followUps.list, { limit: 200 });
  const runNow = useMutation(api.followUps.runNow);
  const skip = useMutation(api.followUps.skip);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const r = await runNow({});
      toast.success(`مجدولة: ${r.scheduled} · مقترحة للاعتماد: ${r.proposed} · متخطاة: ${r.skipped} · ملغاة: ${r.cancelled}`);
    } catch (e) {
      toast.error(errMsg(e, t.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 py-4">
        <div>
          <CardTitle>{t.inbox.followUps}</CardTitle>
          <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">{t.inbox.followUpsHint}</p>
        </div>
        <Button variant="outline" disabled={busy} onClick={run}>
          {t.inbox.runFollowUps}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows === undefined && (
          <div className="p-4">
            <MasterListSkeleton rows={3} />
          </div>
        )}
        {rows?.length === 0 && (
          <div className="p-4">
            <EmptyState>{t.common.empty}</EmptyState>
          </div>
        )}
        {rows && rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t.common.id}</TableHead>
                <TableHead>{t.inbox.kind}</TableHead>
                <TableHead>{t.inbox.customerCol}</TableHead>
                <TableHead>{t.inbox.booking}</TableHead>
                <TableHead>{t.inbox.dueAt}</TableHead>
                <TableHead>{t.inbox.channel}</TableHead>
                <TableHead>{t.common.status}</TableHead>
                <TableHead>{t.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((f) => (
                <TableRow key={f._id}>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {f.businessId}
                  </TableCell>
                  <TableCell>{labelOf(f.kind, locale)}</TableCell>
                  <TableCell>{f.customerName ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {f.bookingBusinessId ?? "—"}
                  </TableCell>
                  <TableCell>{formatDate(f.dueAt, locale)}</TableCell>
                  <TableCell>{labelOf(f.channel, locale)}</TableCell>
                  <TableCell>
                    <StatusBadge value={f.status} />
                    {f.skipReason && <div className="mt-0.5 text-xs text-muted-foreground">{f.skipReason}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {f.approvalId && f.status === "PENDING_APPROVAL" && (
                        <Button size="xs" nativeButton={false} render={<Link href={`/approvals?id=${f.approvalId}`} />}>
                          {t.approvals.title}
                        </Button>
                      )}
                      {(f.status === "SCHEDULED" || f.status === "PENDING_APPROVAL") && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={async () => {
                            try {
                              await skip({ followUpId: f._id, reason: "تخطٍّ من المالك" });
                            } catch (e) {
                              toast.error(errMsg(e, t.common.error));
                            }
                          }}
                        >
                          {t.inbox.skipFollowUp}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
