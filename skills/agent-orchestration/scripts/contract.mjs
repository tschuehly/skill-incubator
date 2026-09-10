#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const templates = {
  handoff: {
    version: 2,
    kind: 'handoff',
    role: 'bounded-role',
    lifecycle: {
      mode: 'persistent',
      key: 'stable-role-instance-key',
      artifactRevision: null,
    },
    modelBinding: {
      cognitiveRole: 'replace-with-routed-role',
      provider: 'replace-with-routed-provider',
      model: 'replace-with-routed-model',
      effort: 'replace-with-routed-effort',
      quotaSnapshot: {
        generatedAt: 'raw quota generatedAt timestamp',
        relevantWindows: ['provider/window: percent remaining; reset timestamp'],
        stale: false,
        refreshedAt: null,
        error: null,
      },
    },
    purpose: 'one outcome this collaborator owns',
    anchors: ['stable concept or artifact key'],
    actions: ['required action'],
    evidence: ['path or source anchor'],
    constraints: [],
    completion: ['observable definition of done'],
    workspaceLease: {
      id: 'stable-lease-id',
      mode: 'shared-read',
      path: 'task-local workspace path',
      owner: 'bounded-role',
      mutableOutputs: [],
      activeProcess: null,
    },
  },
  checkpoint: {
    version: 2,
    kind: 'checkpoint',
    role: 'bounded-role',
    lifecycle: {
      mode: 'persistent',
      key: 'stable-role-instance-key',
      artifactRevision: null,
    },
    modelBinding: {
      cognitiveRole: 'replace-with-routed-role',
      provider: 'replace-with-routed-provider',
      model: 'replace-with-routed-model',
      effort: 'replace-with-routed-effort',
      quotaSnapshot: {
        generatedAt: 'raw quota generatedAt timestamp',
        relevantWindows: ['provider/window: percent remaining; reset timestamp'],
        stale: false,
        refreshedAt: null,
        error: null,
      },
    },
    artifactPaths: ['durable artifact path'],
    cursor: 0,
    revision: 'stable revision or digest',
    openWork: [],
    decisions: [],
    evidence: [],
    nextAction: 'one concrete next action',
    workspaceLease: {
      id: 'stable-lease-id',
      mode: 'shared-read',
      path: 'task-local workspace path',
      owner: 'bounded-role',
      mutableOutputs: [],
      activeProcess: null,
    },
  },
};

function usage() {
  console.error('usage: contract.mjs template handoff|checkpoint | validate <file>');
  process.exit(2);
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function validateString(value, path, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(`${path} must be a non-empty string`);
}

function validateArray(value, path, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  if (nonEmpty && value.length === 0) errors.push(`${path} must contain at least one entry`);
  value.forEach((entry, index) => validateString(entry, `${path}[${index}]`, errors));
}

function validateLifecycle(value, errors) {
  if (!isObject(value)) {
    errors.push('lifecycle must be an object');
    return;
  }
  if (!['persistent', 'fresh-per-artifact', 'disposable'].includes(value.mode)) {
    errors.push('lifecycle.mode must be persistent, fresh-per-artifact, or disposable');
  }
  validateString(value.key, 'lifecycle.key', errors);
  if (value.mode === 'fresh-per-artifact') {
    validateString(value.artifactRevision, 'lifecycle.artifactRevision', errors);
  } else if (value.artifactRevision !== null) {
    errors.push('lifecycle.artifactRevision must be null unless lifecycle.mode is fresh-per-artifact');
  }
}

function validateModelBinding(value, errors) {
  if (!isObject(value)) {
    errors.push('modelBinding must be an object');
    return;
  }
  validateString(value.cognitiveRole, 'modelBinding.cognitiveRole', errors);
  validateString(value.provider, 'modelBinding.provider', errors);
  validateString(value.model, 'modelBinding.model', errors);
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value.effort)) {
    errors.push('modelBinding.effort must be none, low, medium, high, xhigh, or max');
  }
  if (!isObject(value.quotaSnapshot)) {
    errors.push('modelBinding.quotaSnapshot must be an object');
    return;
  }
  validateString(value.quotaSnapshot.generatedAt, 'modelBinding.quotaSnapshot.generatedAt', errors);
  validateArray(value.quotaSnapshot.relevantWindows, 'modelBinding.quotaSnapshot.relevantWindows', errors, { nonEmpty: true });
  if (typeof value.quotaSnapshot.stale !== 'boolean') {
    errors.push('modelBinding.quotaSnapshot.stale must be a boolean');
  }
  if (!Object.hasOwn(value.quotaSnapshot, 'refreshedAt')) {
    errors.push('modelBinding.quotaSnapshot.refreshedAt must be present');
  }
  if (!Object.hasOwn(value.quotaSnapshot, 'error')) {
    errors.push('modelBinding.quotaSnapshot.error must be present');
  }
  if (value.quotaSnapshot.stale === true) {
    validateString(value.quotaSnapshot.refreshedAt, 'modelBinding.quotaSnapshot.refreshedAt', errors);
    validateString(value.quotaSnapshot.error, 'modelBinding.quotaSnapshot.error', errors);
  } else {
    if (value.quotaSnapshot.refreshedAt !== null) {
      validateString(value.quotaSnapshot.refreshedAt, 'modelBinding.quotaSnapshot.refreshedAt', errors);
    }
    if (value.quotaSnapshot.error !== null) {
      errors.push('modelBinding.quotaSnapshot.error must be null when quota is fresh');
    }
  }
}

