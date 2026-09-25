const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.join(__dirname, "..");
const required = [
  path.join(projectRoot, "node_modules", "@whiskeysockets", "baileys", "package.json"),
  path.join(projectRoot, "node_modules", "pino", "package.json")
];

function ensureDeps() {
  if (required.every(file => fs.existsSync(file))) return;

  console.log("[Aura-XMD] Dependencies are missing; installing from package-lock.json...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
    cwd: projectRoot,
    stdio: "inherit"
  });

  if (result.error) throw new Error(`Could not start npm: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`npm ci failed with exit code ${result.status}.`);
}

if (require.main === module) {
  try {
    ensureDeps();
  } catch (error) {
    console.error(`[Aura-XMD] ${error.message}`);
    process.exit(1);
  }
}

module.exports = ensureDeps;
