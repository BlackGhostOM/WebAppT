"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";

/**
 * Public website contact form (section 3.4). Posts straight to the Convex HTTP
 * endpoint; the message lands in the unified inbox and the support agent
 * proposes a reply for the owner. No sign-in involved.
 */
export default function ContactPage() {
  const { t, locale, setLocale } = useT();
  const [form, setForm] = useState({ name: "", phone: "", email: "", subject: "", message: "", website: "" });
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error" | "rate_limited" | "contact_required">("idle");
  const endpoint = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? ""}/api/contact`;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.phone.trim() && !form.email.trim()) {
      setState("contact_required");
      return;
    }
    setState("busy");
    try {
      const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, language: locale, requestId }),
      });
      if (res.status === 429) setState("rate_limited");
      else if (!res.ok) setState("error");
      else setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-xl">{t.contact.title}</CardTitle>
              <CardDescription>{t.contact.subtitle}</CardDescription>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
              {locale === "ar" ? "English" : "العربية"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {state === "sent" ? (
            <div className="rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-success-text" role="status">
              {t.contact.sent}
            </div>
          ) : (
            <form className="grid gap-3" onSubmit={onSubmit}>
              <div className="grid gap-1">
                <Label htmlFor="name">{t.contact.name}</Label>
                <Input id="name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1">
                  <Label htmlFor="phone">{t.contact.phone}</Label>
                  <Input id="phone" dir="ltr" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" placeholder="+968 9xxxxxxx" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="email">{t.contact.email}</Label>
                  <Input id="email" dir="ltr" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
                </div>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="subject">{t.contact.subject}</Label>
                <Input id="subject" maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="message">{t.contact.message}</Label>
                <Textarea id="message" required minLength={5} maxLength={5000} rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              </div>
              {/* Honeypot: hidden from people, filled by bots. */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
              </div>
              {state === "contact_required" && <p className="text-sm text-destructive-text">{t.contact.contactRequired}</p>}
              {state === "error" && <p className="text-sm text-destructive-text">{t.contact.failed}</p>}
              {state === "rate_limited" && <p className="text-sm text-destructive-text">{t.contact.rateLimited}</p>}
              <Button type="submit" disabled={state === "busy"}>
                {t.contact.send}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
