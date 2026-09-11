"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { AlertCircleIcon, CompassIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
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
  const { t, locale, setLocale } = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background p-4">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm" aria-hidden>
          <CompassIcon className="size-6" />
        </span>
        <div>
          <div className="font-heading text-xl font-semibold">{t.appName}</div>
          <div className="text-sm text-muted-foreground">{t.auth.subtitle}</div>
        </div>
      </div>
      <Card className="w-full max-w-sm shadow-md">
        <CardHeader>
          <CardTitle className="text-lg">{t.auth.signIn}</CardTitle>
          <CardDescription>{t.auth.signupClosed}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate={false}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t.auth.email}</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                dir="ltr"
                required
                autoFocus
                className="h-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!error}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t.auth.password}</Label>
                <Link href="/reset-password" className="text-xs text-primary-text underline-offset-4 hover:underline">
                  {t.auth.forgot}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  dir="ltr"
                  required
                  minLength={12}
                  className="h-10 pe-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  aria-invalid={!!error}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 end-0 flex w-11 items-center justify-center rounded-e-lg text-muted-foreground hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-text"
              >
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={busy} className="w-full">
              {busy ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : null}
              {busy ? t.common.loading : t.auth.signIn}
            </Button>
          </form>
        </CardContent>
      </Card>
      <Button variant="ghost" size="sm" className="mt-4 text-muted-foreground" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
        {locale === "ar" ? "English" : "العربية"}
      </Button>
    </main>
  );
}
