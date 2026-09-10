/**
 * Password-reset OTP delivered by email through Resend.
 *
 * Mock mode: when AUTH_RESEND_KEY is not set the code is written to the Convex
 * logs instead of being emailed, so local development works without a key.
 */
import Resend from "@auth/core/providers/resend";

function generateNumericCode(length: number): string {
  const digits = new Uint8Array(length);
  crypto.getRandomValues(digits);
  return Array.from(digits, (d) => String(d % 10)).join("");
}

export const ResendOTPPasswordReset = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY ?? "mock",
  maxAge: 15 * 60,
  async generateVerificationToken() {
    return generateNumericCode(8);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const apiKey = process.env.AUTH_RESEND_KEY;
    if (!apiKey) {
      console.log(`[MOCK EMAIL] رمز إعادة تعيين كلمة المرور للمستخدم ${email}: ${token}`);
      return;
    }
    const { Resend: ResendAPI } = await import("resend");
    const resend = new ResendAPI(apiKey);
    const { error } = await resend.emails.send({
      from: process.env.AUTH_EMAIL_FROM ?? "مركز العمليات <onboarding@resend.dev>",
      to: [email],
      subject: "رمز إعادة تعيين كلمة المرور — مركز العمليات",
      text: `رمز إعادة تعيين كلمة المرور الخاص بك هو: ${token}\nالرمز صالح لمدة 15 دقيقة. إن لم تطلب هذا الرمز فتجاهل الرسالة.`,
    });
    if (error) throw new Error(`RESEND_ERROR: ${JSON.stringify(error)}`);
    void provider;
  },
});
