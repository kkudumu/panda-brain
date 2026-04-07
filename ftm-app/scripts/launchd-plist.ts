#!/usr/bin/env node
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const home = homedir();
const plistDir = join(home, 'Library', 'LaunchAgents');
const plistPath = join(plistDir, 'com.ftm.daemon.plist');

// Find the ftm binary
let ftmBin: string;
try {
  ftmBin = execSync('which ftm', { encoding: 'utf-8' }).trim();
} catch {
  ftmBin = join(home, '.npm-global', 'bin', 'ftm');
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ftm.daemon</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ftmBin}</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${home}/.ftm/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>${home}/.ftm/daemon.err</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${home}/.npm-global/bin</string>
  </dict>
</dict>
</plist>`;

if (!existsSync(plistDir)) mkdirSync(plistDir, { recursive: true });
writeFileSync(plistPath, plist, 'utf-8');

console.log(`LaunchAgent installed: ${plistPath}`);
console.log('Load now: launchctl load ' + plistPath);
console.log('Unload:   launchctl unload ' + plistPath);
