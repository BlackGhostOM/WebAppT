"use client";

import { useMutation, useQuery } from "convex/react";
import { GitBranchIcon, Loader2Icon, MessagesSquareIcon, PlusIcon, SendIcon, SparklesIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS", "CANCELLING"]);

/**
 * Three panes on large screens (conversations · messages · live task tree).
 * On smaller screens the side panes open as dialogs from the toolbar, so the
 * message pane always gets the full width.
 */
export default function ChatPage() {
  const { t, locale } = useT();
  const conversations = useQuery(api.chat.listConversations);
  const [chosenConversationId, setConversationId] = useState<Id<"conversations"> | undefined>(undefined);
  // Most recent conversation by default; no effect needed to pick it.
  const conversationId = chosenConversationId ?? conversations?.[0]?._id;
  const data = useQuery(api.chat.getConversation, { conversationId });
  const emergency = useQuery(api.tasks.emergencyStatus);
  const send = useMutation(api.chat.send);
  const stop = useMutation(api.chat.stop);
  const resume = useMutation(api.chat.resume);
  const dismiss = useMutation(api.chat.dismiss);
  const [text, setText] = useState("");
  const [premium, setPremium] = useState(false);
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Conversation whose first render was already scrolled to the latest message.
  const openedConversationRef = useRef<string | null>(null);

  // Opening (or switching) a conversation lands on the latest message. Afterwards, follow new messages only
  // while the reader is already near the bottom; never yank them away from older text.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !data) return;
    const key = conversationId ?? "none";
    if (openedConversationRef.current !== key) {
      openedConversationRef.current = key;
      viewport.scrollTop = viewport.scrollHeight;
      return;
    }
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 240) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [conversationId, data, data?.messages.length, data?.activeTask?.status]);

  const activeTask = data?.activeTask ?? null;
  const running = !!activeTask && ACTIVE.has(activeTask.status);
  const stopped = !!emergency?.active;
  const currentConversation = conversations?.find((c) => c._id === conversationId);

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || running) return;
    setBusy(true);
    try {
      const result = await send({ conversationId, message: text, premiumRequested: premium || undefined });
      setConversationId(result.conversationId);
      setText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function onStop() {
    if (!activeTask) return;
    try {
      await stop({ taskId: activeTask._id });
      toast.warning(t.chat.stopped.replace(":", ""));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t.common.error);
    }
  }

  const conversationList = (onPick?: () => void) => (
    <div className="space-y-0.5 p-2">
      {conversations === undefined && (
        <div className="space-y-1.5 p-1" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg bg-secondary" />
          ))}
        </div>
      )}
      {conversations?.length === 0 && <div className="p-3 text-center text-xs text-muted-foreground">{t.common.empty}</div>}
      {conversations?.map((c) => {
        const selected = c._id === conversationId;
        return (
          <button
            key={c._id}
            type="button"
            aria-current={selected ? "true" : undefined}
            onClick={() => {
              setConversationId(c._id);
              onPick?.();
            }}
            className={cn(
              "block w-full min-h-11 rounded-lg px-3 py-2 text-start text-sm transition-colors hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
              selected ? "bg-primary-soft font-medium text-primary-text" : "text-foreground",
            )}
          >
            <div className="truncate">{c.title}</div>
            <div className={cn("mt-0.5 text-xs", selected ? "text-primary-text/80" : "text-muted-foreground")}>{formatRelative(c.lastMessageAt, locale)}</div>
          </button>
        );
      })}
    </div>
  );

  const liveTree = (
    <div className="space-y-2 p-2">
      {!data?.activeTree.length && (
        <EmptyState icon={<GitBranchIcon />} className="border-0 bg-transparent py-6">
          {t.common.empty}
        </EmptyState>
      )}
      {data?.activeTree.map((task) => {
        const runs = data.runs.filter((r) => r.taskId === task._id);
        return (
          <div key={task._id} className={cn("rounded-lg border border-border bg-card p-3 text-xs", task.parentTaskId && "ms-3 border-s-2 border-s-primary/40")}>
            <div className="flex items-center justify-between gap-1">
              <AgentBadge slug={task.agentSlug} />
              <StatusBadge value={task.status} />
            </div>
            <div className="mt-1.5 truncate text-sm font-medium">{task.title}</div>
            <div className="mt-0.5 text-muted-foreground">
              <span dir="ltr">{task.businessId}</span> · {task.stepCount} {t.chat.steps} · {formatUsd(task.costUsd)}
            </div>
            {runs.length > 0 && (
              <ol className="mt-2 space-y-0.5 border-t pt-2">
                {runs.slice(-8).map((r) => (
                  <li key={r._id} className="truncate text-muted-foreground">
                    {r.kind === "TOOL_CALL"
                      ? `🔧 ${r.toolName}`
                      : r.kind === "MODEL_CALL"
                        ? `🧠 ${r.model}`
                        : r.kind === "NOTE"
                          ? `📝 ${r.note}`
                          : r.kind === "CANCELLED"
                            ? `⛔ ${r.note}`
                            : r.kind === "ERROR"
                              ? `⚠️ ${r.note}`
                              : r.kind}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="grid h-[calc(100dvh-9.5rem)] min-h-[480px] gap-4 md:h-[calc(100dvh-8rem)] lg:grid-cols-[260px_1fr] xl:grid-cols-[260px_1fr_320px]">
      {/* Conversations (large screens) */}
      <Card className="hidden min-h-0 flex-col gap-0 overflow-hidden py-0 lg:flex">
        <PaneHeader title={t.chat.conversations}>
          <Button size="icon-sm" variant="ghost" aria-label={t.chat.newConversation} onClick={() => setConversationId(undefined)}>
            <PlusIcon />
          </Button>
        </PaneHeader>
        <ScrollArea className="min-h-0 flex-1">{conversationList()}</ScrollArea>
      </Card>

      {/* Messages */}
      <Card className="flex min-h-0 flex-col gap-0 overflow-hidden py-0">
        <PaneHeader
          title={currentConversation?.title ?? t.nav.chat}
          subtitle={currentConversation ? formatRelative(currentConversation.lastMessageAt, locale) : t.chat.agent}
        >
          <Button size="sm" variant="ghost" className="lg:hidden" onClick={() => setListOpen(true)}>
            <MessagesSquareIcon data-icon="inline-start" /> {t.chat.conversations}
          </Button>
          <Button size="sm" variant="ghost" className="xl:hidden" onClick={() => setTreeOpen(true)} disabled={!data?.activeTree.length}>
            <GitBranchIcon data-icon="inline-start" /> {t.chat.liveTree}
          </Button>
          <Button size="sm" variant="outline" className="lg:hidden" aria-label={t.chat.newConversation} onClick={() => setConversationId(undefined)}>
            <PlusIcon data-icon="inline-start" /> {t.chat.newConversation}
          </Button>
        </PaneHeader>

        <ScrollArea className="min-h-0 flex-1 bg-background/60" viewportRef={viewportRef}>
          <div className="mx-auto max-w-3xl space-y-4 p-4">
            {!data && conversationId && (
              <div className="space-y-3" aria-busy>
                <div className="ms-auto h-12 w-2/3 animate-pulse rounded-2xl bg-primary-soft" />
                <div className="h-20 w-3/4 animate-pulse rounded-2xl bg-secondary" />
              </div>
            )}
            {(!conversationId || data?.messages.length === 0) && (
              <EmptyState icon={<SparklesIcon />} title={t.chat.emptyTitle} className="mt-8 border-0 bg-transparent">
                {t.chat.placeholder}
              </EmptyState>
            )}
            {data?.messages.map((m) => {
              const task = data.tasks.find((x) => x._id === m.taskId);
              const pending = m.role === "assistant" && m.status === "PENDING";
              const cancelled = m.role === "assistant" && m.status === "CANCELLED";
              const isOwner = m.role === "owner";
              if (m.role === "system") {
                return (
                  <div key={m._id} className="text-center text-xs text-muted-foreground">
                    {m.content}
                  </div>
                );
              }
              return (
                <div key={m._id} className={cn("flex flex-col gap-1", isOwner ? "items-end" : "items-start")}>
                  <div className="px-1 text-xs text-muted-foreground">
                    {isOwner ? t.chat.you : t.chat.agent} · {formatRelative(m._creationTime, locale)}
                  </div>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-7 whitespace-pre-wrap md:max-w-[80%]",
                      isOwner ? "rounded-te-md bg-primary-soft text-foreground" : "rounded-ts-md border border-border bg-card",
                    )}
                  >
                    {pending ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground" role="status">
                        <Loader2Icon className="size-4 animate-spin" aria-hidden /> {t.chat.thinking}
                        {task ? ` — ${labelOf(task.status, locale)}` : ""}
                      </span>
                    ) : (
                      <>
                        {cancelled && <div className="mb-1 text-xs font-medium text-destructive-text">{t.chat.stopped}</div>}
                        {m.content}
                        {m.role === "assistant" && m.status === "ERROR" && (
                          <div className="mt-1 text-xs text-destructive-text">{labelOf("FAILED", locale)}</div>
                        )}
                        {m.role === "assistant" && (m.status === "CANCELLED" || m.status === "ERROR") && m.partial && m.taskId && (
                          <div className="mt-3 flex gap-2">
                            <Button size="sm" onClick={() => resume({ taskId: m.taskId! }).catch((e) => toast.error(e.message))}>
                              {t.chat.continue}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => dismiss({ taskId: m.taskId! })}>
                              {t.chat.dismiss}
                            </Button>
                          </div>
                        )}
                        {m.role === "assistant" && task && task.status === "COMPLETED" && (
                          <div className="mt-2 border-t border-border/70 pt-1.5 text-xs text-muted-foreground">
                            <span dir="ltr">{task.businessId}</span> · {formatUsd(task.costUsd)} · {task.stepCount} {t.chat.steps}
                            {task.citations.length > 0 && ` · ${t.tasks.citations}: ${task.citations.length}`}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        <form onSubmit={onSend} className="shrink-0 border-t bg-card p-3">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-end gap-2">
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={stopped ? t.chat.emergencyActive : t.chat.placeholder}
                disabled={stopped}
                rows={2}
                aria-label={t.chat.placeholder}
                className="min-h-11 flex-1 resize-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void onSend(e as unknown as FormEvent);
                  }
                }}
              />
              {running ? (
                <Button type="button" variant="destructive" size="lg" onClick={onStop}>
                  <SquareIcon data-icon="inline-start" /> {t.chat.stopWork}
                </Button>
              ) : (
                <Button type="submit" size="lg" disabled={busy || !text.trim() || stopped}>
                  {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
                  {t.common.send}
                </Button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <label className="inline-flex min-h-8 cursor-pointer items-center gap-2">
                <Checkbox checked={premium} onCheckedChange={(v) => setPremium(!!v)} /> {t.chat.premium}
                <span className="hidden text-hint sm:inline">— {t.chat.premiumHint}</span>
              </label>
              <span className="hidden text-hint md:inline">{t.chat.enterHint}</span>
            </div>
          </div>
        </form>
      </Card>

      {/* Live task tree (extra-large screens) */}
      <Card className="hidden min-h-0 flex-col gap-0 overflow-hidden py-0 xl:flex">
        <PaneHeader title={t.chat.liveTree} />
        <ScrollArea className="min-h-0 flex-1">{liveTree}</ScrollArea>
      </Card>

      {/* Small-screen dialogs for the side panes */}
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-h-[85dvh] overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>{t.chat.conversations}</DialogTitle>
            <DialogDescription className="sr-only">{t.nav.chat}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70dvh] overflow-y-auto">{conversationList(() => setListOpen(false))}</div>
        </DialogContent>
      </Dialog>
      <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
        <DialogContent className="max-h-[85dvh] overflow-hidden p-0 sm:max-w-md">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>{t.chat.liveTree}</DialogTitle>
            <DialogDescription className="sr-only">{t.nav.chat}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70dvh] overflow-y-auto">{liveTree}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaneHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-12 shrink-0 items-center justify-between gap-2 border-b px-3 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold">{title}</div>
        {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1">{children}</div>}
    </div>
  );
}
