#!/usr/bin/env node

/**
 * npx feed-the-machine — installs ftm skills into ~/.claude/skills/
 *
 * Works by finding the npm package root (where the skill files live)
 * and symlinking them into the Claude Code skills directory.
 */

import { existsSync, mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, copyFileSync, symlinkSync, unlinkSync } from "fs";
import { join, basename, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_DIR = dirname(__dirname); // package root (one level up from bin/)
const HOME = homedir();
const SKILLS_DIR = join(HOME, ".claude", "skills");
const STATE_DIR = join(HOME, ".claude", "ftm-state");
const CONFIG_DIR = join(HOME, ".claude");

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

  console.log("");
  console.log(`Done. ${ymlFiles.length} skills linked.`);
  console.log("Try: /ftm help");
}

main();
