"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";

export interface EditableUser {
  _id: Id<"users">;
  email?: string;
  name?: string;
  phone?: string;
  locale: string;
}

const LOCALES = [
  { value: "ar", label: "العربية" },
  { value: "en", label: "English" },
];

/** Owner edits a user's name, e-mail (sign-in name), phone and UI language. */
export function UserEditDialog({ user, onClose }: { user: EditableUser | null; onClose: () => void }) {
  const { t } = useT();
  const updateUser = useMutation(api.settings.updateUser);
  const [form, setForm] = useState(() => ({ name: user?.name ?? "", email: user?.email ?? "", phone: user?.phone ?? "", locale: user?.locale ?? "ar" }));
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function save() {
    setBusy(true);
    try {
      await updateUser({
        userId: user!._id,
        name: form.name,
        email: form.email.trim().toLowerCase() !== (user!.email ?? "") ? form.email : undefined,
        phone: form.phone,
        locale: form.locale,
      });
      toast.success(t.common.save);
      onClose();
    } catch (e) {
      toast.error((e as { data?: { message?: string } }).data?.message ?? (e instanceof Error ? e.message : t.common.error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t.settings.editUser}</DialogTitle>
          <DialogDescription dir="ltr">{user.email}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>{t.settings.userName}</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
          </div>
          <div className="grid gap-1">
            <Label>{t.auth.email}</Label>
            <Input type="email" dir="ltr" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <p className="text-xs text-hint">{t.settings.emailChangeHint}</p>
          </div>
          <div className="grid gap-1">
            <Label>{t.settings.userPhone}</Label>
            <Input type="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+968 9xxxxxxx" />
          </div>
          <div className="grid gap-1">
            <Label>{t.settings.userLocale}</Label>
            <Select value={form.locale} onValueChange={(v) => setForm({ ...form, locale: String(v ?? "ar") })} items={LOCALES}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOCALES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button onClick={save} disabled={busy || !form.email.trim()}>
            {t.common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
