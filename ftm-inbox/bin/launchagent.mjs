#!/usr/bin/env node

/**
 * Generates ~/Library/LaunchAgents/com.ftm.inbox.plist
 * Runs ftm-inbox on login (macOS only).
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir, platform } from "os";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const HOME = homedir();
const LAUNCH_AGENTS_DIR = join(HOME, "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, "com.ftm.inbox.plist");
const INBOX_CONFIG_DIR = join(HOME, ".claude", "ftm-inbox");
const START_SCRIPT = join(__dirname, "start.sh");

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function buildPlist(startScript, logDir) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ftm.inbox</string>

    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>${startScript}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <false/>

    <key>StandardOutPath</key>
    <string>${join(logDir, "launchd-stdout.log")}</string>

    <key>StandardErrorPath</key>
    <string>${join(logDir, "launchd-stderr.log")}</string>

    <key>WorkingDirectory</key>
    <string>${dirname(dirname(startScript))}</string>
</dict>
</plist>
`;
}

function main() {
  if (platform() !== "darwin") {
    console.error("LaunchAgent setup is macOS-only.");
    process.exit(1);
  }

  const logDir = join(INBOX_CONFIG_DIR, "logs");

  ensureDir(LAUNCH_AGENTS_DIR);
  ensureDir(logDir);

  const plistContent = buildPlist(START_SCRIPT, logDir);
  writeFileSync(PLIST_PATH, plistContent, "utf8");

  console.log("LaunchAgent written to:", PLIST_PATH);
  console.log("Logs will be written to:", logDir);

  // Load it immediately
  try {
    execSync(`launchctl load "${PLIST_PATH}"`, { stdio: "inherit" });
    console.log("LaunchAgent loaded. ftm-inbox will start on next login.");
    console.log("To start it now: launchctl start com.ftm.inbox");
  } catch (err) {
    console.warn("Could not load LaunchAgent automatically:", err.message);
    console.warn("Run manually: launchctl load", PLIST_PATH);
  }
}

main();
