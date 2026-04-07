#!/usr/bin/env node
// Merge V8 coverage JSONs from Playwright e2e tests into a summary report.
// Usage: node scripts/merge-e2e-coverage.mjs
//
// Reads:  coverage/e2e-v8/cov-*.json  (raw V8 JS coverage from Playwright)
// Writes: coverage/e2e-summary.txt    (human-readable summary)
//
// V8 coverage records ranges of bytecode that were executed. We use the
// source text to count total lines and compare against covered byte ranges
// to produce a line coverage percentage per file.

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const covDir = path.join(repoRoot, 'coverage', 'e2e-v8');
const outPath = path.join(repoRoot, 'coverage', 'e2e-summary.txt');

function urlToLocalPath(url) {
  const match = url.match(/\/app\/js\/(.+)$/);
  if (!match) return null;
  return path.join(repoRoot, 'app', 'js', match[1]);
}

// Given source text and V8 function coverage, compute line-level coverage.
// V8 ranges are nested: a function's outer range has count>0 if called, but
// inner ranges with count=0 mark uncovered branches/blocks. The *last* range
// that covers a byte offset wins (most specific).
function computeLineCoverage(sourceText, functions) {
  const lines = sourceText.split('\n');

  // Build byte-offset→line lookup
  const lineStarts = [0];
  for (let i = 0; i < sourceText.length; i++) {
    if (sourceText[i] === '\n') lineStarts.push(i + 1);
  }
  function offsetToLine(offset) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Flatten all ranges, then resolve per-byte using "most specific wins"
  // (smallest range containing that byte). Build per-line max-count.
  const allRanges = [];
  for (const fn of functions) {
    for (const range of fn.ranges) {
      allRanges.push(range);
    }
  }
  // Sort: larger ranges first, then by start offset
  allRanges.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset) || a.startOffset - b.startOffset);

  // For each line, find the most-specific range covering its start byte
  const lineHits = new Array(lines.length).fill(-1); // -1 = no code range covers this
  for (const range of allRanges) {
    const startLine = offsetToLine(range.startOffset);
    const endLine = offsetToLine(Math.max(range.startOffset, range.endOffset - 1));
    for (let l = startLine; l <= endLine; l++) {
      // Most-specific = smallest range. Since we sorted largest first,
      // later (smaller) ranges overwrite earlier (larger) ones.
      lineHits[l] = range.count;
    }
  }

  let total = 0, covered = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '' || lines[i].trim().startsWith('//')) continue;
    if (lineHits[i] < 0) continue; // not inside any function
    total++;
    if (lineHits[i] > 0) covered++;
  }
  return { total, covered, pct: total > 0 ? (covered / total * 100) : 0 };
}

async function main() {
  let files;
  try { files = (await readdir(covDir)).filter(f => f.endsWith('.json')); }
  catch { console.log('No e2e coverage data in coverage/e2e-v8/'); return; }
  if (!files.length) { console.log('No e2e coverage files'); return; }

  // Merge by URL, concatenating function ranges
  const merged = new Map();
  for (const file of files) {
    const entries = JSON.parse(await readFile(path.join(covDir, file), 'utf8'));
    for (const entry of entries) {
      const lp = urlToLocalPath(entry.url);
      if (!lp) continue;
      if (!merged.has(lp)) {
        merged.set(lp, { source: entry.source, functions: [...entry.functions] });
      } else {
        merged.get(lp).functions.push(...entry.functions);
      }
    }
  }

  // Compute and print summary
  const rows = [];
  let totalAll = 0, coveredAll = 0;
  for (const [filePath, data] of [...merged.entries()].sort()) {
    const { total, covered, pct } = computeLineCoverage(data.source, data.functions);
    const name = path.relative(path.join(repoRoot, 'app', 'js'), filePath);
    rows.push({ name, total, covered, pct });
    totalAll += total;
    coveredAll += covered;
  }

  const header = `E2E JS Coverage (${files.length} test runs, ${merged.size} files)\n${'='.repeat(60)}`;
  const table = rows.map(r =>
    `${r.name.padEnd(25)} ${String(r.covered).padStart(4)}/${String(r.total).padStart(4)} lines  ${r.pct.toFixed(1).padStart(5)}%`
  ).join('\n');
  const footer = `${'─'.repeat(60)}\n${'TOTAL'.padEnd(25)} ${String(coveredAll).padStart(4)}/${String(totalAll).padStart(4)} lines  ${(coveredAll / totalAll * 100).toFixed(1).padStart(5)}%`;

  const report = [header, table, footer].join('\n');
  console.log(report);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, report + '\n');
  console.log(`\nWrote: ${path.relative(repoRoot, outPath)}`);
}

main().catch(err => { console.error(err); process.exitCode = 1; });
