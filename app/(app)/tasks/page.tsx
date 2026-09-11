"use client";

import { useQuery } from "convex/react";
import { KanbanSquareIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader, Section } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Work in flight gets a column each; finished work is a compact list underneath so the board stays readable. */
const ACTIVE_COLUMNS = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"] as const;
const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELLED", "CANCELLING", "BUDGET_EXCEEDED"]);

export default function TasksPage() {
  const { t, locale } = useT();
  const data = useQuery(api.tasks.board);
  const [agent, setAgent] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const tasks = (data?.tasks ?? []).filter(
    (task) => (agent === "ALL" || task.agentSlug === agent) && (!q || task.title.toLowerCase().includes(q) || task.businessId.toLowerCase().includes(q)),
  );
  const finished = tasks.filter((task) => FINISHED.has(task.status)).sort((a, b) => b._creationTime - a._creationTime);

  return (
    <div className="space-y-6">
      <PageHeader title={t.tasks.title} description={t.tasks.description} />

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={agent} onValueChange={(v) => setAgent(String(v))}>
          <TabsList aria-label={t.tasks.byAgent}>
            <TabsTrigger value="ALL">{t.common.all}</TabsTrigger>
            {data?.agents.map((a) => (
              <TabsTrigger key={a.slug} value={a.slug}>
                {labelOf(a.slug, locale)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative ms-auto w-full sm:w-72">
          <SearchIcon className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-hint" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.tasks.searchPlaceholder}
            aria-label={t.common.search}
            className="ps-9"
          />
        </div>
      </div>

      {data === undefined ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" aria-busy>
          {ACTIVE_COLUMNS.map((c) => (
            <div key={c} className="h-48 animate-pulse rounded-xl bg-secondary" />
          ))}
        </div>
      ) : (
        <>
          <Section title={t.tasks.active}>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-4">
              {ACTIVE_COLUMNS.map((status) => {
                const column = tasks.filter((task) => task.status === status);
                return (
                  <div key={status} className="flex w-[280px] shrink-0 snap-start flex-col rounded-xl border border-border bg-secondary/50 p-2 md:w-auto">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <StatusBadge value={status} />
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">{column.length}</span>
                    </div>
                    <div className="space-y-2">
                      {column.length === 0 && <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-hint">—</div>}
                      {column.map((task) => (
                        <TaskCard key={task._id} task={task} locale={locale} stepsLabel={t.chat.steps} subtaskLabel={t.tasks.subtasks} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title={t.tasks.finished}>
            {finished.length === 0 ? (
              <EmptyState icon={<KanbanSquareIcon />} title={t.tasks.noTasks} />
            ) : (
              <ul className="divide-y overflow-hidden rounded-xl border border-border bg-card">
                {finished.slice(0, 30).map((task) => (
                  <li key={task._id}>
                    <Link
                      href={`/tasks/${task._id}`}
                      className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm transition-colors hover:bg-accent/50"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
                      <span className="text-xs text-muted-foreground" dir="ltr">
                        {task.businessId}
                      </span>
                      <AgentBadge slug={task.agentSlug} />
                      <StatusBadge value={task.status === "CANCELLING" ? "CANCELLED" : task.status} />
                      <span className="w-24 text-end text-xs text-muted-foreground tabular-nums">{formatUsd(task.costUsd)}</span>
                      <span className="w-24 text-end text-xs text-muted-foreground">{formatRelative(task._creationTime, locale)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

type BoardTask = NonNullable<ReturnType<typeof useQuery<typeof api.tasks.board>>>["tasks"][number];

function TaskCard({ task, locale, stepsLabel, subtaskLabel }: { task: BoardTask; locale: "ar" | "en"; stepsLabel: string; subtaskLabel: string }) {
  return (
    <Link
      href={`/tasks/${task._id}`}
      className={cn(
        "block rounded-lg border border-border bg-card p-3 text-sm shadow-xs transition-colors hover:border-ring/40 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none",
      )}
    >
      <div className="line-clamp-2 font-medium leading-5">{task.title}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <AgentBadge slug={task.agentSlug} />
        <span className="text-xs text-muted-foreground">{formatRelative(task._creationTime, locale)}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
        <span dir="ltr">{task.businessId}</span>
        <span className="tabular-nums">
          {task.stepCount} {stepsLabel} · {formatUsd(task.costUsd)}
        </span>
      </div>
      {task.parentTaskId && <div className="mt-1 text-xs text-hint">↳ {subtaskLabel}</div>}
    </Link>
  );
}
