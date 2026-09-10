"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { type EntityDef, type FieldDef } from "@/lib/entities";
import { fromDateInputValue, toDateInputValue } from "@/lib/format";
import { labelOf, useT } from "@/lib/i18n";

const CURRENCIES = ["OMR", "USD", "EUR", "GBP", "AED", "SAR"];

type Values = Record<string, unknown>;

/** Turns a stored record into form values (money → {amount,currency}, dates → timestamps). */
export function recordToValues(def: EntityDef, record: Record<string, unknown>): Values {
  const values: Values = {};
  const pricing = (record.pricing ?? {}) as Record<string, unknown>;
  const taxes = (record.taxesAndFees ?? {}) as { included?: boolean; percent?: number };
  const scope = (record.scope ?? {}) as { agentSlug?: string; domain?: string };
  for (const f of def.fields) {
    let v = record[f.name];
    if (def.key === "products" && ["supplierCost", "internalCost", "minSellingPrice", "recommendedSellingPrice", "customerSellingPrice"].includes(f.name)) v = pricing[f.name];
    if (def.key === "rates" && f.name === "taxesIncluded") v = taxes.included;
    if (def.key === "rates" && f.name === "taxesPercent") v = taxes.percent;
    if (def.key === "decisionRegister" && f.name === "scopeAgent") v = scope.agentSlug;
    if (def.key === "decisionRegister" && f.name === "scopeDomain") v = scope.domain;
    if (f.type === "money" && v && typeof v === "object") {
      const m = v as { amount: number; currency: string };
      v = { amount: m.amount, currency: m.currency };
    }
    if (v !== undefined) values[f.name] = v;
  }
  return values;
}

