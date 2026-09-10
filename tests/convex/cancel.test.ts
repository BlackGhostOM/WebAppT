import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("cooperative cancellation", () => {
  it("stops a running task within seconds even while the model call is in flight", async () => {
    const { t, asOwner } = await setup();
    // The mock provider sleeps 8s on every call; the stop button must not wait for it.
    const { taskId } = await asOwner.mutation(api.chat.send, { message: "حلّل المبيعات {{slow:8000}}" });
    const running = t.action(internal.agents.loop.run, { taskId });
    await new Promise((r) => setTimeout(r, 400));
    const started = Date.now();
    const { cancelled } = await asOwner.mutation(api.chat.stop, { taskId, reason: "اختبار الإيقاف" });
    expect(cancelled).toContain(taskId);
    await running;
    const elapsed = Date.now() - started;
    const task = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(task?.status).toBe("CANCELLED");
    expect(task?.cancelRequested).toBe(true);
    expect(task?.cancelReason).toBe("اختبار الإيقاف");
    expect(elapsed).toBeLessThan(4000);
    const audit = await t.run(async (ctx) => ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", "tasks").eq("recordId", taskId)).take(20));
    expect(audit.some((a) => a.event === "CANCEL")).toBe(true);
  });

  it("cascades to subtasks and cancels their pending approvals", async () => {
    const { t, asOwner } = await setup();
    const { taskId } = await asOwner.mutation(api.chat.send, { message: "[[delegate:product:صمّم باقة {{slow:8000}}]]" });
    await t.action(internal.agents.loop.run, { taskId });
    const parent = await t.run(async (ctx) => ctx.db.get(taskId));
    expect(parent?.status).toBe("WAITING_SUBTASKS");
    const children = await t.run(async (ctx) => ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", taskId)).take(10));
    expect(children).toHaveLength(1);
    const child = children[0];
    expect(child.agentSlug).toBe("product");
    // A pending approval hanging off the child must be cancelled too.
    const approvalId = await t.run(async (ctx) =>
      ctx.db.insert("approvals", { businessId: "APR-TEST", kind: "OTHER", status: "PENDING", taskId: child._id, agentSlug: "product", title: "t", summary: "s", payload: {}, severity: "D3", requestedAt: Date.now() }),
    );

    const childRun = t.action(internal.agents.loop.run, { taskId: child._id });
    await new Promise((r) => setTimeout(r, 400));
    const started = Date.now();
    await asOwner.mutation(api.chat.stop, { taskId, reason: "إيقاف الكل" });
    await childRun;
    expect(Date.now() - started).toBeLessThan(4000);

    const parentAfter = await t.run(async (ctx) => ctx.db.get(taskId));
    const childAfter = await t.run(async (ctx) => ctx.db.get(child._id));
    const approval = await t.run(async (ctx) => ctx.db.get(approvalId));
    expect(parentAfter?.status).toBe("CANCELLED");
    expect(childAfter?.status).toBe("CANCELLED");
    expect(childAfter?.cancelRequested).toBe(true);
    expect(approval?.status).toBe("CANCELLED");
  });

  it("refuses new tasks while the emergency stop is active", async () => {
    const { asOwner } = await setup();
    await asOwner.mutation(api.tasks.activateEmergencyStop, { reason: "اختبار" });
    await expect(asOwner.mutation(api.chat.send, { message: "أي شيء" })).rejects.toThrow(/EMERGENCY_STOP|الإيقاف الطارئ/);
    await asOwner.mutation(api.tasks.deactivateEmergencyStop, {});
    const { taskId } = await asOwner.mutation(api.chat.send, { message: "بعد التفعيل" });
    expect(taskId).toBeTruthy();
  });
});
