#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [settingsArgument, extra] = process.argv.slice(2);
if (!settingsArgument || extra) {
  console.error('usage: configure-statusline.mjs <claude-settings.json>');
  process.exit(2);
}

const settingsPath = path.resolve(settingsArgument);
const statuslinePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'quota-statusline.mjs');
let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (error) {
  console.error(`STATUSLINE_CONFIG=FAIL\nERROR=${error.message}`);
  process.exit(1);
}

const backupPath = `${settingsPath}.pre-quota-statusline`;
if (!fs.existsSync(backupPath)) fs.copyFileSync(settingsPath, backupPath);

settings.statusLine = {
  type: 'command',
  command: statuslinePath,
  padding: 0,
  refreshInterval: 10,
};

const temporaryPath = `${settingsPath}.tmp.${process.pid}`;
const mode = fs.statSync(settingsPath).mode & 0o777;
fs.writeFileSync(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, { mode });
fs.renameSync(temporaryPath, settingsPath);

console.log('STATUSLINE_CONFIG=PASS');
console.log(`SETTINGS=${settingsPath}`);
console.log(`COMMAND=${statuslinePath}`);
console.log(`BACKUP=${backupPath}`);
