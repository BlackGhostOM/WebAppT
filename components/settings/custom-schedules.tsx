"use client";

import { useMutation, useQuery } from "convex/react";
import { PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { describeRule } from "@/convex/lib/schedule";
import { AGENT_SLUGS, SCHEDULE_FREQUENCIES, TASK_PRIORITIES } from "@/convex/lib/vocab";
import { AgentBadge, StatusBadge } from "@/components/badges";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatRelative } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

type ScheduleRow = NonNullable<ReturnType<typeof useQuery<typeof api.customSchedules.list>>>[number];

interface FormState {
  title: string;
  agentSlug: string;
  request: string;
  priority: string;
  frequency: string;
  dayOfWeek: number;
  dayOfMonth: number;
  time: string;
  runAtLocal: string;
}

const EMPTY: FormState = { title: "", agentSlug: "executive", request: "", priority: "NORMAL", frequency: "WEEKLY", dayOfWeek: 0, dayOfMonth: 1, time: "08:00", runAtLocal: "" };
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const errMsg = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : fallback);

function fromRow(r: ScheduleRow): FormState {
  return {
    title: r.title,
    agentSlug: r.agentSlug,
    request: r.request,
    priority: r.priority,
    frequency: r.frequency,
    dayOfWeek: r.dayOfWeek ?? 0,
    dayOfMonth: r.dayOfMonth ?? 1,
    time: `${String(r.hour).padStart(2, "0")}:${String(r.minute).padStart(2, "0")}`,
    runAtLocal: r.runAt ? new Date(r.runAt - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "",
  };
}

function Picker({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(String(v ?? ""))} items={options}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Owner-defined recurring agent tasks: list + create/edit dialog + run now / enable / delete. */
export function CustomSchedulesPanel({ isOwner }: { isOwner: boolean }) {
  const { t, locale } = useT();
  const rows = useQuery(api.customSchedules.list);
  const create = useMutation(api.customSchedules.create);
  const update = useMutation(api.customSchedules.update);
  const setEnabled = useMutation(api.customSchedules.setEnabled);
  const remove = useMutation(api.customSchedules.remove);
  const runNow = useMutation(api.customSchedules.runNow);
  const [editing, setEditing] = useState<{ id: Id<"customSchedules"> | null; form: FormState } | null>(null);
  const [busy, setBusy] = useState(false);
  const days = locale === "ar" ? DAYS_AR : DAYS_EN;

  async function act(fn: () => Promise<unknown>, ok: string) {
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

  async function save() {
    if (!editing) return;
    const f = editing.form;
    const [h, m] = f.time.split(":").map(Number);
    const payload = {
      title: f.title,
      agentSlug: f.agentSlug,
      request: f.request,
      priority: f.priority,
      frequency: f.frequency,
      dayOfWeek: f.frequency === "WEEKLY" ? f.dayOfWeek : undefined,
      dayOfMonth: f.frequency === "MONTHLY" ? f.dayOfMonth : undefined,
      hour: Number.isFinite(h) ? h : 8,
      minute: Number.isFinite(m) ? m : 0,
      runAt: f.frequency === "ONCE" && f.runAtLocal ? new Date(f.runAtLocal).getTime() : undefined,
    };
    await act(async () => {
      if (editing.id) await update({ id: editing.id, ...payload });
      else await create(payload);
      setEditing(null);
    }, t.common.save);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">{t.settings.customSchedules}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.settings.customSchedulesHint}</p>
        </div>
        {isOwner && (
          <Button size="sm" onClick={() => setEditing({ id: null, form: EMPTY })}>
            <PlusIcon data-icon="inline-start" /> {t.settings.newSchedule}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rows?.length === 0 && <EmptyState>{t.settings.noSchedules}</EmptyState>}
        {rows?.map((r) => (
          <div key={r._id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{r.businessId}</span>
                <span className="font-medium">{r.title}</span>
                <AgentBadge slug={r.agentSlug} />
                <StatusBadge value={r.priority} />
                <span className="text-xs text-muted-foreground">{describeRule({ frequency: r.frequency, hour: r.hour, minute: r.minute, dayOfWeek: r.dayOfWeek, dayOfMonth: r.dayOfMonth, runAt: r.runAt }, locale)}</span>
              </div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.request}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span>
                  {t.settings.nextRun}: {r.enabled && r.nextRunAt ? `${formatDate(r.nextRunAt, locale, true)} (${formatRelative(r.nextRunAt, locale)})` : t.settings.disabled}
                </span>
                <span>
                  {t.settings.lastRunLabel}: {r.lastRunAt ? formatDate(r.lastRunAt, locale, true) : t.settings.never}
                  {r.lastTask && (
                    <>
                      {" · "}
                      <Link href={`/tasks/${r.lastTask._id}`} className="underline-offset-4 hover:underline">
                        {r.lastTask.businessId}
                      </Link>{" "}
                      <StatusBadge value={r.lastTask.status} />
                    </>
                  )}
                </span>
                <span>
                  {t.settings.runs}: {r.runCount}
                </span>
                {r.lastSkipReason && <span className="text-destructive">{r.lastSkipReason}</span>}
              </div>
            </div>
            {isOwner && (
              <div className="flex flex-wrap items-center gap-1">
                <label className="flex items-center gap-1 text-xs">
                  <Switch checked={r.enabled} disabled={busy} onCheckedChange={(c) => act(() => setEnabled({ id: r._id, enabled: !!c }), t.common.save)} /> {t.settings.enabled}
                </label>
                <Button size="xs" variant="outline" disabled={busy} onClick={() => act(() => runNow({ id: r._id }), t.settings.runNow)}>
                  <PlayIcon data-icon="inline-start" /> {t.settings.runNow}
                </Button>
                <Button size="xs" variant="outline" disabled={busy} onClick={() => setEditing({ id: r._id, form: fromRow(r) })}>
                  {t.common.edit}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(t.settings.confirmDelete)) void act(() => remove({ id: r._id }), t.settings.deleteSchedule);
                  }}
                >
                  <Trash2Icon data-icon="inline-start" /> {t.settings.deleteSchedule}
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>{editing.id ? t.settings.editSchedule : t.settings.newSchedule}</DialogTitle>
                <DialogDescription>{t.settings.customSchedulesHint}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <div className="grid gap-1">
                  <Label>{t.settings.scheduleTitle}</Label>
                  <Input value={editing.form.title} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, title: e.target.value } })} maxLength={120} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label>{t.settings.scheduleAgent}</Label>
                    <Picker value={editing.form.agentSlug} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, agentSlug: v } })} options={AGENT_SLUGS.map((s) => ({ value: s, label: labelOf(s, locale) }))} />
                  </div>
                  <div className="grid gap-1">
                    <Label>{t.settings.priority}</Label>
                    <Picker value={editing.form.priority} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, priority: v } })} options={TASK_PRIORITIES.map((p) => ({ value: p, label: labelOf(p, locale) }))} />
                  </div>
                </div>
                <div className="grid gap-1">
                  <Label>{t.settings.scheduleRequest}</Label>
                  <Textarea rows={5} value={editing.form.request} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, request: e.target.value } })} placeholder="مثال: راجع خط المبيعات، حدّد العملاء الراكدين والمتابعات المتأخرة، واقترح رسالة متابعة لكل منهم بلغته." />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <Label>{t.settings.frequency}</Label>
                    <Picker value={editing.form.frequency} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, frequency: v } })} options={SCHEDULE_FREQUENCIES.map((f) => ({ value: f, label: labelOf(f, locale) }))} />
                  </div>
                  {editing.form.frequency === "WEEKLY" && (
                    <div className="grid gap-1">
                      <Label>{t.settings.dayOfWeek}</Label>
                      <Picker value={String(editing.form.dayOfWeek)} onChange={(v) => setEditing({ ...editing, form: { ...editing.form, dayOfWeek: Number(v) } })} options={days.map((d, i) => ({ value: String(i), label: d }))} />
                    </div>
                  )}
                  {editing.form.frequency === "MONTHLY" && (
                    <div className="grid gap-1">
                      <Label>{t.settings.dayOfMonth}</Label>
                      <Input type="number" dir="ltr" min={1} max={28} value={editing.form.dayOfMonth} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, dayOfMonth: Number(e.target.value) } })} />
                    </div>
                  )}
                  {editing.form.frequency === "ONCE" ? (
                    <div className="grid gap-1">
                      <Label>{t.settings.runAt}</Label>
                      <Input type="datetime-local" dir="ltr" value={editing.form.runAtLocal} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, runAtLocal: e.target.value } })} />
                    </div>
                  ) : (
                    <div className="grid gap-1">
                      <Label>{t.settings.time}</Label>
                      <Input type="time" dir="ltr" value={editing.form.time} onChange={(e) => setEditing({ ...editing, form: { ...editing.form, time: e.target.value } })} />
                    </div>
                  )}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t.common.cancel}
                </Button>
                <Button onClick={save} disabled={busy || editing.form.title.trim().length < 2 || editing.form.request.trim().length < 10 || (editing.form.frequency === "ONCE" && !editing.form.runAtLocal)}>
                  {t.common.save}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