function validateWorkspaceLease(value, kind, role, errors) {
  if (!isObject(value)) {
    errors.push('workspaceLease must be an object');
    return;
  }
  validateString(value.id, 'workspaceLease.id', errors);
  if (!['none', 'shared-read', 'exclusive'].includes(value.mode)) {
    errors.push('workspaceLease.mode must be none, shared-read, or exclusive');
  }
  validateString(value.owner, 'workspaceLease.owner', errors);
  if (typeof role === 'string' && role.trim() && value.owner !== role) {
    errors.push('workspaceLease.owner must match role');
  }
  validateArray(value.mutableOutputs, 'workspaceLease.mutableOutputs', errors);
  if (Array.isArray(value.mutableOutputs)) {
    value.mutableOutputs.forEach((output, index) => {
      const normalized = typeof output === 'string' ? path.normalize(output) : '';
      if (typeof output === 'string' && !path.isAbsolute(output) &&
          (normalized === '..' || normalized.startsWith(`..${path.sep}`))) {
        errors.push(`workspaceLease.mutableOutputs[${index}] must be inside workspaceLease.path or an explicit absolute path`);
      }
    });
  }
  if (value.mode === 'none') {
    if (value.path !== '') errors.push('workspaceLease.path must be empty in none mode');
    if (Array.isArray(value.mutableOutputs) && value.mutableOutputs.length) errors.push('none leases cannot name mutable outputs');
    if (value.activeProcess !== null) errors.push('none leases cannot own an active process');
  }
  if (value.mode === 'shared-read') {
    validateString(value.path, 'workspaceLease.path', errors);
    if (Array.isArray(value.mutableOutputs) && value.mutableOutputs.length) errors.push('shared-read leases cannot name mutable outputs');
    if (value.activeProcess !== null) errors.push('shared-read leases cannot own an active process');
  }
  if (value.mode === 'exclusive') {
    validateString(value.path, 'workspaceLease.path', errors);
    if (Array.isArray(value.mutableOutputs) && value.mutableOutputs.length === 0) {
      errors.push('workspaceLease.mutableOutputs must name exclusive build or generated outputs');
    }
  }

  if (value.activeProcess !== null) {
    if (!isObject(value.activeProcess)) {
      errors.push('workspaceLease.activeProcess must be null or an object');
    } else {
      if (!Number.isInteger(value.activeProcess.pid) || value.activeProcess.pid <= 0) {
        errors.push('workspaceLease.activeProcess.pid must be a positive integer');
      }
      validateString(value.activeProcess.command, 'workspaceLease.activeProcess.command', errors);
      validateString(value.activeProcess.outputPath, 'workspaceLease.activeProcess.outputPath', errors);
      validateString(value.activeProcess.owner, 'workspaceLease.activeProcess.owner', errors);
      if (value.activeProcess.owner !== value.owner) {
        errors.push('workspaceLease.activeProcess.owner must match workspaceLease.owner');
      }
    }
  }
  if (kind === 'handoff' && value.activeProcess !== null) {
    errors.push('handoff workspaceLease.activeProcess must be null; checkpoint a running process before transfer');
  }
}

const [command, arg] = process.argv.slice(2);
if (command === 'template' && templates[arg]) {
  process.stdout.write(`${JSON.stringify(templates[arg], null, 2)}\n`);
  process.exit(0);
}
if (command !== 'validate' || !arg) usage();

let contract;
try {
  contract = JSON.parse(fs.readFileSync(arg, 'utf8'));
} catch (error) {
  console.error(`CONTRACT=FAIL\nERROR=${error.message}`);
  process.exit(1);
}

const errors = [];
if (!isObject(contract)) {
  console.error('CONTRACT=FAIL');
  console.error('FIX=contract must be a JSON object');
  process.exit(1);
}
if (contract.version !== 2) errors.push('version must be 2');
if (!templates[contract.kind]) errors.push('kind must be handoff or checkpoint');
validateString(contract.role, 'role', errors);
validateLifecycle(contract.lifecycle, errors);
validateModelBinding(contract.modelBinding, errors);
validateWorkspaceLease(contract.workspaceLease, contract.kind, contract.role, errors);

if (contract.kind === 'handoff') {
  validateString(contract.purpose, 'purpose', errors);
  validateArray(contract.anchors, 'anchors', errors, { nonEmpty: true });
  validateArray(contract.actions, 'actions', errors, { nonEmpty: true });
  validateArray(contract.evidence, 'evidence', errors, { nonEmpty: true });
  validateArray(contract.constraints, 'constraints', errors);
  validateArray(contract.completion, 'completion', errors, { nonEmpty: true });
}

if (contract.kind === 'checkpoint') {
  validateArray(contract.artifactPaths, 'artifactPaths', errors, { nonEmpty: true });
  if (!Object.hasOwn(contract, 'cursor') || !['string', 'number'].includes(typeof contract.cursor)) {
    errors.push('cursor must be present and be a string or number');
  }
  validateString(contract.revision, 'revision', errors);
  validateArray(contract.openWork, 'openWork', errors);
  validateArray(contract.decisions, 'decisions', errors);
  validateArray(contract.evidence, 'evidence', errors);
  validateString(contract.nextAction, 'nextAction', errors);
}

if (errors.length) {
  console.error('CONTRACT=FAIL');
  errors.forEach(error => console.error(`FIX=${error}`));
  process.exit(1);
}

console.log('CONTRACT=PASS');
console.log(`KIND=${contract.kind}`);
console.log(`ROLE=${contract.role}`);
console.log(`LIFECYCLE=${contract.lifecycle.mode}`);
console.log(`MODEL=${contract.modelBinding.model}`);
console.log(`EFFORT=${contract.modelBinding.effort}`);
console.log(`NEXT=${contract.kind === 'handoff' ? contract.actions[0] : contract.nextAction}`);
