"use client";

import { AlertCircleIcon, CheckCircle2Icon, CompassIcon, Loader2Icon } from "lucide-react";
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
  const empty = { name: "", phone: "", email: "", subject: "", message: "", website: "" };
  const [form, setForm] = useState(empty);
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

  const problem =
    state === "contact_required" ? t.contact.contactRequired : state === "error" ? t.contact.failed : state === "rate_limited" ? t.contact.rateLimited : null;
  const contactMissing = state === "contact_required";

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className="mb-6 flex w-full max-w-lg items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
            <CompassIcon className="size-5" />
          </span>
          <span className="font-heading text-lg font-semibold">{t.appName}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
          {locale === "ar" ? "English" : "العربية"}
        </Button>
      </div>
      <Card className="w-full max-w-lg shadow-md">
        <CardHeader>
          <CardTitle className="text-xl">{t.contact.title}</CardTitle>
          <CardDescription>{t.contact.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          {state === "sent" ? (
            <div
              role="status"
              className="flex flex-col items-center gap-3 rounded-xl border border-success/30 bg-success-soft p-6 text-center text-sm text-success-text"
            >
              <CheckCircle2Icon className="size-8" aria-hidden />
              <p className="leading-6">{t.contact.sent}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setForm(empty);
                  setState("idle");
                }}
              >
                {t.contact.sendAnother}
              </Button>
            </div>
          ) : (
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="grid gap-1.5">
                <Label htmlFor="name">
                  {t.contact.name}{" "}
                  <span className="text-destructive" aria-hidden>
                    *
                  </span>
                </Label>
                <Input
                  id="name"
                  required
                  minLength={2}
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoComplete="name"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="phone">{t.contact.phone}</Label>
                  <Input
                    id="phone"
                    dir="ltr"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    autoComplete="tel"
                    placeholder="+968 9xxxxxxx"
                    aria-invalid={contactMissing}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="email">{t.contact.email}</Label>
                  <Input
                    id="email"
                    dir="ltr"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    autoComplete="email"
                    aria-invalid={contactMissing}
                  />
                </div>
                <p className="text-xs text-hint sm:col-span-2">{t.contact.contactHint}</p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="subject">{t.contact.subject}</Label>
                <Input id="subject" maxLength={200} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="message">
                  {t.contact.message}{" "}
                  <span className="text-destructive" aria-hidden>
                    *
                  </span>
                </Label>
                <Textarea
                  id="message"
                  required
                  minLength={5}
                  maxLength={5000}
                  rows={5}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
              </div>
              {/* Honeypot: hidden from people, filled by bots. */}
              <div className="hidden" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => setForm({ ...form, website: e.target.value })}
                />
              </div>
              {problem && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-text"
                >
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {problem}
                </p>
              )}
              <Button type="submit" size="lg" disabled={state === "busy"} className="w-full sm:w-auto sm:self-end">
                {state === "busy" ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                {state === "busy" ? t.common.loading : t.contact.send}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
