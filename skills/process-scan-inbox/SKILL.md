---
name: process-scan-inbox
description: Process newly scanned paper documents into verified OneDrive sources and knowledge updates.
disable-model-invocation: true
compatibility: macOS with the personal OneDrive document pipeline and its local Python environment.
---

# Process scan inbox

Turn scan batches into verified sources, useful knowledge, and surfaced actions. Preserve paper and immutable raw bytes.

## 1. Locate the workflow

Use the current or ancestor directory containing `NEXT_SESSION.md` and `Dokumente/SCANNEN.md` as `<root>`. Otherwise try `~/Library/CloudStorage/OneDrive-Personal`; stop if those files are absent.

Read completely:

- `<root>/NEXT_SESSION.md`;
- `<root>/Dokumente/SCANNEN.md`;
- `<root>/Dokumente/WIKI_SCHEMA.md`;
- `<root>/Dokumente/_agent/document_pipeline/README.md`;
- the nearest `AGENTS.md` for each destination later touched.

These files and the commands they name are the source of truth. Apply their ingest, error, privacy, citation, indexing, and contract rules in full instead of restating them here.

Complete when the inbox, calibrated profile, batch archive, local work directory, and current knowledge state are known.

## 2. Select and preserve batches

Read the production inbox path from `SCANNEN.md`. List PDFs directly under it; a filename in the invocation narrows the selection. Also list archive bundles lacking `disposition.json`, even when their original inbox file is absent.

Hash inbox PDFs and inspect their content-addressed archive directories. A valid disposition defined by the pipeline README is terminal and skipped unless the user explicitly requests correction. Every missing archive or archive without a disposition is new or resumable.

Run the existing `stage` command only on inbox inputs. Staging is idempotent; use its reported batch ID and local work directory. For an archive-only resumable batch, verify `raw.pdf.original` against the archived manifest, then byte-copy it to a missing local `raw.pdf`; do not stage the archive copy or rewrite archive metadata. Leave inbox files unchanged.

Prefer new batches, then resumable batches oldest first. Carry one batch through Steps 3–5 to a terminal disposition before starting the next. When no new or resumable batch exists, ask whether the human wants to scan one now. If not, report that no work is pending. If so, walk them through scanner-preparation instructions 1–5 under **Routine pro Batch** in `SCANNEN.md` instead of paraphrasing them. Ask whether every physical sheet is one-sided and ask for the sheet count. When every sheet is one-sided, use the routine's one-sided branch without requiring calibration. When any sheet has a used back or the human is unsure, do not sort by sidedness: use the documented two-pass branch for the whole stack, after completing the separate calibration procedure if the profile is pending. Wait for confirmation that scanning finished, then repeat discovery once. If no new inbox hash appears, report the production inbox path and stop for scanner-target troubleshooting instead of repeating the walkthrough.

Complete when every selected input is immutable and each batch is either selected for work or has a valid terminal disposition.

## 3. Establish capture mode

An ordinary duplex batch requires a verified calibrated profile. If the profile is pending, do not treat an ordinary document batch as calibration: guide and process the dedicated printed calibration sheets exactly as the canonical docs require, record `calibration` only for that calibration batch, then continue with the ordinary batch. When the invocation names calibration, verify that the selected input is the dedicated calibration scan before running it. One-sided ordinary batches do not require calibration.

Capture mode and physical sheet count are part of each ordinary batch contract. Invocation arguments such as `one-sided 3 sheets` or `duplex 12 sheets` are optional shortcuts and apply only when exactly one batch is selected.

On resume, reuse `passes` and `sheets` from a valid inspection sidecar. Otherwise show the selected filename and raw PDF page count, then ask once for confirmation of the missing capture mode and physical sheet count. Explain that the calibrated two-pass duplex routine is the safe choice for a mixed stack and that candidate blank backs will be proposed later for human approval. Inspect the scanner profile and raw page count automatically, but do not infer one-sided versus duplex solely from an odd/even page count or document content: that cannot distinguish blank backs from missing pages.

