/**
 * Deploy Cloud Functions with a longer discovery timeout.
 * Default Firebase discovery is 10s; cold Windows loads of this
 * codebase (Stripe + React Email + Admin) often exceed that on the
 * first attempt and succeed on the second.
 */
const { spawnSync } = require("child_process");

process.env.FUNCTIONS_DISCOVERY_TIMEOUT =
  process.env.FUNCTIONS_DISCOVERY_TIMEOUT || "60";

const result = spawnSync(
  "npx",
  ["firebase", "deploy", "--only", "functions", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    shell: true,
    env: process.env,
    cwd: require("path").join(__dirname, "..", ".."),
  },
);

process.exit(result.status ?? 1);
