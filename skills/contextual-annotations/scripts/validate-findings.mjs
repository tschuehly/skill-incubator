#!/usr/bin/env node
import { loadFindings, validateFindings } from "./findings.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: validate-findings.mjs <findings.json>");
  process.exit(1);
}

try {
  const findings = loadFindings(path);
  const errors = validateFindings(findings);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(error));
    process.exit(2);
  }
  console.log(`valid: ${findings.length} findings`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
