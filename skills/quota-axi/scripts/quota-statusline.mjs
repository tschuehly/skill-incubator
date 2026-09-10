#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
let quotaOnly = false;
let inputPath = '';
while (args.length) {
  const arg = args.shift();
  if (arg === '--quota-only') quotaOnly = true;
  else if (arg === '--input') inputPath = args.shift() || '';
  else {
    console.error('usage: quota-statusline.mjs [--quota-only] [--input <quota.json>]');
    process.exit(2);
  }
}

const cacheTtlMs = Number(process.env.QUOTA_AXI_STATUS_TTL_MS || 60_000);
const cachePath = process.env.QUOTA_AXI_STATUS_CACHE || path.join(
  os.tmpdir(),
  `quota-axi-status-${typeof process.getuid === 'function' ? process.getuid() : 'user'}.json`,
);

function parseQuota(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.providers) ? parsed : null;
  } catch {
    return null;
  }
}

function readCache(requireFresh) {
  try {
    const stat = fs.statSync(cachePath);
    if (requireFresh && Date.now() - stat.mtimeMs > cacheTtlMs) return null;
    return parseQuota(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function fetchQuota() {
  const cached = readCache(true);
  if (cached) return cached;

  const result = spawnSync('quota-axi', ['--json'], {
    encoding: 'utf8',
    timeout: 4_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  const parsed = result.status === 0 ? parseQuota(result.stdout) : null;
  if (!parsed) return readCache(false);

  try {
    const temporary = `${cachePath}.${process.pid}`;
    fs.writeFileSync(temporary, result.stdout, { mode: 0o600 });
    fs.renameSync(temporary, cachePath);
  } catch {
    // Rendering succeeds even when the cache is unavailable.
  }
  return parsed;
}

function findProvider(data, family) {
  return (data?.providers || []).find(candidate => {
    const identity = `${candidate.provider || ''} ${candidate.id || ''} ${candidate.label || ''}`.toLowerCase();
    return family === 'claude' ? /claude|anthropic/.test(identity) : /codex|openai|chatgpt/.test(identity);
  });
}

function remainingPercent(window) {
  const remaining = Number(window.percentRemaining);
  if (Number.isFinite(remaining)) return remaining;
  const used = Number(window.percentUsed);
  return Number.isFinite(used) ? 100 - used : null;
}

function windowCode(window) {
  const identity = `${window.id || ''} ${window.label || ''}`.toLowerCase();
  if (window.kind === 'model') {
    if (/fable/.test(identity)) return 'F';
    return null;
  }
  if (Number(window.windowSeconds) >= 6 * 24 * 60 * 60 || window.kind === 'weekly') return 'W';
  if (window.kind === 'session') return 'S';
  return 'G';
}

function formatPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatProvider(data, family, label) {
  const provider = findProvider(data, family);
  if (!provider) return `${label} ?`;
  const values = (provider.windows || [])
    .map(window => ({ code: windowCode(window), remaining: remainingPercent(window) }))
    .filter(window => window.code && window.remaining !== null)
    .map(window => `${window.code}${formatPercent(window.remaining)}%`);
  const stale = provider.state?.stale || provider.state?.status === 'stale';
  return values.length ? `${label}${stale ? '⚠' : ''} ${values.join(' ')}` : `${label} ?`;
}

function formatQuota(data) {
  return [
    formatProvider(data, 'claude', 'Claude'),
    formatProvider(data, 'codex', 'Codex'),
  ].join(' | ');
}

const quota = inputPath
  ? parseQuota(fs.readFileSync(inputPath, 'utf8'))
  : fetchQuota();
const quotaText = formatQuota(quota);

if (quotaOnly) {
  console.log(quotaText);
  process.exit(0);
}

const statusInput = fs.readFileSync(0, 'utf8');
const baseResult = spawnSync(process.env.CCSTATUSLINE_COMMAND || 'ccstatusline', [], {
  input: statusInput,
  encoding: 'utf8',
  timeout: 2_000,
  maxBuffer: 2 * 1024 * 1024,
});
const base = baseResult.status === 0 ? baseResult.stdout.trim() : '';
console.log(base ? `${base} | ${quotaText}` : quotaText);
