"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/** Last-resort boundary (replaces the root layout when it crashes). Reports to Sentry when configured. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#fafafa",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 480, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 12 }}>حدث خطأ غير متوقع</h1>
          <p style={{ color: "#555", lineHeight: 1.7 }}>سُجّل الخطأ لمراجعته. يمكنك إعادة المحاولة أو العودة إلى لوحة التحكم.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 20 }}>
            <button onClick={reset} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #ccc", background: "#fff", cursor: "pointer" }}>
              إعادة المحاولة
            </button>
            <a href="/dashboard" style={{ padding: "8px 16px", borderRadius: 8, background: "#111", color: "#fff", textDecoration: "none" }}>
              لوحة التحكم
            </a>
          </div>
          {error.digest ? (
            <p style={{ marginTop: 20, fontSize: 12, color: "#888" }} dir="ltr">
              ref: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
