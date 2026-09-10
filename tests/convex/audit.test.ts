import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as auditModule from "../../convex/lib/audit";
import { appendAudit } from "../../convex/lib/audit";
import { setup } from "./helpers";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === "_generated" || entry === "tests") continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("audit log is append-only", () => {
  it("has no update, patch, replace or delete against auditLog anywhere in the backend", () => {
    const files = walk(join(process.cwd(), "convex"));
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, i) => {
        if (!line.includes("auditLog")) return;
        if (/\.(patch|replace|delete)\(/.test(line)) offenders.push(`${file}:${i + 1}`);
      });
      // A query over auditLog whose result is later mutated would need a variable; forbid the pattern outright.
      if (/query\("auditLog"\)[\s\S]{0,400}\.(patch|delete|replace)\(/.test(source)) offenders.push(`${file}: query→mutate`);
    }
    expect(offenders).toEqual([]);
  });

  it("exposes only the append primitive from the audit module", () => {
    expect(Object.keys(auditModule).sort()).toEqual(["appendAudit", "classifySeverity", "requiresOwnerApproval"]);
  });

  it("classifies severity so D3/D4 require owner approval", () => {
    expect(auditModule.classifySeverity("suppliers", { bankAccountRef: "1" })).toBe("D4");
    expect(auditModule.classifySeverity("rates", { amount: 1 })).toBe("D3");
    expect(auditModule.classifySeverity("customers", { notes: "x" })).toBe("D1");
    expect(auditModule.classifySeverity("customers", { phone: "x" })).toBe("D2");
    expect(auditModule.requiresOwnerApproval("D3")).toBe(true);
    expect(auditModule.requiresOwnerApproval("D2")).toBe(false);
  });

  it("appends entries with actor, table, event, old/new values and severity", async () => {
    const { t, ownerId } = await setup();
    const id = await t.run(async (ctx) =>
      appendAudit(ctx, { actor: { type: "owner", id: ownerId }, table: "rates", recordId: "r1", event: "UPDATE", oldValue: { amount: 50 }, newValue: { amount: 55 }, reason: "test", severity: "D3" }),
    );
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row).toMatchObject({ table: "rates", event: "UPDATE", severity: "D3", oldValue: { amount: 50 }, newValue: { amount: 55 } });
    expect(typeof row?.at).toBe("number");
  });
});
