#!/usr/bin/env node
import { writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

const home = homedir();
const serviceDir = join(home, '.config', 'systemd', 'user');
const servicePath = join(serviceDir, 'ftm-daemon.service');

let ftmBin: string;
try {
  ftmBin = execSync('which ftm', { encoding: 'utf-8' }).trim();
} catch {
  ftmBin = join(home, '.npm-global', 'bin', 'ftm');
}

const service = `[Unit]
Description=Feed The Machine Daemon
After=network.target

[Service]
Type=simple
ExecStart=${ftmBin} daemon
Restart=on-failure
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin:${home}/.npm-global/bin
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;

const { mkdirSync, existsSync } = require('fs');
if (!existsSync(serviceDir)) mkdirSync(serviceDir, { recursive: true });
writeFileSync(servicePath, service, 'utf-8');

console.log(`Systemd service installed: ${servicePath}`);
console.log('Enable: systemctl --user enable ftm-daemon');
console.log('Start:  systemctl --user start ftm-daemon');
console.log('Status: systemctl --user status ftm-daemon');
