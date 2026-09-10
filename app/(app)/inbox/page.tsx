"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SimulateInboundDialog } from "@/components/inbox/simulate-dialog";
import { SeverityBadge, StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        <TabsList className="flex-wrap">
          {INBOX_TABS.map((s) => (
            <TabsTrigger key={s} value={s}>
              {s === "ALL" ? t.common.all : s === "FOLLOW_UPS" ? t.inbox.followUps : labelOf(s, locale)}
              {stats && (s === "NEW" || s === "REPLY_PROPOSED" || s === "ESCALATED") && stats[s] > 0 && <Badge className="ms-1 h-5 min-w-5 justify-center px-1 text-[10px]">{stats[s]}</Badge>}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {tab === "FOLLOW_UPS" ? (
        <FollowUpsPanel />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
          <Card className="max-h-[75vh] overflow-auto">
            <CardContent className="space-y-1 p-2">
              {visible?.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
              {visible?.map((r) => (
                <button key={r._id} type="button" onClick={() => setSelected(r._id)} className={cn("w-full rounded-md border p-2 text-start text-sm hover:bg-muted", currentId === r._id && "border-primary bg-muted")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{r.customerName ?? r.externalSenderId ?? t.inbox.unknownSender}</span>
                    <StatusBadge value={r.status} />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {labelOf(r.channel, locale)} · {r.direction === "INBOUND" ? t.inbox.inbound : r.direction === "OUTBOUND" ? t.inbox.outbound : t.inbox.note}
                    {r.kind && ` · ${labelOf(r.kind, locale)}`} · {formatRelative(r.receivedAt, locale)}
                  </div>
                  <div className="mt-1 line-clamp-2 text-xs">{r.body}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          {currentId ? <ThreadPanel key={currentId} interactionId={currentId} /> : <Card><CardContent className="p-4"><EmptyState>{t.common.details}</EmptyState></CardContent></Card>}
        </div>
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
      <summary className="cursor-pointer select-none">{t.inbox.webhookUrl}</summary>
      <div className="mt-1 space-y-1 rounded-md border bg-muted/40 p-2" dir="ltr">
        <div>
          <span className="text-foreground">Instagram webhook:</span> <code>{site}/webhooks/instagram</code>
        </div>
        <div>
          <span className="text-foreground">Contact form:</span> <code>POST {site}/api/contact</code> · <Link href="/contact" className="underline">/contact</Link>
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

  if (data === undefined) return <Card><CardContent className="p-4 text-sm text-muted-foreground">{t.common.loading}</CardContent></Card>;
  if (data === null) return <Card><CardContent className="p-4"><EmptyState>{t.common.empty}</EmptyState></CardContent></Card>;
  const { interaction, customer, messages, task, escalatedTask, approval, bookings, leads, identities, followUps } = data;
  const pending = approval?.status === "PENDING";

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
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{customer?.fullName ?? interaction.externalSenderId ?? t.inbox.unknownSender}</CardTitle>
              <div className="text-xs text-muted-foreground">
                {interaction.businessId} · {labelOf(interaction.channel, locale)} · {formatDate(interaction.receivedAt, locale, true)}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {interaction.kind && <StatusBadge value={interaction.kind} />}
              <StatusBadge value={interaction.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{t.inbox.thread}</div>
            <div className="max-h-[40vh] space-y-2 overflow-auto rounded-md border p-2">
              {messages.map((m) => (
                <div key={m._id} className={cn("max-w-[85%] rounded-lg p-2 text-sm", m.direction === "INBOUND" ? "bg-muted" : m.direction === "OUTBOUND" ? "ms-auto bg-primary/10" : "border border-dashed", m._id === interaction._id && "ring-1 ring-primary")}>
                  <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{m.direction === "INBOUND" ? t.inbox.inbound : m.direction === "OUTBOUND" ? t.inbox.outbound : t.inbox.note}</span>
                    <span>{labelOf(m.channel, locale)}</span>
                    <span>{formatDate(m.receivedAt, locale, true)}</span>
                    {m.deliveryStatus && <Badge variant="outline" className="h-4 px-1 text-[10px]">{labelOf(m.deliveryStatus, locale)}</Badge>}
                  </div>
                  <div className="whitespace-pre-wrap">{m.body}</div>
                  {m.deliveryError && <div className="mt-1 text-[11px] text-red-600">{m.deliveryError}</div>}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium">
              {t.inbox.aiClassification}
              {interaction.aiClassification ? (
                <>
                  <StatusBadge value={interaction.aiClassification.kind} />
                  <span className="text-muted-foreground">
                    {t.inbox.confidence} {Math.round(interaction.aiClassification.confidence * 100)}% · <span dir="ltr">{interaction.aiClassification.model}</span>
                  </span>
                  {interaction.aiClassification.escalated && <Badge variant="outline">{t.inbox.escalated}{interaction.aiClassification.escalationReason ? ` (${interaction.aiClassification.escalationReason})` : ""}</Badge>}
                </>
              ) : (
                <span className="text-muted-foreground">{task ? `${labelOf(task.status, locale)}${task.model ? ` · ${task.model}` : ""}` : t.inbox.noTask}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {task && (
                <Link href={`/tasks/${task._id}`} className="underline-offset-4 hover:underline">
                  {task.businessId} · {labelOf(task.status, locale)}
                </Link>
              )}
              {escalatedTask && (
                <Link href={`/tasks/${escalatedTask._id}`} className="underline-offset-4 hover:underline">
                  ← {escalatedTask.businessId} · {labelOf(escalatedTask.status, locale)}
                  {escalatedTask.model ? ` · ${escalatedTask.model}` : ""}
                </Link>
              )}
              {task?.error && <span className="text-red-600">{task.error}</span>}
              {interaction.direction === "INBOUND" && !["REPLIED", "CLOSED"].includes(interaction.status) && (!task || ["COMPLETED", "FAILED", "CANCELLED"].includes(task.status)) && !pending && (
                <Button size="xs" variant="outline" disabled={busy} onClick={() => run(() => reprocess({ interactionId }), t.inbox.reprocess)}>
                  {t.inbox.reprocess}
                </Button>
              )}
            </div>
          </div>

          {interaction.proposedReply && (
            <div className="space-y-2 rounded-md border border-primary/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-medium">
                <span>{t.inbox.proposedReply}</span>
                <span className="flex items-center gap-1">
                  {approval && <SeverityBadge value={approval.severity} />}
                  {approval && <StatusBadge value={approval.status} />}
                  {approval && (
                    <Link href={`/approvals?id=${approval._id}`} className="text-primary underline-offset-4 hover:underline">
                      {approval.businessId}
                    </Link>
                  )}
                </span>
              </div>
              {editing ? <Textarea rows={5} value={edited ?? ""} onChange={(e) => setEdited(e.target.value)} /> : <div className="whitespace-pre-wrap rounded-md bg-muted p-3">{interaction.proposedReply}</div>}
              {pending && approval && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {!editing ? (
                      <>
                        <Button size="sm" disabled={busy} onClick={() => run(() => decide({ approvalId: approval._id, decision: "APPROVED" }), t.inbox.approveSend)}>
                          {t.inbox.approveSend}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setEdited(interaction.proposedReply ?? "")}>
                          {t.inbox.editSend}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" disabled={busy || !(edited ?? "").trim()} onClick={() => run(() => decide({ approvalId: approval._id, decision: "EDITED_APPROVED", editedPayload: { ...(approval.payload as Record<string, unknown>), message: (edited ?? "").trim() }, reason: reason || undefined }), t.inbox.editSend)}>
                          {t.inbox.editSend}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdited(null)}>
                          {t.common.cancel}
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => run(() => decide({ approvalId: approval._id, decision: "REJECTED", reason }), t.inbox.rejectReply)}>
                      {t.inbox.rejectReply}
                    </Button>
                  </div>
                  <Textarea rows={2} placeholder={t.inbox.reason} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
              {approval?.decisionReason && !pending && <div className="text-xs text-muted-foreground">{approval.decisionReason}</div>}
            </div>
          )}

          {interaction.direction === "INBOUND" && interaction.status !== "CLOSED" && (
            <div className="space-y-2">
              <div className="text-xs font-medium">{t.inbox.ownerReply}</div>
              <Textarea rows={3} placeholder={t.inbox.replyPlaceholder} value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy || !reply.trim()} onClick={() => run(async () => { await replyByOwner({ interactionId, message: reply }); setReply(""); }, t.inbox.sendReply)}>
                  {t.inbox.sendReply}
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setStatus({ interactionId, status: "CLOSED" }), t.inbox.close)}>
                  {t.inbox.close}
                </Button>
              </div>
            </div>
          )}
          {interaction.status === "CLOSED" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => setStatus({ interactionId, status: "NEW" }), t.inbox.reopen)}>
              {t.inbox.reopen}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{t.inbox.customer}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {customer ? (
            <>
              <div>
                <div className="text-sm font-medium">{customer.fullName}</div>
                <Link href={`/data/customers?id=${customer._id}`} className="text-primary underline-offset-4 hover:underline">
                  {customer.businessId} ←
                </Link>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">النوع</dt>
                <dd>{labelOf(customer.customerType, locale)}</dd>
                {customer.phone && (
                  <>
                    <dt className="text-muted-foreground">{t.contact.phone}</dt>
                    <dd dir="ltr" className="text-start">{customer.phone}</dd>
                  </>
                )}
                {customer.email && (
                  <>
                    <dt className="text-muted-foreground">{t.contact.email}</dt>
                    <dd dir="ltr" className="text-start">{customer.email}</dd>
                  </>
                )}
                <dt className="text-muted-foreground">{t.common.language}</dt>
                <dd>{customer.preferredLanguage === "ar" ? "العربية" : "English"}</dd>
                <dt className="text-muted-foreground">الموافقة</dt>
                <dd>
                  <StatusBadge value={customer.consentStatus} />
                </dd>
                <dt className="text-muted-foreground">{t.common.trust}</dt>
                <dd>{labelOf(customer.verificationStatus, locale)}</dd>
              </dl>
              {customer.notes && <div className="whitespace-pre-wrap rounded-md bg-muted p-2">{customer.notes}</div>}
              {identities.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">{t.inbox.identities}</div>
                  {identities.map((i, idx) => (
                    <div key={idx} className="text-muted-foreground">
                      {labelOf(i.channel, locale)} {i.handle ? <span dir="ltr">@{i.handle}</span> : ""} · {formatRelative(i.lastSeenAt, locale)}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="mb-1 font-medium">{t.inbox.bookings}</div>
                {bookings.length === 0 && <div className="text-muted-foreground">—</div>}
                {bookings.map((b) => (
                  <div key={b._id} className="flex items-center justify-between gap-2">
                    <span>
                      {b.businessId} · {formatDate(b.travelDateFrom, locale)}
                    </span>
                    <StatusBadge value={b.status} />
                  </div>
                ))}
              </div>
              <div>
                <div className="mb-1 font-medium">{t.inbox.leads}</div>
                {leads.length === 0 && <div className="text-muted-foreground">—</div>}
                {leads.map((l) => (
                  <div key={l._id} className="flex items-center justify-between gap-2">
                    <Link href="/pipeline" className="underline-offset-4 hover:underline">
                      {l.businessId}
                    </Link>
                    <StatusBadge value={l.stage} />
                  </div>
                ))}
              </div>
              {followUps.length > 0 && (
                <div>
                  <div className="mb-1 font-medium">{t.inbox.followUps}</div>
                  {followUps.map((f) => (
                    <div key={f._id} className="flex items-center justify-between gap-2">
                      <span>
                        {labelOf(f.kind, locale)} · {formatDate(f.dueAt, locale)}
                      </span>
                      <StatusBadge value={f.status} />
                    </div>
                  ))}
                </div>
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
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">{t.inbox.followUps}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.inbox.followUpsHint}</p>
        </div>
        <Button size="sm" variant="secondary" disabled={busy} onClick={run}>
          {t.inbox.runFollowUps}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {rows?.length === 0 && <div className="p-4"><EmptyState>{t.common.empty}</EmptyState></div>}
        {rows && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 text-start">{t.common.id}</th>
                  <th className="p-2 text-start">النوع</th>
                  <th className="p-2 text-start">العميل</th>
                  <th className="p-2 text-start">الحجز</th>
                  <th className="p-2 text-start">الاستحقاق</th>
                  <th className="p-2 text-start">القناة</th>
                  <th className="p-2 text-start">{t.common.status}</th>
                  <th className="p-2 text-start">{t.common.actions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => (
                  <tr key={f._id} className="border-t">
                    <td className="p-2 font-mono text-xs">{f.businessId}</td>
                    <td className="p-2">{labelOf(f.kind, locale)}</td>
                    <td className="p-2">{f.customerName ?? "—"}</td>
                    <td className="p-2 font-mono text-xs">{f.bookingBusinessId ?? "—"}</td>
                    <td className="p-2">{formatDate(f.dueAt, locale)}</td>
                    <td className="p-2">{labelOf(f.channel, locale)}</td>
                    <td className="p-2">
                      <StatusBadge value={f.status} />
                      {f.skipReason && <div className="text-[11px] text-muted-foreground">{f.skipReason}</div>}
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {f.approvalId && f.status === "PENDING_APPROVAL" && (
                          <Button size="xs" nativeButton={false} render={<Link href={`/approvals?id=${f.approvalId}`} />}>
                            {t.approvals.title}
                          </Button>
                        )}
                        {(f.status === "SCHEDULED" || f.status === "PENDING_APPROVAL") && (
                          <Button size="xs" variant="outline" disabled={busy} onClick={async () => { try { await skip({ followUpId: f._id, reason: "تخطٍّ من المالك" }); } catch (e) { toast.error(errMsg(e, t.common.error)); } }}>
                            {t.inbox.skipFollowUp}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
