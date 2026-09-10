#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const validator = path.join(here, 'contract.mjs');
const [command, storeArg, artifactArg, ownerArg] = process.argv.slice(2);

function fail(message, code = 2) {
  console.error(`LEASE=FAIL\nERROR=${message}`);
  process.exit(code);
}

function usage() {
  fail('usage: workspace-lease.mjs acquire|checkpoint <store.json> <contract.json> | release <store.json> <lease-id> <owner> | list <store.json>');
}

if (!command || !storeArg) usage();
const store = path.resolve(storeArg);
const lock = `${store}.lock`;

function readStore() {
  if (!fs.existsSync(store)) return { version: 1, leases: [] };
  const value = JSON.parse(fs.readFileSync(store, 'utf8'));
  if (value.version !== 1 || !Array.isArray(value.leases)) throw new Error(`${store} is not a workspace lease store`);
  return value;
}

function writeStore(value) {
  fs.mkdirSync(path.dirname(store), { recursive: true });
  const temp = `${store}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, store);
}

function lockOwnerAlive() {
  try {
    const raw = fs.readFileSync(path.join(lock, 'pid'), 'utf8').trim();
    if (!/^\d+$/.test(raw)) return null;
    const pid = Number(raw);
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EINVAL') return null;
    if (error.code !== 'ESRCH') return true;
    return false;
  }
}

function withLock(action) {
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (lockOwnerAlive() !== false) fail(`lease store is locked by another process`, 3);
      const stale = `${lock}.stale.${process.pid}.${Date.now()}`;
      try {
        fs.renameSync(lock, stale);
      } catch (renameError) {
        if (renameError.code === 'ENOENT') continue;
        throw renameError;
      }
      fs.rmSync(stale, { recursive: true, force: true });
    }
  }
  fs.writeFileSync(path.join(lock, 'pid'), `${process.pid}\n`);
  try {
    return action();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

function runLocked(action) {
  try {
    return withLock(action);
  } catch (error) {
    fail(error.message, 3);
  }
}

function readContract(file) {
  if (!file) usage();
  const validation = spawnSync(validator, ['validate', file], { encoding: 'utf8' });
  if (validation.status !== 0) fail((validation.stderr || validation.stdout).trim() || 'contract validation failed');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function canonicalLease(contract) {
  const lease = contract.workspaceLease;
  return {
    id: lease.id,
    mode: lease.mode,
    path: lease.path ? path.resolve(lease.path) : '',
    owner: lease.owner,
    mutableOutputs: lease.mutableOutputs.map(output => path.resolve(lease.path, output)),
    activeProcess: lease.activeProcess,
    updatedAt: new Date().toISOString(),
  };
}

function overlaps(left, right) {
  if (!left || !right) return false;
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function leaseClaims(lease) {
  return [lease.path, ...lease.mutableOutputs].filter(Boolean);
}

function leasesConflict(left, right) {
  if (left.mode !== 'exclusive' && right.mode !== 'exclusive') return false;
  return leaseClaims(left).some(leftClaim =>
    leaseClaims(right).some(rightClaim => overlaps(leftClaim, rightClaim)));
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

if (command === 'list') {
  try {
    process.stdout.write(`${JSON.stringify(readStore(), null, 2)}\n`);
  } catch (error) {
    fail(error.message);
  }
  process.exit(0);
}

if (command === 'acquire') {
  const contract = readContract(artifactArg);
  if (contract.kind !== 'handoff') fail('acquire requires a handoff contract');
  const requested = canonicalLease(contract);
  if (requested.mode === 'none') {
    console.log(`LEASE=PASS\nID=${requested.id}\nMODE=none`);
    process.exit(0);
  }
  runLocked(() => {
    const state = readStore();
    if (state.leases.some(lease => lease.id === requested.id)) throw new Error(`lease id ${requested.id} is already active`);
    const conflict = state.leases.find(lease => leasesConflict(lease, requested));
    if (conflict) throw new Error(`workspace conflicts with active lease ${conflict.id} owned by ${conflict.owner}`);
    state.leases.push(requested);
    writeStore(state);
  });
  console.log(`LEASE=PASS\nID=${requested.id}\nMODE=${requested.mode}`);
  process.exit(0);
}

if (command === 'checkpoint') {
  const contract = readContract(artifactArg);
  if (contract.kind !== 'checkpoint') fail('checkpoint requires a checkpoint contract');
  const updated = canonicalLease(contract);
  runLocked(() => {
    const state = readStore();
    const index = state.leases.findIndex(lease => lease.id === updated.id && lease.owner === updated.owner);
    if (index < 0) throw new Error(`active lease ${updated.id} owned by ${updated.owner} was not found`);
    const current = state.leases[index];
    if (current.mode !== updated.mode || current.path !== updated.path ||
        JSON.stringify(current.mutableOutputs) !== JSON.stringify(updated.mutableOutputs)) {
      throw new Error('checkpoint cannot change the active lease boundary');
    }
    if (current.activeProcess !== null && processAlive(current.activeProcess.pid) &&
        JSON.stringify(current.activeProcess) !== JSON.stringify(updated.activeProcess)) {
      throw new Error(`checkpoint cannot replace or clear live process ${current.activeProcess.pid}`);
    }
    state.leases[index] = updated;
    writeStore(state);
  });
  console.log(`LEASE=PASS\nID=${updated.id}\nCHECKPOINT=recorded`);
  process.exit(0);
}

if (command === 'release') {
  const leaseId = artifactArg;
  const owner = ownerArg;
  if (!leaseId || !owner) usage();
  runLocked(() => {
    const state = readStore();
    const index = state.leases.findIndex(lease => lease.id === leaseId && lease.owner === owner);
    if (index < 0) throw new Error(`active lease ${leaseId} owned by ${owner} was not found`);
    if (state.leases[index].activeProcess !== null) throw new Error(`lease ${leaseId} still owns an active process`);
    state.leases.splice(index, 1);
    writeStore(state);
  });
  console.log(`LEASE=PASS\nID=${leaseId}\nRELEASED=true`);
  process.exit(0);
}

usage();
