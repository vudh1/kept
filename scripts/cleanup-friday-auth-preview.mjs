import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const tempRoot = resolve(process.env.RUNNER_TEMP || "/nonexistent");
const approvedConfig = resolve("worker/friday-auth/wrangler.preview.generated.toml");
const config = process.env.CONFIG_FILE ? resolve(process.env.CONFIG_FILE) : "";
const secrets = process.env.SECRETS_FILE ? resolve(process.env.SECRETS_FILE) : "";

// Delete precisely the ephemeral credential path created during this CI run;
// never act on arbitrary paths, the workspace root, or unrelated files.
if (secrets.startsWith(tempRoot + "/friday-auth-preview-") &&
    secrets.endsWith("/secrets.json") && existsSync(secrets)) rmSync(secrets);
if (config === approvedConfig && existsSync(config)) rmSync(config);
console.log("Temporary FRIDAY preview credential/config cleanup complete.");
