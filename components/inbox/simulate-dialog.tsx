"use client";

import { useMutation } from "convex/react";
import { FlaskConicalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { labelOf, useT } from "@/lib/i18n";

const CHANNELS = ["INSTAGRAM", "WEBSITE", "WHATSAPP", "EMAIL"] as const;

const SAMPLES = [
  { label: "استفسار", body: "السلام عليكم، هل عندكم رحلات إلى الجبل الأخضر في نوفمبر؟ وما هي سياسة الإلغاء؟" },
  { label: "طلب حجز", body: "أرغب في حجز باقة كنوز مسقط لعائلة من 4 أفراد في الأسبوع الأول من ديسمبر. كيف أبدأ؟" },
  { label: "شكوى", body: "تجربة سيئة جداً! السائق تأخر ساعتين والفندق ليس كما وُعدنا. أريد استرداد المبلغ وإلا سأنشر التجربة." },
  { label: "English", body: "Hi! Do you offer desert camping trips from Muscat? What should we bring?" },
];

const errMsg = (e: unknown, fallback: string) => (e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : fallback);

export function SimulateInboundDialog({ onCreated }: { onCreated?: (interactionId: Id<"interactions">) => void }) {
  const { t, locale } = useT();
  const simulate = useMutation(api.inbox.simulate);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ channel: "INSTAGRAM", senderName: "سارة الحارثية", handle: "sara.travels", phone: "", email: "", body: SAMPLES[0].body });

  async function submit() {
    setBusy(true);
    try {
      const result = await simulate({
        channel: form.channel,
        body: form.body,
        senderName: form.senderName || undefined,
        handle: form.channel === "INSTAGRAM" ? form.handle || undefined : undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
      });
      toast.success(result.taskId ? "وصلت الرسالة وبدأ وكيل خدمة العملاء معالجتها" : "وصلت الرسالة إلى الصندوق (بلا معالجة آلية)");
      setOpen(false);
      onCreated?.(result.interactionId);
    } catch (e) {
      toast.error(errMsg(e, t.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <FlaskConicalIcon data-icon="inline-start" /> {t.inbox.simulate}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.inbox.simulate}</DialogTitle>
            <DialogDescription>{t.inbox.simulateHint}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label>القناة</Label>
                <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: String(v ?? "INSTAGRAM") })} items={CHANNELS.map((c) => ({ value: c, label: labelOf(c, locale) }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {labelOf(c, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1">
                <Label>{t.inbox.sender}</Label>
                <Input value={form.senderName} onChange={(e) => setForm({ ...form, senderName: e.target.value })} />
              </div>
              {form.channel === "INSTAGRAM" ? (
                <div className="grid gap-1">
                  <Label>{t.inbox.handle}</Label>
                  <Input dir="ltr" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="@handle" />
                </div>
              ) : (
                <>
                  <div className="grid gap-1">
                    <Label>{t.contact.phone}</Label>
                    <Input dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+968 9xxxxxxx" />
                  </div>
                  <div className="grid gap-1">
                    <Label>{t.contact.email}</Label>
                    <Input dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                </>
              )}
            </div>
            <div className="grid gap-1">
              <Label>{t.inbox.message}</Label>
              <Textarea rows={5} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
              <div className="flex flex-wrap gap-1">
                {SAMPLES.map((s) => (
                  <Button key={s.label} type="button" size="xs" variant="outline" onClick={() => setForm({ ...form, body: s.body })}>
                    {s.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t.common.cancel}
            </Button>
            <Button onClick={submit} disabled={busy || !form.body.trim()}>
              {t.common.send}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
