"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2Icon, PlusIcon, SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ACTIVE = new Set(["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS", "CANCELLING"]);

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

  return (
    <div className="grid h-[calc(100dvh-8rem)] min-h-[420px] gap-4 lg:grid-cols-[220px_1fr_320px]">
      <Card className="hidden min-h-0 flex-col overflow-hidden lg:flex">
        <div className="flex items-center justify-between border-b p-2">
          <span className="text-sm font-medium">{t.nav.chat}</span>
          <Button size="icon-sm" variant="ghost" aria-label={t.chat.newConversation} onClick={() => setConversationId(undefined)}>
            <PlusIcon />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="space-y-0.5 p-1">
            {conversations?.map((c) => (
              <button
                key={c._id}
                type="button"
                onClick={() => setConversationId(c._id)}
                className={cn("block w-full truncate rounded-md px-2 py-1.5 text-start text-sm hover:bg-muted", c._id === conversationId && "bg-muted font-medium")}
              >
                {c.title}
                <div className="text-[10px] text-muted-foreground">{formatRelative(c.lastMessageAt, locale)}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="flex min-h-0 flex-col overflow-hidden">
        <ScrollArea className="min-h-0 flex-1" viewportRef={viewportRef}>
          <div className="space-y-3 p-4">
            {!data && conversationId && <div className="text-sm text-muted-foreground">{t.common.loading}</div>}
            {(!conversationId || data?.messages.length === 0) && <EmptyState>{t.chat.placeholder}</EmptyState>}
            {data?.messages.map((m) => {
              const task = data.tasks.find((x) => x._id === m.taskId);
              const pending = m.role === "assistant" && m.status === "PENDING";
              const cancelled = m.role === "assistant" && m.status === "CANCELLED";
              return (
                <div key={m._id} className={cn("flex", m.role === "owner" ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap", m.role === "owner" ? "bg-primary text-primary-foreground" : m.role === "system" ? "bg-muted text-muted-foreground text-xs" : "bg-muted")}>
                    {pending ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <Loader2Icon className="size-3.5 animate-spin" /> {t.chat.thinking} {task ? `— ${labelOf(task.status, locale)}` : ""}
                      </span>
                    ) : (
                      <>
                        {cancelled && <div className="mb-1 text-xs font-medium text-destructive">{t.chat.stopped}</div>}
                        {m.content}
                        {m.role === "assistant" && m.status === "ERROR" && <div className="mt-1 text-xs text-destructive">{labelOf("FAILED", locale)}</div>}
                        {m.role === "assistant" && (m.status === "CANCELLED" || m.status === "ERROR") && m.partial && m.taskId && (
                          <div className="mt-2 flex gap-2">
                            <Button size="xs" onClick={() => resume({ taskId: m.taskId! }).catch((e) => toast.error(e.message))}>
                              {t.chat.continue}
                            </Button>
                            <Button size="xs" variant="outline" onClick={() => dismiss({ taskId: m.taskId! })}>
                              {t.chat.dismiss}
                            </Button>
                          </div>
                        )}
                        {m.role === "assistant" && task && task.status === "COMPLETED" && (
                          <div className="mt-1 text-[10px] text-muted-foreground">
                            {task.businessId} · {formatUsd(task.costUsd)} · {task.stepCount} {t.chat.steps}
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
        <form onSubmit={onSend} className="shrink-0 border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={emergency?.active ? t.chat.emergencyActive : t.chat.placeholder}
              disabled={!!emergency?.active}
              rows={2}
              className="min-h-10 flex-1 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void onSend(e as unknown as FormEvent);
                }
              }}
            />
            {running ? (
              <Button type="button" variant="destructive" onClick={onStop} className="h-10">
                <SquareIcon data-icon="inline-start" /> {t.chat.stopWork}
              </Button>
            ) : (
              <Button type="submit" disabled={busy || !text.trim() || !!emergency?.active} className="h-10">
                <SendIcon data-icon="inline-start" /> {t.common.send}
              </Button>
            )}
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={premium} onCheckedChange={(v) => setPremium(!!v)} /> {t.chat.premium}
          </label>
        </form>
      </Card>

      <Card className="hidden min-h-0 flex-col overflow-hidden lg:flex">
        <div className="shrink-0 border-b p-2 text-sm font-medium">{t.chat.liveTree}</div>
        <ScrollArea className="min-h-0 flex-1" viewportClassName="p-2">
          {!data?.activeTree.length && <EmptyState>{t.common.empty}</EmptyState>}
          <div className="space-y-2">
            {data?.activeTree.map((task) => {
              const runs = data.runs.filter((r) => r.taskId === task._id);
              return (
                <div key={task._id} className={cn("rounded-md border p-2 text-xs", task.parentTaskId && "ms-3")}>
                  <div className="flex items-center justify-between gap-1">
                    <AgentBadge slug={task.agentSlug} />
                    <StatusBadge value={task.status} />
                  </div>
                  <div className="mt-1 truncate font-medium">{task.title}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {task.businessId} · {task.stepCount} {t.chat.steps} · {formatUsd(task.costUsd)}
                  </div>
                  <ol className="mt-1 space-y-0.5">
                    {runs.slice(-8).map((r) => (
                      <li key={r._id} className="truncate text-[11px] text-muted-foreground">
                        {r.kind === "TOOL_CALL" ? `🔧 ${r.toolName}` : r.kind === "MODEL_CALL" ? `🧠 ${r.model}` : r.kind === "NOTE" ? `📝 ${r.note}` : r.kind === "CANCELLED" ? `⛔ ${r.note}` : r.kind === "ERROR" ? `⚠️ ${r.note}` : r.kind}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}
