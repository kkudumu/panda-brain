#!/usr/bin/env node

/**
 * npx feed-the-machine — installs ftm skills into ~/.claude/skills/
 *
 * Full install: skills, hooks, settings.json merge, and verification.
 * Safe to re-run — idempotent.
 *
 * Flags:
 *   --only skill1,skill2  Install specific skills (always includes ftm + ftm-config)
 *   --list                List available skills with descriptions
 *   --with-inbox          Also install the inbox service
 *   --no-hooks            Skip hooks entirely
 *   --with-hooks          Include hooks even with --only
 *   --skip-merge          Install hook files but don't touch settings.json
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
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");
const INBOX_INSTALL_DIR = join(HOME, ".claude", "ftm-inbox");

const ARGS = process.argv.slice(2);
const WITH_INBOX = ARGS.includes("--with-inbox");
const SKIP_MERGE = ARGS.includes("--skip-merge");
const LIST_MODE = ARGS.includes("--list");
const WITH_HOOKS_FLAG = ARGS.includes("--with-hooks");

// Parse --only (supports --only=x,y and --only x,y)
const ONLY_RAW = ARGS.find(a => a.startsWith("--only="))?.split("=")[1]
  || (ARGS.includes("--only") ? ARGS[ARGS.indexOf("--only") + 1] : null);

const ONLY_SKILLS = ONLY_RAW
  ? new Set(["ftm", "ftm-config", ...ONLY_RAW.split(",").map(s => s.trim())])
  : null;

// When --only is used, skip hooks unless --with-hooks or explicit --no-hooks
const NO_HOOKS = ARGS.includes("--no-hooks") || (ONLY_SKILLS && !WITH_HOOKS_FLAG);

function skillWanted(name) {
  if (!ONLY_SKILLS) return true;
  return ONLY_SKILLS.has(name);
}

let warnCount = 0;

function log(msg) {
  console.log(`  ${msg}`);
}

function warn(msg) {
  console.log(`  WARN: ${msg}`);
  warnCount++;
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

function commandExists(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function commandVersion(cmd, flag = "--version") {
  try {
    return execSync(`${cmd} ${flag}`, { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return "unknown";
  }
}

// --- Preflight ---

function preflight() {
  console.log("Preflight checks...");

  if (!NO_HOOKS) {
    // jq is required for all shell hooks (they parse JSON stdin via jq)
    if (!commandExists("jq")) {
      console.log("");
      console.log("  ERROR: jq is required for FTM hooks.");
      console.log("");
      console.log("  Install it:");
      console.log("    macOS:   brew install jq");
      console.log("    Ubuntu:  sudo apt-get install jq");
      console.log("    Alpine:  apk add jq");
      console.log("");
      console.log("  Or skip hooks: npx feed-the-machine --no-hooks");
      process.exit(1);
    }
    log(`jq: ${commandVersion("jq")}`);
    log(`node: ${process.version}`);
  } else {
    log("hooks skipped (--no-hooks)");
  }

  console.log("");
}

// --- Settings Merge ---

function mergeHooksIntoSettings() {
  const templatePath = join(REPO_DIR, "hooks", "settings-template.json");
  if (!existsSync(templatePath)) {
    warn("hooks/settings-template.json not found — hooks installed but not registered");
    return;
  }

  console.log("");
  console.log("Registering hooks in settings.json...");

  // Read and expand ~ to actual home directory
  const rawTemplate = readFileSync(templatePath, "utf8");
  const expandedTemplate = rawTemplate.replace(/~\/.claude/g, join(HOME, ".claude"));
  const template = JSON.parse(expandedTemplate);
  const templateHooks = template.hooks || {};

  if (!existsSync(SETTINGS_FILE)) {
    // No settings.json — create one with just the hooks
    writeFileSync(SETTINGS_FILE, JSON.stringify({ hooks: templateHooks }, null, 2) + "\n");
    log("CREATED settings.json with FTM hooks");
    return;
  }

  // Read existing settings
  const existing = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));

  // Backup
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = `${SETTINGS_FILE}.ftm-backup-${ts}`;
  copyFileSync(SETTINGS_FILE, backupPath);
  log(`BACKUP ${backupPath}`);

  // Ensure hooks key exists
  if (!existing.hooks) {
    existing.hooks = {};
  }

  // Merge each event type
  const events = ["PreToolUse", "UserPromptSubmit", "PostToolUse", "Stop"];
  for (const event of events) {
    const templateEntries = templateHooks[event] || [];
    const existingEntries = existing.hooks[event] || [];

    if (templateEntries.length === 0) continue;

    // Check if FTM hooks are already present by looking for ftm- in command paths
    const existingCommands = JSON.stringify(existingEntries);
    const alreadyPresent = templateEntries.some((entry) => {
      const hooks = entry.hooks || [];
      return hooks.some((h) => {
        const cmd = h.command || "";
        const cmdBase = basename(cmd.split(" ").pop()); // handle "node foo.mjs"
        return existingCommands.includes(cmdBase);
      });
    });

    if (alreadyPresent) {
      log(`SKIP ${event} hooks (already configured)`);
      continue;
    }

    existing.hooks[event] = [...existingEntries, ...templateEntries];
    log(`MERGE ${event} hooks`);
  }

  writeFileSync(SETTINGS_FILE, JSON.stringify(existing, null, 2) + "\n");
  log("UPDATED settings.json");
  console.log("");
  log("Hooks are active.");
}

// --- Verification ---

function verify(skillCount, hookCount) {
  console.log("");
  console.log("Verifying installation...");

  let errors = 0;

  // Check skill symlinks resolve
  let brokenLinks = 0;
  const skillEntries = readdirSync(SKILLS_DIR).filter((f) => f.startsWith("ftm"));
  for (const entry of skillEntries) {
    const fullPath = join(SKILLS_DIR, entry);
    try {
      if (lstatSync(fullPath).isSymbolicLink() && !existsSync(fullPath)) {
        warn(`broken symlink: ${entry}`);
        brokenLinks++;
      }
    } catch {
      // ignore
    }
  }
  if (brokenLinks === 0) {
    log(`Skills: ${skillCount} linked, all symlinks valid`);
  } else {
    errors++;
  }

  // Check blackboard state
  const contextFile = join(STATE_DIR, "blackboard", "context.json");
  const patternsFile = join(STATE_DIR, "blackboard", "patterns.json");
  if (existsSync(contextFile) && existsSync(patternsFile)) {
    log("Blackboard: initialized");
  } else {
    warn("blackboard state incomplete");
    errors++;
  }

  // Check config
  if (existsSync(join(CONFIG_DIR, "ftm-config.yml"))) {
    log("Config: present");
  } else {
    warn("ftm-config.yml missing");
    errors++;
  }

  // Check hooks
  if (!NO_HOOKS && hookCount > 0) {
    const hookFiles = readdirSync(HOOKS_DIR).filter((f) => f.startsWith("ftm-"));
    const allExecutable = hookFiles
      .filter((f) => f.endsWith(".sh"))
      .every((f) => {
        try {
          const stat = lstatSync(join(HOOKS_DIR, f));
          return (stat.mode & 0o111) !== 0;
        } catch {
          return false;
        }
      });

    if (allExecutable) {
      log(`Hooks: ${hookCount} installed, all executable`);
    } else {
      warn("some hook files not executable");
      errors++;
    }

    // Verify settings.json has FTM hooks
    if (!SKIP_MERGE && existsSync(SETTINGS_FILE)) {
      const settingsContent = readFileSync(SETTINGS_FILE, "utf8");
      const ftmMatches = (settingsContent.match(/ftm-/g) || []).length;
      if (ftmMatches > 0) {
        log(`Settings: ${ftmMatches} FTM entries in settings.json`);
      } else {
        warn("no FTM hooks found in settings.json");
        errors++;
      }
    }
  }

  return { errors };
}

// --- List Mode ---

function listSkills() {
  console.log("\nAvailable FTM skills:\n");
  const ymlFiles = readdirSync(REPO_DIR).filter(
    (f) => f.startsWith("ftm-") && f.endsWith(".yml") && !f.includes("config.default")
  );
  for (const yml of ymlFiles) {
    const name = yml.replace(".yml", "");
    const content = readFileSync(join(REPO_DIR, yml), "utf8");
    const descMatch = content.match(/^description:\s*(.+)/m);
    const desc = descMatch ? descMatch[1].slice(0, 80) : "";
    console.log(`  ${name.padEnd(22)} ${desc}`);
  }
  console.log("\nInstall specific skills: npx feed-the-machine --only ftm-council-chat,ftm-mind");
  console.log("Install everything:      npx feed-the-machine\n");
  process.exit(0);
}

// --- Main ---

function main() {
  if (LIST_MODE) {
    listSkills();
  }

  preflight();

  if (ONLY_SKILLS) {
    const requested = [...ONLY_SKILLS].filter(s => s !== "ftm" && s !== "ftm-config").join(", ");
    console.log(`Installing selected FTM skills: ${requested} (+ ftm, ftm-config)`);
  } else {
    console.log(`Installing all FTM skills from: ${REPO_DIR}`);
  }
  console.log(`Linking into: ${SKILLS_DIR}`);
  console.log("");

  ensureDir(SKILLS_DIR);

  // Link ftm*.yml files (filtered by --only if set)
  const ymlFiles = readdirSync(REPO_DIR).filter(
    (f) => f.startsWith("ftm") && f.endsWith(".yml") && !f.includes("config.default")
  ).filter((f) => skillWanted(f.replace(".yml", "")));
  for (const yml of ymlFiles) {
    safeSymlink(join(REPO_DIR, yml), join(SKILLS_DIR, yml));
  }

  // Link ftm* directories (filtered by --only if set)
  const dirs = readdirSync(REPO_DIR).filter((f) => {
    if (!f.startsWith("ftm")) return false;
    if (f === "ftm-state") return false;
    if (!skillWanted(f)) return false;
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

  console.log("");
  log(`${ymlFiles.length} skills linked.`);

  // Set up blackboard state (copy templates, don't overwrite existing data)
  const bbDir = join(REPO_DIR, "ftm-state", "blackboard");
  if (existsSync(bbDir)) {
    console.log("");
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
  let hookCount = 0;

  if (NO_HOOKS) {
    console.log("");
    console.log("Skipping hooks (--no-hooks).");
  } else {
    const hooksDir = join(REPO_DIR, "hooks");
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

      console.log("");
      log(`${hookCount} hooks installed to ${HOOKS_DIR}`);
    }

    // Merge hooks into settings.json
    if (SKIP_MERGE) {
      console.log("");
      log("Skipping settings.json merge (--skip-merge).");
      log("Add entries from hooks/settings-template.json to ~/.claude/settings.json manually.");
    } else {
      mergeHooksIntoSettings();
    }
  }

  // Verification
  const { errors } = verify(ymlFiles.length, hookCount);

  // Summary
  console.log("");
  if (errors === 0 && warnCount === 0) {
    console.log(`Done. ${ymlFiles.length} skills, ${hookCount} hooks. Everything checks out.`);
  } else {
    console.log(`Done. ${ymlFiles.length} skills, ${hookCount} hooks. ${warnCount} warning(s).`);
  }
  console.log("");
  console.log("Restart Claude Code (or start a new session) to pick up the skills.");

  if (WITH_INBOX) {
    console.log("");
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
