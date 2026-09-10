"use client";

import { useAuthActions } from "@convex-dev/auth/react";
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

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t.auth.resetTitle}</CardTitle>
          <CardDescription>{t.auth.passwordHint}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === "request" ? (
            <form onSubmit={request} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">{t.auth.email}</Label>
                <Input id="email" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {t.auth.resetSend}
              </Button>
            </form>
          ) : (
            <form onSubmit={verify} className="flex flex-col gap-4">
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="code">{t.auth.resetCode}</Label>
                <Input id="code" inputMode="numeric" dir="ltr" required value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newPassword">{t.auth.newPassword}</Label>
                <Input id="newPassword" type="password" dir="ltr" required minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={busy} className="w-full">
                {t.auth.resetConfirm}
              </Button>
            </form>
          )}
          <p className="mt-4 text-sm">
            <Link href="/login" className="text-primary underline-offset-4 hover:underline">
              {t.auth.backToLogin}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
