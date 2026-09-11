"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { AlertCircleIcon, CompassIcon, Loader2Icon, MailCheckIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

export default function ResetPasswordPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { t } = useT();
  const [step, setStep] = useState<"request" | "verify">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), flow: "reset" });
      setMessage(t.auth.codeSent);
      setStep("verify");
    } catch {
      setError(t.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), code: code.trim(), newPassword, flow: "reset-verification" });
      router.replace("/dashboard");
    } catch {
      setError(t.common.error);
    } finally {
      setBusy(false);
    }
  }

  const errorBox = error && (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-text">
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  );

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
          <CompassIcon className="size-6" />
        </span>
        <div className="font-heading text-xl font-semibold">{t.appName}</div>
      </div>
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">{t.auth.resetTitle}</CardTitle>
          <CardDescription>{step === "request" ? t.auth.resetIntro : t.auth.passwordHint}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "request" ? (
            <form onSubmit={request} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  required
                  autoFocus
                  className="h-10"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                />
              </div>
              {errorBox}
              <Button type="submit" size="lg" disabled={busy} className="w-full">
                {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                {t.auth.resetSend}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-5">
              {message && (
                <p role="status" className="flex items-start gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-text">
                  <MailCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {message}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">{t.auth.resetCode}</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  required
                  autoFocus
                  className="h-10 font-mono tracking-widest"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newPassword">{t.auth.newPassword}</Label>
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  dir="ltr"
                  required
                  minLength={12}
                  className="h-10"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <p className="text-xs text-hint">{t.auth.passwordHint}</p>
              </div>
              {errorBox}
              <Button type="submit" size="lg" disabled={busy} className="w-full">
                {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
                {t.auth.resetConfirm}
              </Button>
            </form>
          )}
          <p className="mt-5 text-center text-sm">
            <Link href="/login" className="text-primary-text underline-offset-4 hover:underline">
              {t.auth.backToLogin}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
