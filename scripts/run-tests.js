#!/usr/bin/env node
// Runs every test suite (unit, python, browser) even if an earlier one fails, then reports
// which failed and exits non-zero if any did. Used by `npm test`.
const { spawnSync } = require("node:child_process");

const steps = [
  ["unit", "npm", ["run", "--silent", "test:unit"]],
  ["python", "npm", ["run", "--silent", "test:py"]],
  ["browser", "npm", ["run", "--silent", "test:e2e"]],
];

const failed = [];
for (const [name, cmd, args] of steps) {
  console.log(`\n=== ${name} tests ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length ? `\nFAILED: ${failed.join(", ")}` : "\nAll test suites passed.");
process.exit(failed.length ? 1 : 0);
