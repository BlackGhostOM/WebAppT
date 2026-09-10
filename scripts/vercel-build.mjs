/**
 * Vercel build entry point.
 *
 * With CONVEX_DEPLOY_KEY present (recommended for production) it deploys the
 * Convex functions first and builds the frontend against that deployment in one
 * atomic step: `npx convex deploy --cmd "npm run build"`.
 *
 * Without the key it only builds the frontend, using NEXT_PUBLIC_CONVEX_URL /
 * NEXT_PUBLIC_CONVEX_SITE_URL from the environment (or the defaults in
 * next.config.ts). Convex functions must then be deployed separately with
 * `npx convex deploy` from a machine that has the key.
 */
import { spawnSync } from "node:child_process";

const hasKey = !!process.env.CONVEX_DEPLOY_KEY;
const command = hasKey ? ["npx", "convex", "deploy", "--cmd", "npm run build", "--yes"] : ["npm", "run", "build"];
console.log(`[vercel-build] ${hasKey ? "CONVEX_DEPLOY_KEY found: deploying Convex + building" : "no CONVEX_DEPLOY_KEY: building frontend only"}`);
const result = spawnSync(command[0], command.slice(1), { stdio: "inherit", shell: process.platform === "win32", env: process.env });
process.exit(result.status ?? 1);
