"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRelative, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const COLUMNS = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS", "COMPLETED", "FAILED", "CANCELLED", "BUDGET_EXCEEDED"] as const;

export default function TasksPage() {
  const { t, locale } = useT();
  const data = useQuery(api.tasks.board);
  const [agent, setAgent] = useState<string>("ALL");
  const tasks = (data?.tasks ?? []).filter((task) => agent === "ALL" || task.agentSlug === agent);

  return (
    <div className="space-y-4">
      <PageHeader title={t.tasks.title} description="لوحة كانبان حسب الوكيل والحالة؛ افتح أي مهمة لسجل التنفيذ والأدوات والتكلفة." />
      <Tabs value={agent} onValueChange={(v) => setAgent(String(v))}>
        <TabsList>
          <TabsTrigger value="ALL">{t.common.all}</TabsTrigger>
          {data?.agents.map((a) => (
            <TabsTrigger key={a.slug} value={a.slug}>
              {labelOf(a.slug, locale)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((status) => {
          const column = tasks.filter((task) => task.status === status || (status === "CANCELLED" && task.status === "CANCELLING"));
          return (
            <div key={status} className="rounded-lg border bg-muted/30 p-2">
              <div className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                <StatusBadge value={status} />
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </div>
              <div className="space-y-2">
                {column.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
                {column.map((task) => (
                  <Link key={task._id} href={`/tasks/${task._id}`} className="block rounded-md border bg-background p-2 text-sm shadow-xs hover:bg-muted">
                    <div className="flex items-center justify-between gap-1">
                      <AgentBadge slug={task.agentSlug} />
                      <span className="text-[10px] text-muted-foreground">{task.businessId}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 font-medium">{task.title}</div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{formatRelative(task._creationTime, locale)}</span>
                      <span>
                        {task.stepCount} {t.chat.steps} · {formatUsd(task.costUsd)}
                      </span>
                    </div>
                    {task.parentTaskId && <div className="mt-1 text-[10px] text-muted-foreground">↳ {t.tasks.subtasks}</div>}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