Resume from the first missing or invalid derived artifact. Reuse an existing artifact only when its manifest and input hashes verify. When the same immutable raw input must be deterministically re-derived, `--force` is allowed only for overwrite refusal; use a new, not-yet-created split output directory because split has no force mode. Never force a substantive guard, use `--allow-duplicate-warning`, or continue after an uncalibrated profile, duplicate-pass warning, stale inspection, invalid partition, or raw-input error.

A tool error or misstated mode/sheet count is resumable and never terminal. Record `incomplete` only after physical-paper confirmation that pages are missing. Record `rejected` only after verified raw-content evidence makes that scan unusable. Atomically record any verified `incomplete`, `calibration`, or `rejected` disposition defined by the pipeline README before stopping.

Complete when the ordered batch, physical-sheet count, and ordered-to-raw page mapping are verified, or a terminal non-processable disposition is recorded.

## 4. OCR and propose boundaries

OCR the ordered batch once with the existing local command. Use local OCR, page metrics, and visible sender, account, invoice, and page identifiers to assess completeness, order, duplicate sources, and likely boundaries.

When a conclusion genuinely requires visual interpretation, obtain the user's explicit approval to delegate the named pages, then use a background reviewer. Ask it to return only page numbers, orientation, clipping, legibility, blankness, page indicators, quality defects, and boundary candidates.

Apply the duplicate-source and naming rules from `SCANNEN.md`. Every retained document, including a duplicate, receives a confirmed page range so the split plan remains a complete partition. Mark the complete existing source identifier and path that a content duplicate matches; split mixed batches mechanically but do not file their duplicate outputs. After boundary confirmation, when every document in a batch duplicates complete existing sources, atomically record a `duplicate` disposition without creating new human-facing PDFs. For new sources, propose filenames and existing destination folders. Keep unresolved destinations explicit.

Send all proposed boundaries, blank removals, filenames, and unresolved destinations to the human in one message or form. Split only after the reply confirms every retained and removed page and resolves every destination. Until then leave the batch resumable without a terminal disposition.

Complete when confirmed ranges partition every retained page exactly, every removed blank is confirmed, and every document has an approved destination.

## 5. Split, integrate, verify

Reuse a verified existing split manifest or apply the confirmed plan to a new, not-yet-created split output directory. File each non-duplicate searchable PDF without changing its generated `doc-…` identity.

Resolve an existing destination path by comparing the split-manifest identifier with that file's XMP identifier. Equal identifiers mean this batch already placed the same source: continue the missing knowledge/index verification and finish as `filed`. Different identifiers mean a genuine filename collision: ask the human for a distinguishing destination filename. Never overwrite, silently rename, or infer content duplication from a path collision.

Apply every relevant Ingest step in `WIKI_SCHEMA.md` and every destination-specific rule, including all of their citation, index/log, and synchronized-state completion conditions. Evidence-only documents receive no speculative summary.

Then run the existing index rebuild and wiki lint. Verify:

- every filed PDF is structurally readable and searchable;
- the ordered-to-raw mapping and split manifest agree;
- each XMP `doc-…` identifier matches its split manifest;
- affected agent-state paths and hashes match current files;
- `TODO.md` satisfies the current-action and `todo-id` reconciliation rules in `WIKI_SCHEMA.md` for every deadline or urgent action affected by the ingest;
- lint has no new broken links, unindexed knowledge pages, malformed log entries, or read errors.

After every verification passes, atomically record a `filed` disposition with the generated identifiers and relative filed paths. For a mixed batch, its disposition reason also names every deliberately unfiled duplicate range and the matched existing source identifier and relative path. Replace `NEXT_SESSION.md` after a substantial ingest.

Complete only when source files, immutable batch evidence and terminal disposition, confirmed plan, knowledge pages, agent state, index, and lint agree.

## 6. Report

Lead with the outcome. List filed or deliberately skipped documents, urgent actions, and unresolved items. Keep the response short and point to paths for detail.
