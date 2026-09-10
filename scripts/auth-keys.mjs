/**
 * Generates the Convex Auth signing keys (RS256) and stores them on the current
 * Convex deployment together with SITE_URL. Headless replacement for the
 * interactive `npx @convex-dev/auth` wizard.
 *
 *   node scripts/auth-keys.mjs [siteUrl]
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const require = createRequire(import.meta.url);
const convexPkgPath = require.resolve("convex/package.json");
const convexPkg = require(convexPkgPath);
const convexBin = join(dirname(convexPkgPath), convexPkg.bin.convex);

const siteUrl = process.argv[2] ?? process.env.SITE_URL ?? "http://localhost:3000";

const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
const pkcs8 = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, " ");
const jwk = await exportJWK(publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...jwk }] });

function setEnv(name, value) {
  const result = spawnSync(process.execPath, [convexBin, "env", "set", `${name}=${value}`], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`Failed to set ${name}`);
    process.exit(result.status ?? 1);
  }
}

setEnv("JWT_PRIVATE_KEY", pkcs8);
setEnv("JWKS", jwks);
setEnv("SITE_URL", siteUrl);
console.log(`Convex Auth keys installed. SITE_URL=${siteUrl}`);
