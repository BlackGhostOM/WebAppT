"use client";

/**
 * Dependency-free SVG charts for the reports and dashboard. They scale with
 * their container (viewBox) and are drawn LTR so axes read the same in both
 * locales; labels are plain text nodes so they inherit the page font.
 */

const PALETTE = ["#0f766e", "#2563eb", "#d97706", "#db2777", "#7c3aed", "#64748b"];

export interface SeriesDef {
  key: string;
  name: string;
  color?: string;
}

export interface BarChartProps {
  data: { label: string; values: Record<string, number> }[];
  series: SeriesDef[];
  height?: number;
  formatValue?: (n: number) => string;
  className?: string;
}

/** Grouped bars per label. */
export function BarChart({ data, series, height = 180, formatValue = (n) => String(n), className }: BarChartProps) {
  const width = 640;
  const padL = 36;
  const padB = 24;
  const padT = 8;
  const innerW = width - padL - 8;
  const innerH = height - padB - padT;
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const groupW = innerW / Math.max(1, data.length);
  const barW = Math.max(3, (groupW * 0.7) / Math.max(1, series.length));
  const ticks = 4;
  return (
    <div className={className} dir="ltr">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const y = padT + innerH - (innerH * i) / ticks;
          return (
            <g key={i}>
              <line x1={padL} x2={width - 8} y1={y} y2={y} stroke="currentColor" strokeOpacity={0.08} />
              <text x={padL - 4} y={y + 3} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>
                {formatValue((max * i) / ticks)}
              </text>
            </g>
          );
        })}
        {data.map((d, gi) => (
          <g key={d.label}>
            {series.map((s, si) => {
              const v = d.values[s.key] ?? 0;
              const h = (v / max) * innerH;
              const x = padL + gi * groupW + (groupW - barW * series.length) / 2 + si * barW;
              return (
                <g key={s.key}>
                  <rect x={x} y={padT + innerH - h} width={barW - 1} height={h} fill={s.color ?? PALETTE[si % PALETTE.length]} rx={1.5}>
                    <title>
                      {d.label} · {s.name}: {formatValue(v)}
                    </title>
                  </rect>
                </g>
              );
            })}
            <text x={padL + gi * groupW + groupW / 2} y={height - 8} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>
              {d.label}
            </text>
          </g>
        ))}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export interface LineChartProps {
  points: { label: string; value: number }[];
  color?: string;
  height?: number;
  formatValue?: (n: number) => string;
  /** Horizontal reference (e.g. budget). */
  reference?: { value: number; label: string };
  className?: string;
  area?: boolean;
}

export function LineChart({ points, color = PALETTE[0], height = 160, formatValue = (n) => String(n), reference, className, area = true }: LineChartProps) {
  const width = 640;
  const padL = 40;
  const padB = 22;
  const padT = 8;
  const innerW = width - padL - 8;
  const innerH = height - padB - padT;
  const max = Math.max(1, ...points.map((p) => p.value), reference?.value ?? 0) * 1.05;
  const step = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => padL + i * step;
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = points.length ? `${path} L${x(points.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z` : "";
  const labelEvery = Math.max(1, Math.ceil(points.length / 10));
  return (
    <div className={className} dir="ltr">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={width - 8} y1={y(max * f)} y2={y(max * f)} stroke="currentColor" strokeOpacity={0.08} />
            <text x={padL - 4} y={y(max * f) + 3} fontSize={9} textAnchor="end" fill="currentColor" opacity={0.6}>
              {formatValue(max * f)}
            </text>
          </g>
        ))}
        {reference && (
          <g>
            <line x1={padL} x2={width - 8} y1={y(reference.value)} y2={y(reference.value)} stroke="#dc2626" strokeDasharray="4 3" strokeOpacity={0.7} />
            <text x={width - 10} y={y(reference.value) - 3} fontSize={9} textAnchor="end" fill="#dc2626">
              {reference.label}
            </text>
          </g>
        )}
        {area && points.length > 1 && <path d={areaPath} fill={color} fillOpacity={0.12} />}
        {points.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
        {points.map((p, i) => (
          <g key={p.label + i}>
            <circle cx={x(i)} cy={y(p.value)} r={points.length > 40 ? 1.5 : 3} fill={color}>
              <title>
                {p.label}: {formatValue(p.value)}
              </title>
            </circle>
            {i % labelEvery === 0 && (
              <text x={x(i)} y={height - 6} fontSize={9} textAnchor="middle" fill="currentColor" opacity={0.7}>
                {p.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Horizontal bars for categorical breakdowns (status, channel, kind…). */
export function BreakdownBars({ items, formatValue = (n) => String(n), color = PALETTE[1], className }: { items: { label: string; value: number }[]; formatValue?: (n: number) => string; color?: string; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <div className="text-sm text-muted-foreground">—</div>;
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-32 shrink-0 truncate">{i.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full rounded" style={{ width: `${(i.value / max) * 100}%`, backgroundColor: color }} />
          </div>
          <span className="w-14 shrink-0 text-end tabular-nums">{formatValue(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground" dir="auto">
      {series.map((s, i) => (
        <span key={s.key} className="inline-flex items-center gap-1">
          <span className="inline-block size-2.5 rounded-sm" style={{ backgroundColor: s.color ?? PALETTE[i % PALETTE.length] }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Builds a CSV string (UTF-8 with BOM so Excel opens Arabic correctly) and triggers a download. */
export function downloadCsv(filename: string, input: readonly object[]) {
  const rows = input as readonly Record<string, unknown>[];
  if (rows.length === 0) return;
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))].join("\n");
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
