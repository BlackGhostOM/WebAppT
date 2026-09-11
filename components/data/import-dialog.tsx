"use client";

import { useMutation } from "convex/react";
import Papa from "papaparse";
import { useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { EntityDef } from "@/lib/entities";
import { useT } from "@/lib/i18n";

type Row = Record<string, string>;

async function parseFile(file: File): Promise<{ columns: string[]; rows: Row[] }> {
  if (/\.xlsx?$/i.test(file.name)) {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
    return { columns: rows.length ? Object.keys(rows[0]) : [], rows };
  }
  const text = await file.text();
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  return { columns: parsed.meta.fields ?? [], rows: parsed.data };
}

function autoMap(def: EntityDef, columns: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of columns) {
    const norm = col.trim().toLowerCase();
    const match = def.fields.find((f) => f.name.toLowerCase() === norm || f.labelEn.toLowerCase() === norm || f.labelAr === col.trim());
    if (match) map[col] = match.name;
  }
  return map;
}

export function ImportDialog({ def, open, onOpenChange }: { def: EntityDef; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, locale } = useT();
  const importBatch = useMutation(api.records.importBatch);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [results, setResults] = useState<{ ok: number; failed: { index: number; error: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = await parseFile(file);
      setColumns(parsed.columns);
      setRows(parsed.rows);
      setMapping(autoMap(def, parsed.columns));
      setResults(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    }
  }

  function toRecord(row: Row): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [col, field] of Object.entries(mapping)) {
      if (!field) continue;
      const def_ = def.fields.find((f) => f.name === field);
      const raw = row[col];
      if (raw === undefined || raw === "") continue;
      switch (def_?.type) {
        case "number":
        case "integer":
        case "percent":
          out[field] = Number(raw);
          break;
        case "boolean":
          out[field] = /^(true|1|نعم|yes)$/i.test(String(raw));
          break;
        case "money":
          out[field] = { amount: Number(String(raw).replace(/[^\d.]/g, "")), currency: /usd|\$/i.test(String(raw)) ? "USD" : "OMR" };
          break;
        case "tags":
          out[field] = String(raw)
            .split(/[,;|]/)
            .map((s) => s.trim())
            .filter(Boolean);
          break;
        default:
          out[field] = String(raw).trim();
      }
    }
    return out;
  }

  async function run() {
    setBusy(true);
    const failed: { index: number; error: string }[] = [];
    let ok = 0;
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100).map(toRecord);
        const res = await importBatch({ entity: def.key, rows: chunk });
        for (const r of res) {
          if (r.ok) ok += 1;
          else failed.push({ index: i + r.index + 1, error: r.error ?? "" });
        }
      }
      setResults({ ok, failed });
      toast.success(`${ok} / ${rows.length}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const fieldOptions = def.fields.map((f) => ({ value: f.name, label: locale === "ar" ? f.labelAr : f.labelEn }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {t.data.import}: {def.labelAr}
          </DialogTitle>
          <DialogDescription>{t.data.importHint}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="import-file">1 · {t.data.chooseFile}</Label>
          <Input id="import-file" type="file" accept=".csv,.xlsx,.xls,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
        {columns.length > 0 && (
          <>
            <h3 className="text-sm font-semibold">2 · {t.data.mapColumns}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {columns.map((col) => (
                <div key={col} className="flex items-center gap-2 text-sm">
                  <span className="w-1/2 truncate font-mono text-xs" dir="ltr">
                    {col}
                  </span>
                  <Select value={mapping[col] ?? null} onValueChange={(v) => setMapping((m) => ({ ...m, [col]: String(v ?? "") }))} items={fieldOptions}>
                    <SelectTrigger className="w-1/2">
                      <SelectValue placeholder={t.data.ignoreColumn} />
                    </SelectTrigger>
                    <SelectContent>
                      {fieldOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <h3 className="text-sm font-semibold">
              3 · {t.data.preview} ({rows.length})
            </h3>
            <div className="max-h-48 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.slice(0, 6).map((c) => (
                      <TableHead key={c} dir="ltr">
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      {columns.slice(0, 6).map((c) => (
                        <TableCell key={c} className="text-xs">
                          {String(r[c] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {results && (
          <div
            role="status"
            className={
              results.failed.length === 0
                ? "rounded-lg border border-success/30 bg-success-soft p-3 text-sm text-success-text"
                : "rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-warning-text"
            }
          >
            <div className="font-medium">
              {t.data.imported}: {results.ok} · {t.data.failedRows}: {results.failed.length}
            </div>
            <ul className="mt-1 max-h-32 list-disc overflow-auto ps-5 text-xs text-destructive-text">
              {results.failed.map((f) => (
                <li key={f.index}>
                  #{f.index}: {f.error}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.close}
          </Button>
          <Button onClick={run} disabled={busy || rows.length === 0 || Object.values(mapping).filter(Boolean).length === 0}>
            {busy ? t.common.loading : t.data.startImport}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
