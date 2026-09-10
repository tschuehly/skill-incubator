#!/usr/bin/env node
import { loadFindings, normalizedFindings, validateFindings } from "./findings.mjs";

const path = process.argv[2];
if (!path) {
  console.error("usage: build-mount.mjs <findings.json>");
  process.exit(1);
}

try {
  const findings = loadFindings(path);
  const errors = validateFindings(findings);
  if (errors.length > 0) {
    errors.forEach((error) => console.error(error));
    process.exit(2);
  }
  const payload = JSON.stringify(normalizedFindings(findings))
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
  process.stdout.write(`window.contextualAnnotations.mount(${payload})\n`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
