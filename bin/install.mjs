#!/usr/bin/env node

/**
 * npx feed-the-machine — installs ftm skills into ~/.claude/skills/
 *
 * Works by finding the npm package root (where the skill files live)
 * and symlinking them into the Claude Code skills directory.
 */

import { existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, unlinkSync, chmodSync, cpSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir, platform } from "os";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_DIR = dirname(__dirname); // package root (one level up from bin/)
const HOME = homedir();
const SKILLS_DIR = join(HOME, ".claude", "skills");
const STATE_DIR = join(HOME, ".claude", "ftm-state");
const CONFIG_DIR = join(HOME, ".claude");
const HOOKS_DIR = join(HOME, ".claude", "hooks");
const INBOX_INSTALL_DIR = join(HOME, ".claude", "ftm-inbox");

const ARGS = process.argv.slice(2);
const WITH_INBOX = ARGS.includes("--with-inbox");

function log(msg) {
  console.log(`  ${msg}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function safeSymlink(src, dest) {
  const name = basename(dest);
  try {
    if (lstatSync(dest).isSymbolicLink()) {
      unlinkSync(dest);
    } else if (existsSync(dest)) {
      log(`SKIP ${name} (real file/dir exists — back it up first)`);
      return;
    }
  } catch {
    // dest doesn't exist, that's fine
  }
  symlinkSync(src, dest);
  log(`LINK ${name}`);
}

function main() {
  console.log(`Installing ftm skills from: ${REPO_DIR}`);
  console.log(`Linking into: ${SKILLS_DIR}`);
  console.log("");

  ensureDir(SKILLS_DIR);

  // Link all ftm*.yml files
  const ymlFiles = readdirSync(REPO_DIR).filter(
    (f) => f.startsWith("ftm") && f.endsWith(".yml") && !f.includes("config.default")
  );
  for (const yml of ymlFiles) {
    safeSymlink(join(REPO_DIR, yml), join(SKILLS_DIR, yml));
  }

  // Link all ftm* directories (skills with SKILL.md)
  const dirs = readdirSync(REPO_DIR).filter((f) => {
    if (!f.startsWith("ftm")) return false;
    if (f === "ftm-state") return false;
    const fullPath = join(REPO_DIR, f);
    try {
      return lstatSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  });
  for (const dir of dirs) {
    safeSymlink(join(REPO_DIR, dir), join(SKILLS_DIR, dir));
  }

  // Set up blackboard state (copy templates, don't overwrite existing data)
  const bbDir = join(REPO_DIR, "ftm-state", "blackboard");
  if (existsSync(bbDir)) {
    ensureDir(join(STATE_DIR, "blackboard", "experiences"));

    const jsonFiles = readdirSync(bbDir).filter((f) => f.endsWith(".json"));
    for (const f of jsonFiles) {
      const target = join(STATE_DIR, "blackboard", f);
      if (!existsSync(target)) {
        copyFileSync(join(bbDir, f), target);
        log(`INIT ${f} (blackboard template)`);
      }
    }

    const idxSrc = join(bbDir, "experiences", "index.json");
    const idxDest = join(STATE_DIR, "blackboard", "experiences", "index.json");
    if (existsSync(idxSrc) && !existsSync(idxDest)) {
      copyFileSync(idxSrc, idxDest);
      log("INIT experiences/index.json (blackboard template)");
    }
  }

  // Copy default config if none exists
  const configSrc = join(REPO_DIR, "ftm-config.default.yml");
  const configDest = join(CONFIG_DIR, "ftm-config.yml");
  if (existsSync(configSrc) && !existsSync(configDest)) {
    copyFileSync(configSrc, configDest);
    log("INIT ftm-config.yml (from default template)");
  }

  // Install hooks
  const hooksDir = join(REPO_DIR, "hooks");
  let hookCount = 0;
  if (existsSync(hooksDir)) {
    ensureDir(HOOKS_DIR);
    console.log("");
    console.log("Installing hooks...");

    const hookFiles = readdirSync(hooksDir).filter(
      (f) => f.startsWith("ftm-") && (f.endsWith(".sh") || f.endsWith(".mjs"))
    );
    for (const hook of hookFiles) {
      const src = join(hooksDir, hook);
      const dest = join(HOOKS_DIR, hook);
      const action = existsSync(dest) ? "UPDATE" : "INSTALL";
      copyFileSync(src, dest);
      if (hook.endsWith(".sh")) {
        chmodSync(dest, 0o755);
      }
      log(`${action} ${hook}`);
      hookCount++;
    }
  }

  console.log("");
  console.log(`Done. ${ymlFiles.length} skills linked, ${hookCount} hooks installed.`);
  console.log("");
  console.log("To activate hooks, add them to ~/.claude/settings.json");
  console.log("  Option A: ./install.sh --setup-hooks (auto-merge)");
  console.log("  Option B: Copy entries from hooks/settings-template.json manually");
  console.log("  See docs/HOOKS.md for details.");
  console.log("");

  if (WITH_INBOX) {
    installInbox();
  } else {
    console.log("Try: /ftm help");
    console.log("     To also install the inbox service: npx feed-the-machine --with-inbox");
  }
}

function installInbox() {
  const inboxSrc = join(REPO_DIR, "ftm-inbox");
  if (!existsSync(inboxSrc)) {
    console.error("ERROR: ftm-inbox/ not found in package. Cannot install inbox service.");
    process.exit(1);
  }

  console.log("Installing ftm-inbox service...");
  console.log(`  Source:      ${inboxSrc}`);
  console.log(`  Destination: ${INBOX_INSTALL_DIR}`);
  console.log("");

  // Copy ftm-inbox/ to ~/.claude/ftm-inbox/
  ensureDir(INBOX_INSTALL_DIR);
  cpSync(inboxSrc, INBOX_INSTALL_DIR, { recursive: true });
  log("COPY ftm-inbox → ~/.claude/ftm-inbox/");

  // Make shell scripts executable
  const binDir = join(INBOX_INSTALL_DIR, "bin");
  const scripts = ["start.sh", "stop.sh", "status.sh"];
  for (const script of scripts) {
    const scriptPath = join(binDir, script);
    if (existsSync(scriptPath)) {
      chmodSync(scriptPath, 0o755);
      log(`CHMOD +x bin/${script}`);
    }
  }

  // Install Node deps if package.json exists
  const pkgJson = join(INBOX_INSTALL_DIR, "package.json");
  if (existsSync(pkgJson)) {
    console.log("");
    console.log("Installing Node.js dependencies...");
    const npmResult = spawnSync("npm", ["install", "--prefix", INBOX_INSTALL_DIR], {
      stdio: "inherit",
      cwd: INBOX_INSTALL_DIR,
    });
    if (npmResult.status !== 0) {
      console.warn("WARNING: npm install failed. Check Node.js version and try manually.");
    }
  }

  // Install Python deps if requirements.txt exists
  const reqTxt = join(INBOX_INSTALL_DIR, "requirements.txt");
  if (existsSync(reqTxt)) {
    console.log("");
    console.log("Installing Python dependencies...");
    const pipResult = spawnSync("pip3", ["install", "-r", reqTxt], {
      stdio: "inherit",
      cwd: INBOX_INSTALL_DIR,
    });
    if (pipResult.status !== 0) {
      console.warn("WARNING: pip3 install failed. Check Python 3 and try manually:");
      console.warn(`  pip3 install -r ${reqTxt}`);
    }
  }

  // Run setup wizard
  console.log("");
  console.log("Running setup wizard...");
  const setupScript = join(binDir, "setup.mjs");
  if (existsSync(setupScript)) {
    const setupResult = spawnSync("node", [setupScript], { stdio: "inherit" });
    if (setupResult.status !== 0) {
      console.warn("WARNING: Setup wizard exited with errors.");
      console.warn(`Re-run manually: node ${setupScript}`);
    }
  } else {
    console.warn("WARNING: setup.mjs not found. Run setup manually.");
  }

  // Offer LaunchAgent (macOS only)
  if (platform() === "darwin") {
    console.log("");
    console.log("macOS detected. To auto-start ftm-inbox on login, run:");
    console.log(`  node ${join(binDir, "launchagent.mjs")}`);
  }

  console.log("");
  console.log("ftm-inbox installed.");
  console.log(`  Start:  ${join(binDir, "start.sh")}`);
  console.log(`  Stop:   ${join(binDir, "stop.sh")}`);
  console.log(`  Status: ${join(binDir, "status.sh")}`);
  console.log("");
  console.log("See docs/INBOX.md for full documentation.");
  console.log("Try: /ftm help");
}

main();