function FieldInput({ field, value, onChange, refOptions, error }: { field: FieldDef; value: unknown; onChange: (v: unknown) => void; refOptions: Record<string, { id: string; label: string }[]>; error?: string }) {
  const { locale } = useT();
  const id = `f-${field.name}`;
  const label = locale === "ar" ? field.labelAr : field.labelEn;
  const common = (
    <Label htmlFor={id} className="flex items-center gap-1">
      {label}
      {field.required && <span className="text-destructive">*</span>}
      {field.sensitive && <span className="text-[10px] text-destructive">STRICTLY_CONFIDENTIAL</span>}
    </Label>
  );
  let control: React.ReactNode;
  switch (field.type) {
    case "textarea":
      control = <Textarea id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={field.max} />;
      break;
    case "number":
    case "integer":
    case "percent":
      control = <Input id={id} type="number" inputMode="decimal" dir="ltr" step={field.type === "integer" ? 1 : "any"} min={field.min} max={field.max} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} />;
      break;
    case "boolean":
      control = (
        <div className="flex h-8 items-center">
          <Switch id={id} checked={!!value} onCheckedChange={(v) => onChange(!!v)} />
        </div>
      );
      break;
    case "enum":
      control = (
        <Select value={(value as string) ?? null} onValueChange={(v) => onChange(v ?? undefined)} items={(field.options ?? []).map((o) => ({ value: o, label: labelOf(o, locale) }))}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {labelOf(o, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "date":
      control = <Input id={id} type="date" dir="ltr" value={toDateInputValue(value as number | undefined)} onChange={(e) => onChange(fromDateInputValue(e.target.value))} />;
      break;
    case "money": {
      const m = (value as { amount?: number; currency?: string } | undefined) ?? {};
      control = (
        <div className="flex gap-2">
          <Input id={id} type="number" inputMode="decimal" dir="ltr" step="0.001" min={0} value={m.amount === undefined ? "" : String(m.amount)} onChange={(e) => onChange(e.target.value === "" ? undefined : { amount: Number(e.target.value), currency: m.currency ?? "OMR" })} className="flex-1" />
          <Select value={m.currency ?? "OMR"} onValueChange={(v) => onChange({ amount: m.amount ?? 0, currency: String(v ?? "OMR") })} items={CURRENCIES.map((c) => ({ value: c, label: c }))}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );
      break;
    }
    case "ref": {
      const options = refOptions[field.refTable ?? ""] ?? [];
      control = (
        <Select value={(value as string) ?? null} onValueChange={(v) => onChange(v ?? undefined)} items={options.map((o) => ({ value: o.id, label: o.label }))}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    }
    case "tags": {
      const selected = (value as string[] | undefined) ?? [];
      if (field.options || field.refTable) {
        const options = field.options ? field.options.map((o) => ({ id: o, label: labelOf(o, locale) })) : (refOptions[field.refTable ?? ""] ?? []);
        control = (
          <div className="flex flex-wrap gap-2 rounded-lg border p-2">
            {options.map((o) => (
              <label key={o.id} className="flex items-center gap-1.5 text-sm">
                <Checkbox checked={selected.includes(o.id)} onCheckedChange={(v) => onChange(v ? [...selected, o.id] : selected.filter((x) => x !== o.id))} />
                {o.label}
              </label>
            ))}
          </div>
        );
      } else {
        control = <Input id={id} value={selected.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="مفصولة بفواصل" />;
      }
      break;
    }
    case "email":
      control = <Input id={id} type="email" dir="ltr" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} />;
      break;
    case "phone":
      control = <Input id={id} type="tel" dir="ltr" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} placeholder="+968 9xxx xxxx" />;
      break;
    default:
      control = <Input id={id} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value || undefined)} maxLength={field.max} />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {common}
      {control}
      {field.helpAr && locale === "ar" && <p className="text-[11px] text-muted-foreground">{field.helpAr}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

interface RecordFormProps {
  def: EntityDef;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the form edits this record. */
  existing?: { _id: string } & Record<string, unknown>;
  onSaved?: (id: string) => void;
}

export function RecordFormDialog({ def, open, onOpenChange, existing, onSaved }: RecordFormProps) {
  const { t, locale } = useT();
  const convex = useConvex();
  const refOptions = useQuery(api.records.refOptions, open ? { entity: def.key } : "skip") ?? {};
  const create = useMutation(api.records.create);
  const update = useMutation(api.records.update);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [duplicates, setDuplicates] = useState<{ _id: string; businessId: string; label: string; matchedOn: string[] }[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existing) setValues(recordToValues(def, existing));
    else {
      const defaults: Values = {};
      for (const f of def.fields) {
        if (f.type === "enum" && f.required && f.options) defaults[f.name] = f.name === def.statusField ? (def.key === "products" ? "IDEA" : def.key === "leads" ? "NEW_LEAD" : def.key === "policies" ? "DRAFT" : f.options.includes("ACTIVE") ? "ACTIVE" : f.options[0]) : f.options.includes("ar") ? "ar" : undefined;
        if (f.name === "consentStatus") defaults[f.name] = "PENDING";
        if (f.name === "rateTrust") defaults[f.name] = "CONTRACTED";
        if (f.name === "paymentStatus") defaults[f.name] = "UNPAID";
        if (f.type === "boolean") defaults[f.name] = f.name === "taxesIncluded" ? true : false;
      }
      setValues(defaults);
    }
    setErrors({});
    setDuplicates(null);
  }, [open, existing, def]);

  const sections = useMemo(() => {
    const main = def.fields.filter((f) => !f.section && !f.readOnly);
    const pricing = def.fields.filter((f) => f.section === "pricing");
    return { main, pricing };
  }, [def]);

  function applyError(e: unknown) {
    const data = (e as { data?: { code?: string; details?: { errors?: { field: string; message: string }[]; candidates?: typeof duplicates } ; message?: string } }).data;
    if (data?.code === "DUPLICATE" && data.details?.candidates) {
      setDuplicates(data.details.candidates);
      return;
    }
    if (data?.details?.errors) {
      const map: Record<string, string> = {};
      for (const err of data.details.errors) map[err.field] = err.message;
      setErrors(map);
      toast.error(data.message ?? t.common.error);
      return;
    }
    toast.error(data?.message ?? (e instanceof Error ? e.message : t.common.error));
  }

  async function submit(e: FormEvent, acknowledgeDuplicates = false) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      if (existing) {
        const r = await update({ entity: def.key, id: existing._id, data: values });
        toast.success(`${t.common.save}: ${r.businessId}`);
        onSaved?.(r.id);
        onOpenChange(false);
      } else {
        if (!acknowledgeDuplicates && def.duplicateCheck) {
          const found = await convex.query(api.records.checkDuplicates, { entity: def.key, data: values });
          if (found.length > 0) {
            setDuplicates(found);
            setBusy(false);
            return;
          }
        }
        const r = await create({ entity: def.key, data: values, acknowledgeDuplicates });
        toast.success(`${t.common.create}: ${r.businessId}`);
        onSaved?.(r.id);
        onOpenChange(false);
      }
    } catch (err) {
      applyError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {existing ? t.common.edit : t.data.newRecord}: {def.singularAr}
          </DialogTitle>
          {def.hintAr && <DialogDescription>{def.hintAr}</DialogDescription>}
        </DialogHeader>
        <form onSubmit={(e) => submit(e)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {sections.main.map((f) => (
              <div key={f.name} className={f.type === "textarea" || f.type === "tags" ? "sm:col-span-2" : ""}>
                <FieldInput field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} refOptions={refOptions} error={errors[f.name]} />
              </div>
            ))}
          </div>
          {sections.pricing.length > 0 && (
            <fieldset className="rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">التسعير (للفرد) — الهامش يُحسب تلقائياً</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {sections.pricing.map((f) => (
                  <FieldInput key={f.name} field={f} value={values[f.name]} onChange={(v) => setValues((s) => ({ ...s, [f.name]: v }))} refOptions={refOptions} error={errors[f.name]} />
                ))}
              </div>
            </fieldset>
          )}
          {duplicates && duplicates.length > 0 && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900">
              <div className="font-medium">{t.data.duplicates}</div>
              <p className="text-xs">{t.data.duplicatesHint}</p>
              <ul className="mt-1 list-disc ps-5">
                {duplicates.map((d) => (
                  <li key={d._id}>
                    {d.label} ({d.businessId}) — {d.matchedOn.join(", ")}
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="outline" className="mt-2" onClick={(e) => submit(e as unknown as FormEvent, true)}>
                {t.data.proceedAnyway}
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t.common.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t.common.loading : t.common.save}
            </Button>
          </DialogFooter>
        </form>
        <p className="text-[11px] text-muted-foreground">
          {locale === "ar" ? "كل ما تُدخله يُوسم: مصدر بشري، تحقق بشري، ثقة الشركة (A) تلقائياً ويُسجَّل في التدقيق." : "Everything you enter is stamped human source / human verified / company trust (A) and audited."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
