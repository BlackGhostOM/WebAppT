"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Route-level boundary for the signed-in app: keeps the shell, reports the error, offers a retry. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h2 className="text-lg font-semibold">تعذّر عرض هذه الصفحة</h2>
      <p className="text-sm leading-7 text-muted-foreground">
        حدث خطأ غير متوقع وسُجّل لمراجعته. بياناتك محفوظة في الخادم؛ جرّب إعادة التحميل أو العودة إلى لوحة التحكم.
        <span className="block text-xs">An unexpected error occurred and was recorded. Your data is safe on the server.</span>
      </p>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>
          إعادة المحاولة
        </Button>
        <Button render={<Link href="/dashboard" />} nativeButton={false}>
          لوحة التحكم
        </Button>
      </div>
      {error.digest ? (
        <p className="text-[11px] text-muted-foreground" dir="ltr">
          ref: {error.digest}
        </p>
      ) : null}
    </div>
  );
}
