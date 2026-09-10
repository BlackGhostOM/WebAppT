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

export default function LoginPage() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), password, flow: "signIn" });
      router.replace("/dashboard");
    } catch {
      setError(t.auth.invalid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">{t.appName}</CardTitle>
          <CardDescription>{t.auth.subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t.auth.email}</Label>
              <Input id="email" type="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t.auth.password}</Label>
              <Input id="password" type="password" autoComplete="current-password" dir="ltr" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" disabled={busy} className="w-full">
              {busy ? t.common.loading : t.auth.signIn}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Link href="/reset-password" className="text-primary underline-offset-4 hover:underline">
                {t.auth.forgot}
              </Link>
            </div>
            <p className="text-xs text-muted-foreground">{t.auth.signupClosed}</p>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
