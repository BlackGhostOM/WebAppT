/**
 * Convex Auth configuration: email + password only.
 *
 * - Public sign-up is closed: the `signUp` flow is refused. Accounts are created
 *   by the owner seed (`seedOwner`) or by the owner from Settings.
 * - Passwords: 12+ characters with letters and digits, hashed with Scrypt.
 * - Temporary lock after 5 failed attempts per hour (built-in rate limit).
 * - Sessions expire after 7 days of inactivity.
 * - Every login (and failed login) is appended to `auditLog`.
 */
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth, type ConvexCredentialsConfig } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { ResendOTPPasswordReset } from "./auth/ResendOTPPasswordReset";

export const PASSWORD_MIN_LENGTH = 12;
export const SESSION_INACTIVE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_TOTAL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_FAILED_ATTEMPTS_PER_HOUR = 5;

export function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`PASSWORD_TOO_SHORT: at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (!/[A-Za-z؀-ۿ]/.test(password) || !/\d/.test(password)) {
    throw new Error("PASSWORD_TOO_WEAK: use letters and digits");
  }
}

function normalizeEmail(value: unknown): string {
  const email = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_EMAIL");
  return email;
}

const basePassword = Password<DataModel>({
  profile(params) {
    return { email: normalizeEmail(params.email) };
  },
  validatePasswordRequirements: validatePassword,
  reset: ResendOTPPasswordReset,
});

/** Same provider with public sign-up disabled and login auditing. */
const PasswordClosed: ConvexCredentialsConfig = {
  ...basePassword,
  authorize: async (params, ctx) => {
    const flow = params.flow;
    if (flow === "signUp") throw new Error("SIGNUP_DISABLED");
    let email: string | undefined;
    try {
      email = normalizeEmail(params.email);
    } catch {
      email = undefined;
    }
    try {
      const result = await basePassword.authorize(params, ctx);
      if (flow === "signIn" && result) {
        await ctx.runMutation(internal.authEvents.recordLogin, { userId: result.userId, email: email ?? "" });
      }
      if (flow === "reset-verification" && result) {
        await ctx.runMutation(internal.authEvents.recordPasswordReset, { userId: result.userId });
      }
      return result;
    } catch (error) {
      if (flow === "signIn" && email) {
        await ctx.runMutation(internal.authEvents.recordFailedLogin, { email, reason: error instanceof Error ? error.message : "unknown" });
      }
      throw error;
    }
  },
};

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [PasswordClosed],
  session: { inactiveDurationMs: SESSION_INACTIVE_MS, totalDurationMs: SESSION_TOTAL_MS },
  signIn: { maxFailedAttempsPerHour: MAX_FAILED_ATTEMPTS_PER_HOUR },
  callbacks: {
    async beforeSessionCreation(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      if (user.disabled) throw new Error("ACCOUNT_DISABLED");
    },
  },
});
