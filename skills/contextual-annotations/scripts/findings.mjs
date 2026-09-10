import fs from "node:fs";

const severities = new Set(["P0", "P1", "P2", "P3"]);
const statuses = new Set(["open", "changed", "resolved"]);
const placements = new Set(["top-right", "top-left", "edge-right", "edge-left"]);

export function loadFindings(path) {
  const parsed = JSON.parse(fs.readFileSync(path, "utf8"));
  const findings = Array.isArray(parsed) ? parsed : parsed?.findings;
  if (!Array.isArray(findings)) throw new Error("Expected a findings array or { findings: [...] }");
  return findings;
}

export function validateFindings(findings) {
  const errors = [];
  const ids = new Set();
  const numbers = new Set();

  findings.forEach((finding, index) => {
    const at = `findings[${index}]`;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      errors.push(`${at}: expected an object`);
      return;
    }
    for (const field of ["id", "severity", "title", "body"]) {
      if (typeof finding[field] !== "string" || finding[field].trim() === "") {
        errors.push(`${at}.${field}: expected a non-empty string`);
      }
    }
    if (typeof finding.id === "string") {
      if (ids.has(finding.id)) errors.push(`${at}.id: duplicate ${finding.id}`);
      ids.add(finding.id);
    }
    if (typeof finding.severity === "string" && !severities.has(finding.severity)) {
      errors.push(`${at}.severity: expected P0, P1, P2, or P3`);
    }
    if (finding.status !== undefined && !statuses.has(finding.status)) {
      errors.push(`${at}.status: expected open, changed, or resolved`);
    }
    if (finding.number !== undefined) {
      if (!Number.isInteger(finding.number) || finding.number < 1) {
        errors.push(`${at}.number: expected a positive integer`);
      } else if (numbers.has(finding.number)) {
        errors.push(`${at}.number: duplicate ${finding.number}`);
      }
      numbers.add(finding.number);
    }
    if (!finding.anchor || typeof finding.anchor !== "object" || Array.isArray(finding.anchor)) {
      errors.push(`${at}.anchor: expected an object`);
    } else {
      if (typeof finding.anchor.selector !== "string" || finding.anchor.selector.trim() === "") {
        errors.push(`${at}.anchor.selector: expected a non-empty CSS selector`);
      }
      if (finding.anchor.contextSelector !== undefined &&
          (typeof finding.anchor.contextSelector !== "string" || finding.anchor.contextSelector.trim() === "")) {
        errors.push(`${at}.anchor.contextSelector: expected a non-empty CSS selector`);
      }
      if (finding.anchor.contextHeading !== undefined &&
          (typeof finding.anchor.contextHeading !== "string" || finding.anchor.contextHeading.trim() === "")) {
        errors.push(`${at}.anchor.contextHeading: expected a non-empty string`);
      }
      if (finding.anchor.placement !== undefined && !placements.has(finding.anchor.placement)) {
        errors.push(`${at}.anchor.placement: expected ${[...placements].join(", ")}`);
      }
    }
    if (finding.evidence !== undefined && typeof finding.evidence !== "string") {
      errors.push(`${at}.evidence: expected a string`);
    }
  });

  return errors;
}

export function normalizedFindings(findings) {
  return findings.map((finding, index) => ({
    ...finding,
    number: finding.number ?? index + 1,
    status: finding.status ?? "open",
    anchor: {
      placement: "edge-right",
      ...finding.anchor
    }
  }));
}
