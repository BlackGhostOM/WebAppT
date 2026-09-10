"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { APPROVAL_KINDS } from "@/convex/lib/vocab";
import { AgentBadge, SeverityBadge, StatusBadge } from "@/components/badges";
import { EmptyState, JsonView, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatPercent, formatUsd } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const asRecord = (value: object): Record<string, unknown> => value as Record<string, unknown>;

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const { t, locale } = useT();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "agents");
  const settings = useQuery(api.settings.getAll);
  const me = useQuery(api.settings.me);
  const updateSetting = useMutation(api.settings.update);
  const isOwner = me?.role === "owner";

  useEffect(() => {
    const p = params.get("tab");
    if (p) setTab(p);
  }, [params]);

  async function save(key: string, value: Record<string, unknown>) {
    try {
      await updateSetting({ key, value });
      toast.success(t.common.save);
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t.settings.title} description={!isOwner ? "بعض الإعدادات متاحة للمالك فقط." : undefined} />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="flex-wrap">
          {(["agents", "models", "budget", "autoApprove", "integrations", "company", "users", "dataHealth", "governance"] as const).map((k) => (
            <TabsTrigger key={k} value={k}>
              {t.settings[k]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="agents">
          <AgentsTab isOwner={!!isOwner} />
        </TabsContent>
        <TabsContent value="models">{settings && <ModelsTab routing={asRecord(settings.modelRouting)} escalation={asRecord(settings.escalation)} runtime={asRecord(settings.agentRuntime)} onSave={save} hints={settings.providerHints} />}</TabsContent>
        <TabsContent value="budget">{settings && <BudgetTab budget={asRecord(settings.budget)} onSave={save} />}</TabsContent>
        <TabsContent value="autoApprove">{settings && <AutoApproveTab value={settings.autoApprove} onSave={save} />}</TabsContent>
        <TabsContent value="integrations">{settings && <IntegrationsTab value={asRecord(settings.integrations)} hints={settings.providerHints} onSave={save} />}</TabsContent>
        <TabsContent value="company">{settings && <CompanyTab value={asRecord(settings.company)} onSave={save} />}</TabsContent>
        <TabsContent value="users">
          <UsersTab isOwner={!!isOwner} meId={me?._id} />
        </TabsContent>
        <TabsContent value="dataHealth">
          <DataHealthTab />
        </TabsContent>
        <TabsContent value="governance">
          <GovernanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
function AgentsTab({ isOwner }: { isOwner: boolean }) {
  const { t, locale } = useT();
  const agents = useQuery(api.agentConfig.list);
  const tools = useQuery(api.agentConfig.toolCatalog);
  const update = useMutation(api.agentConfig.update);
  const [drafts, setDrafts] = useState<Record<string, { systemPrompt: string; defaultModel: string; monthlyBudgetUsd: number; maxStepsPerTask: number; enabled: boolean; allowedTools: string[] }>>({});

  useEffect(() => {
    if (!agents) return;
    setDrafts((d) => {
      const next = { ...d };
      for (const a of agents) if (!next[a.slug]) next[a.slug] = { systemPrompt: a.systemPrompt, defaultModel: a.defaultModel, monthlyBudgetUsd: a.monthlyBudgetUsd, maxStepsPerTask: a.maxStepsPerTask, enabled: a.enabled, allowedTools: a.allowedTools };
      return next;
    });
  }, [agents]);

  return (
    <div className="space-y-4">
      {agents?.map((a) => {
        const d = drafts[a.slug];
        if (!d) return null;
        const agentTools = (tools ?? []).filter((tl) => tl.allowedAgents.includes(a.slug));
        return (
          <Card key={a.slug}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
                <span className="flex items-center gap-2">
                  <AgentBadge slug={a.slug} /> {a.name}
                  <span className="text-xs text-muted-foreground">v{a.promptVersion}</span>
                </span>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={d.enabled} disabled={!isOwner} onCheckedChange={(v) => setDrafts({ ...drafts, [a.slug]: { ...d, enabled: !!v } })} /> مفعّل
                </label>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{a.description}</p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label={t.settings.systemPrompt}>
                <Textarea rows={10} value={d.systemPrompt} disabled={!isOwner} onChange={(e) => setDrafts({ ...drafts, [a.slug]: { ...d, systemPrompt: e.target.value } })} className="text-xs leading-relaxed" />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label={t.settings.defaultModel}>
                  <Input dir="ltr" value={d.defaultModel} disabled={!isOwner} onChange={(e) => setDrafts({ ...drafts, [a.slug]: { ...d, defaultModel: e.target.value } })} />
                </Field>
                <Field label={t.settings.monthlyBudget}>
                  <Input type="number" dir="ltr" value={d.monthlyBudgetUsd} disabled={!isOwner} onChange={(e) => setDrafts({ ...drafts, [a.slug]: { ...d, monthlyBudgetUsd: Number(e.target.value) } })} />
                </Field>
                <Field label={t.settings.maxSteps}>
                  <Input type="number" dir="ltr" value={d.maxStepsPerTask} disabled={!isOwner} onChange={(e) => setDrafts({ ...drafts, [a.slug]: { ...d, maxStepsPerTask: Number(e.target.value) } })} />
                </Field>
              </div>
              <Field label={t.settings.tools}>
                <div className="grid gap-1 rounded-lg border p-2 text-xs sm:grid-cols-2">
                  {agentTools.map((tl) => (
                    <label key={tl.name} className="flex items-start gap-1.5">
                      <Checkbox checked={d.allowedTools.includes(tl.name)} disabled={!isOwner} onCheckedChange={(v) => setDrafts({ ...drafts, [a.slug]: { ...d, allowedTools: v ? [...d.allowedTools, tl.name] : d.allowedTools.filter((x) => x !== tl.name) } })} />
                      <span>
                        <span className="font-mono" dir="ltr">
                          {tl.name}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          ({tl.kind}
                          {tl.requiresApproval ? " · يتطلب اعتماداً" : ""})
                        </span>
                        <div className="text-muted-foreground">{tl.description}</div>
                      </span>
                    </label>
                  ))}
                </div>
              </Field>
              {isOwner && (
                <Button
                  size="sm"
                  onClick={() =>
                    update({ slug: a.slug, patch: d })
                      .then(() => toast.success(t.common.save))
                      .catch((e) => toast.error((e as { data?: { message?: string } }).data?.message ?? e.message))
                  }
                >
                  {t.common.save}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
      {!agents?.length && <EmptyState>لم تُبذر الوكلاء بعد — شغّل npm run seed:owner.</EmptyState>}
      <span className="hidden">{locale}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
type SaveFn = (key: string, value: Record<string, unknown>) => Promise<void>;

function ModelsTab({ routing, escalation, runtime, onSave, hints }: { routing: Record<string, unknown>; escalation: Record<string, unknown>; runtime: Record<string, unknown>; onSave: SaveFn; hints: { llmProvider: string; llmProviderConfigured: boolean } }) {
  const { t } = useT();
  const [r, setR] = useState(routing);
  const [e, setE] = useState(escalation);
  const [rt, setRt] = useState(runtime);
  useEffect(() => setR(routing), [routing]);
  useEffect(() => setE(escalation), [escalation]);
  useEffect(() => setRt(runtime), [runtime]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.settings.models}</CardTitle>
          <p className="text-xs text-muted-foreground">
            المزوّد الحالي: <span dir="ltr">{hints.llmProvider}</span> {hints.llmProviderConfigured ? "" : "(وضع المحاكاة — اضبط ANTHROPIC_API_KEY في بيئة Convex)"}. اقتصادي للعملاء، متوسط للمالك؛ النماذج المتقدمة لا تُستخدم افتراضياً.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["customerModel", "ownerModel", "executiveModel", "escalationModel", "premiumModel"] as const).map((k) => (
            <Field key={k} label={k}>
              <Input dir="ltr" value={String(r[k] ?? "")} onChange={(ev) => setR({ ...r, [k]: ev.target.value })} />
            </Field>
          ))}
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!r.allowPremiumModels} onCheckedChange={(v) => setR({ ...r, allowPremiumModels: !!v })} /> السماح بالنماذج المتقدمة لمهمة محددة (خيار «نموذج متقدم» في المحادثة)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!r.batchForNonUrgent} onCheckedChange={(v) => setR({ ...r, batchForNonUrgent: !!v })} /> Batch API للمهام غير العاجلة (نصف السعر)
          </label>
          <Button size="sm" onClick={() => onSave("modelRouting", r)}>
            {t.common.save}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">التصعيد وحلقة الوكيل</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="حد قيمة الحجز للتصعيد (ر.ع)">
            <Input type="number" dir="ltr" value={Number(e.bookingValueThresholdOmr ?? 0)} onChange={(ev) => setE({ ...e, bookingValueThresholdOmr: Number(ev.target.value) })} />
          </Field>
          <Field label="حد الثقة للتصعيد (0–1)">
            <Input type="number" step="0.05" dir="ltr" value={Number(e.confidenceThreshold ?? 0.7)} onChange={(ev) => setE({ ...e, confidenceThreshold: Number(ev.target.value) })} />
          </Field>
          <Button size="sm" onClick={() => onSave("escalation", e)}>
            {t.common.save}
          </Button>
          <div className="border-t pt-3" />
          <Field label="الحد الأقصى للخطوات لكل مهمة">
            <Input type="number" dir="ltr" value={Number(rt.maxStepsPerTask ?? 12)} onChange={(ev) => setRt({ ...rt, maxStepsPerTask: Number(ev.target.value) })} />
          </Field>
          <Field label="عمق المهام الفرعية">
            <Input type="number" dir="ltr" value={Number(rt.maxSubtaskDepth ?? 2)} onChange={(ev) => setRt({ ...rt, maxSubtaskDepth: Number(ev.target.value) })} />
          </Field>
          <Field label="فترة فحص الإيقاف (مللي ثانية)">
            <Input type="number" dir="ltr" value={Number(rt.cancelPollMs ?? 750)} onChange={(ev) => setRt({ ...rt, cancelPollMs: Number(ev.target.value) })} />
          </Field>
          <Button size="sm" onClick={() => onSave("agentRuntime", rt)}>
            {t.common.save}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function BudgetTab({ budget, onSave }: { budget: Record<string, unknown>; onSave: SaveFn }) {
  const { t } = useT();
  const usage = useQuery(api.usage.monthly, {});
  const [b, setB] = useState(budget);
  useEffect(() => setB(budget), [budget]);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.settings.budget}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="الميزانية الشهرية ($)">
            <Input type="number" dir="ltr" value={Number(b.monthlyBudgetUsd ?? 200)} onChange={(e) => setB({ ...b, monthlyBudgetUsd: Number(e.target.value) })} />
          </Field>
          <Field label="نسبة التنبيه %">
            <Input type="number" dir="ltr" value={Number(b.alertThresholdPercent ?? 80)} onChange={(e) => setB({ ...b, alertThresholdPercent: Number(e.target.value) })} />
          </Field>
          <Button size="sm" onClick={() => onSave("budget", b)}>
            {t.common.save}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{usage?.monthKey}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div>
            الإجمالي: {formatUsd(usage?.totalUsd)} من {formatUsd(usage?.budgetUsd)} ({formatPercent(usage?.percentOfBudget)})
          </div>
          {usage?.byModel.map((m) => (
            <div key={m.model} className="flex justify-between text-xs" dir="ltr">
              <span>
                {m.model} · {m.calls} calls · {m.inputTokens}/{m.outputTokens} tok
              </span>
              <span>{formatUsd(m.costUsd)}</span>
            </div>
          ))}
          {usage?.byAgent.map((a) => (
            <div key={a.agentSlug} className="flex justify-between text-xs">
              <AgentBadge slug={a.agentSlug} />
              <span>
                {formatUsd(a.costUsd)} / {formatUsd(a.budgetUsd)} ({formatPercent(a.percentOfBudget)})
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AutoApproveTab({ value, onSave }: { value: { kinds: string[]; faqAutoReply: boolean }; onSave: SaveFn }) {
  const { t, locale } = useT();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.settings.autoApprove}</CardTitle>
        <p className="text-xs text-muted-foreground">الأنواع المحددة تُنفَّذ دون مراجعة (عدا D4). تأكيد الحجوزات والتغييرات الحساسة لا تقبل الاعتماد التلقائي.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-1 sm:grid-cols-2">
          {APPROVAL_KINDS.filter((k) => k !== "CONFIRM_BOOKING" && k !== "SENSITIVE_CHANGE").map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <Checkbox checked={v.kinds.includes(k)} onCheckedChange={(c) => setV({ ...v, kinds: c ? [...v.kinds, k] : v.kinds.filter((x) => x !== k) })} /> {labelOf(k, locale)}
            </label>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={v.faqAutoReply} onCheckedChange={(c) => setV({ ...v, faqAutoReply: !!c })} /> رد تلقائي على الأسئلة الشائعة (المرحلة 3)
        </label>
        <Button size="sm" onClick={() => onSave("autoApprove", v)}>
          {t.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}

function IntegrationsTab({ value, hints, onSave }: { value: Record<string, unknown>; hints: { embeddingsConfigured: boolean; resendConfigured: boolean; llmProvider: string }; onSave: SaveFn }) {
  const { t } = useT();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.settings.integrations}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div>Meta / Instagram: {value.metaConnected ? "متصل" : "غير متصل — وضع المحاكاة (المرحلة 3)"}</div>
        <div>WhatsApp Business: {value.whatsappConnected ? "متصل" : "غير متصل (المرحلة 2/3)"}</div>
        <div>
          Resend (بريد إعادة التعيين): {hints.resendConfigured ? "مضبوط" : "غير مضبوط — الرموز تظهر في سجلات Convex"}
        </div>
        <div>Embeddings (Voyage AI): {hints.embeddingsConfigured ? "مضبوط" : "غير مضبوط — تضمين حتمي محلي"}</div>
        <div>
          LLM: <span dir="ltr">{hints.llmProvider}</span>
        </div>
        <label className="flex items-center gap-2">
          <Switch checked={value.instagramMode === "live"} onCheckedChange={(c) => onSave("integrations", { instagramMode: c ? "live" : "mock" })} /> وضع إنستجرام حي (يتطلب ربط Meta)
        </label>
        <p className="text-xs text-muted-foreground">تُضبط المفاتيح في متغيرات بيئة Convex فقط (انظر .env.example)؛ لا تُخزَّن هنا.</p>
      </CardContent>
    </Card>
  );
}

function CompanyTab({ value, onSave }: { value: Record<string, unknown>; onSave: SaveFn }) {
  const { t } = useT();
  const [c, setC] = useState(value);
  useEffect(() => setC(value), [value]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t.settings.company}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {(["name", "nameEn", "legalEntity", "country", "timezone", "phone", "email", "website", "address"] as const).map((k) => (
            <Field key={k} label={k}>
              <Input dir={k === "name" || k === "address" ? "rtl" : "ltr"} value={String(c[k] ?? "")} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <Field label="ملخص سياق الشركة (يُحقن في كل استدعاء للوكلاء ويُخزَّن مؤقتاً)">
          <Textarea rows={4} value={String(c.contextSummary ?? "")} onChange={(e) => setC({ ...c, contextSummary: e.target.value })} />
        </Field>
        <Button size="sm" onClick={() => onSave("company", c)}>
          {t.common.save}
        </Button>
      </CardContent>
    </Card>
  );
}

function UsersTab({ isOwner, meId }: { isOwner: boolean; meId?: Id<"users"> }) {
  const { t, locale } = useT();
  const users = useQuery(api.settings.listUsers, isOwner ? {} : "skip");
  const createUser = useAction(api.settings.createUser);
  const changePassword = useAction(api.settings.changePassword);
  const signOutEverywhere = useAction(api.settings.signOutEverywhere);
  const setAccess = useMutation(api.settings.setUserAccess);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "staff" });
  const [busy, setBusy] = useState(false);
  if (!isOwner) return <EmptyState>إدارة المستخدمين متاحة للمالك فقط.</EmptyState>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.settings.users}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {users?.map((u) => (
            <div key={u._id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <div>
                <div dir="ltr" className="font-medium">
                  {u.email}
                </div>
                <div className="text-xs text-muted-foreground">
                  {u.name ?? ""} · {u.role === "owner" ? "المالك" : "موظف"} {u.disabled ? `· ${t.settings.disabled}` : ""} · آخر دخول {formatDate(u.lastLoginAt, locale, true)}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="xs" variant="outline" onClick={() => setAccess({ userId: u._id, role: u.role === "owner" ? "staff" : "owner" }).catch((e) => toast.error(e.message))} disabled={u._id === meId}>
                  {u.role === "owner" ? "→ موظف" : "→ مالك"}
                </Button>
                <Button size="xs" variant="outline" onClick={() => setAccess({ userId: u._id, disabled: !u.disabled }).catch((e) => toast.error(e.message))} disabled={u._id === meId}>
                  {u.disabled ? "تفعيل" : "تعطيل"}
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    const p = window.prompt(t.auth.passwordHint);
                    if (p) changePassword({ userId: u._id, newPassword: p }).then(() => toast.success(t.settings.changePassword)).catch((e) => toast.error(e.message));
                  }}
                >
                  {t.settings.changePassword}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => signOutEverywhere({ userId: u._id }).then(() => toast.success(t.settings.endSessions))}>
                  {t.settings.endSessions}
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.settings.addUser}</CardTitle>
          <p className="text-xs text-muted-foreground">{t.auth.signupClosed}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label={t.auth.email}>
            <Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="الاسم">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t.auth.password} hint={t.auth.passwordHint}>
            <Input type="password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={form.role === "owner"} onCheckedChange={(c) => setForm({ ...form, role: c ? "owner" : "staff" })} /> دور المالك
          </label>
          <Button
            size="sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await createUser({ email: form.email, password: form.password, name: form.name || undefined, role: form.role });
                toast.success(t.settings.addUser);
                setForm({ email: "", password: "", name: "", role: "staff" });
              } catch (e) {
                toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t.settings.addUser}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DataHealthTab() {
  const { t } = useT();
  const health = useQuery(api.dataQuality.health);
  if (!health) return <div className="text-sm text-muted-foreground">{t.common.loading}</div>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">الحقول الناقصة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {health.missingFields.map((m) => (
            <div key={m.rule} className="flex items-center justify-between gap-2">
              <span>
                {m.description} <span className="text-xs text-muted-foreground" dir="ltr">({m.table}.{m.field})</span>
              </span>
              <span className={`tabular-nums ${m.percent > 30 ? "text-destructive" : ""}`}>
                {m.missing}/{m.total} ({formatPercent(m.percent)}) <SeverityBadge value={m.severity} />
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">بيانات قديمة وغير متحقق منها</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {health.stale.map((s) => (
            <div key={s.table} className="flex justify-between" dir="ltr">
              <span>{s.table}</span>
              <span>
                expired {s.expired} · expiring {s.expiring} · verify {s.requiresVerification} / {s.total}
              </span>
            </div>
          ))}
          <div className="border-t pt-2" />
          {health.unverified.map((s) => (
            <div key={s.table} className="flex justify-between" dir="ltr">
              <span>{s.table}</span>
              <span>
                migrated {s.migratedUnverified} · ai {s.aiExtracted} / {s.total}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">التكرارات المحتملة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {health.duplicates.map((d) => (
            <div key={`${d.table}-${d.key}`} className="flex justify-between" dir="ltr">
              <span>
                {d.table}.{d.key}
              </span>
              <span className={d.groups > 0 ? "text-destructive" : ""}>{d.groups}</span>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">فشل التكاملات</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span>تنفيذ اعتمادات فاشل</span>
            <span>{health.integrationFailures.failedExecutions}</span>
          </div>
          <div className="flex justify-between">
            <span>استخراج مستندات فاشل</span>
            <span>{health.integrationFailures.failedExtractions}</span>
          </div>
          <div className="flex justify-between">
            <span>مهام فاشلة</span>
            <span>{health.integrationFailures.failedTasks}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function GovernanceTab() {
  const { t, locale } = useT();
  const gaps = useQuery(api.dataQuality.gaps);
  const conflicts = useQuery(api.dataQuality.conflicts);
  const memories = useQuery(api.dataQuality.memoryProposals);
  const notifications = useQuery(api.settings.notifications);
  const dismissGap = useMutation(api.dataQuality.dismissGap);
  const resolveConflict = useMutation(api.dataQuality.resolveConflict);
  const decideMemory = useMutation(api.dataQuality.decideMemory);
  const markRead = useMutation(api.settings.markNotificationRead);
  const ensure = useMutation(api.bootstrap.ensure);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t.dashboard.notifications}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {notifications?.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          {notifications?.map((n) => (
            <div key={n._id} className="flex items-start justify-between gap-2 rounded-md border p-2">
              <div>
                <div className="font-medium">{n.title}</div>
                <div className="text-xs text-muted-foreground">{n.body}</div>
              </div>
              <Button size="xs" variant="ghost" onClick={() => markRead({ notificationId: n._id })}>
                ✓
              </Button>
            </div>
          ))}
          <Button size="sm" variant="outline" className="mt-2" onClick={() => ensure().then((r) => toast.success(`agents ${r.agents} · matrix ${r.matrix} · tools ${r.tools}`)).catch((e) => toast.error(e.message))}>
            تثبيت الإعدادات الافتراضية (الوكلاء/المصفوفة/الأدوات)
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">فجوات البيانات والمعرفة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {gaps?.data.map((g) => (
            <div key={g._id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <span>
                {g.description} — {g.affectedCount}/{g.totalCount} ({formatPercent(g.percent)}) <SeverityBadge value={g.severity} />
              </span>
              <Button size="xs" variant="ghost" onClick={() => dismissGap({ kind: "data", id: g._id })}>
                تجاهل
              </Button>
            </div>
          ))}
          {gaps?.knowledge.map((g) => (
            <div key={g._id} className="flex items-center justify-between gap-2 rounded-md border p-2">
              <span>
                ❓ {g.question} <span className="text-xs text-muted-foreground">({g.occurrences}× · {labelOf(g.askedBy, locale)})</span>
              </span>
              <Button size="xs" variant="ghost" onClick={() => dismissGap({ kind: "knowledge", id: g._id })}>
                تجاهل
              </Button>
            </div>
          ))}
          {gaps && gaps.data.length + gaps.knowledge.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">تعارضات بيانات مصعّدة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {conflicts?.escalated.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          {conflicts?.escalated.map((c) => (
            <div key={c._id} className="rounded-md border p-2">
              <div className="font-medium" dir="ltr">
                {c.table}.{c.field} {c.recordId ?? ""}
              </div>
              <div className="mt-1 space-y-1">
                {c.candidates.map((cand, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span>
                      {JSON.stringify(cand.value)} · {labelOf(cand.trustLevel, locale)} · {cand.source.kind} {cand.source.ref ?? ""} · {formatDate(cand.observedAt, locale)}
                    </span>
                    <Button size="xs" variant="outline" onClick={() => resolveConflict({ conflictId: c._id, value: cand.value, reason: "owner_pick" }).then(() => toast.success(t.common.save))}>
                      اعتماد هذه القيمة
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">اقتراحات ذاكرة بانتظار المراجعة</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {memories?.length === 0 && <EmptyState>{t.common.empty}</EmptyState>}
          {memories?.map((m) => (
            <div key={m._id} className="rounded-md border p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs">
                  <AgentBadge slug={m.agentSlug} /> <StatusBadge value={m.type} /> {m.origin} {m.confidence !== undefined ? `· ثقة ${m.confidence}` : ""}
                </span>
                <span className="flex gap-1">
                  <Button size="xs" onClick={() => decideMemory({ memoryId: m._id, decision: "APPROVED" })}>
                    {t.common.approve}
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => decideMemory({ memoryId: m._id, decision: "REJECTED" })}>
                    {t.common.reject}
                  </Button>
                </span>
              </div>
              <div className="mt-1">{m.content}</div>
              {m.subject && (
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {m.subject.table}/{m.subject.recordId}
                </div>
              )}
            </div>
          ))}
          {conflicts && conflicts.resolved.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer">تعارضات محسومة آلياً ({conflicts.resolved.length})</summary>
              <JsonView value={conflicts.resolved.map((c) => ({ field: c.field, rule: c.resolutionRule, value: c.resolvedValue }))} />
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
