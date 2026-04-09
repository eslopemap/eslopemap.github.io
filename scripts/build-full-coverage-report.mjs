#!/usr/bin/env node

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAstAsync } from 'vite';
import { convert } from 'ast-v8-to-istanbul';
import istanbulCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const { createCoverageMap } = istanbulCoverage;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const coverageRoot = path.join(repoRoot, 'coverage');
const e2eV8Dir = path.join(coverageRoot, 'e2e-v8');
const vitestJsonPath = path.join(coverageRoot, 'coverage-final.json');
const mergedJsonPath = path.join(coverageRoot, 'full-js-coverage.json');
const mergedLcovDir = path.join(coverageRoot, 'full-js-lcov-report');
const mergedLcovPath = path.join(coverageRoot, 'full-js.lcov');
const reportPath = path.join(coverageRoot, 'full-coverage-report.md');
const rustLcovPath = path.join(coverageRoot, 'rust-lcov.info');
const tauriSummaryPath = path.join(coverageRoot, 'tauri-e2e-summary.json');

function summarizeFileCoverage(summaryData) {
  const total = summaryData.lines;
  const covered = total.count - total.skipped - total.pct * 0 + Math.round((total.pct / 100) * total.count) - Math.round((total.pct / 100) * total.count);
  return {
    total: total.total,
    covered: total.covered,
    pct: total.pct,
  };
}

function computeSummary(coverageMap) {
  let totalLines = 0;
  let coveredLines = 0;
  let totalStatements = 0;
  let coveredStatements = 0;
  let totalBranches = 0;
  let coveredBranches = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  const files = [];

  for (const filePath of coverageMap.files().sort()) {
    const summary = coverageMap.fileCoverageFor(filePath).toSummary();
    const relPath = path.relative(repoRoot, filePath);
    const linePct = summary.lines.pct ?? 0;
    files.push({
      file: relPath,
      lines: { total: summary.lines.total, covered: summary.lines.covered, pct: linePct },
      statements: { total: summary.statements.total, covered: summary.statements.covered, pct: summary.statements.pct ?? 0 },
      functions: { total: summary.functions.total, covered: summary.functions.covered, pct: summary.functions.pct ?? 0 },
      branches: { total: summary.branches.total, covered: summary.branches.covered, pct: summary.branches.pct ?? 0 },
    });
    totalLines += summary.lines.total;
    coveredLines += summary.lines.covered;
    totalStatements += summary.statements.total;
    coveredStatements += summary.statements.covered;
    totalBranches += summary.branches.total;
    coveredBranches += summary.branches.covered;
    totalFunctions += summary.functions.total;
    coveredFunctions += summary.functions.covered;
  }

  return {
    lines: { total: totalLines, covered: coveredLines, pct: totalLines ? coveredLines / totalLines * 100 : 0 },
    statements: { total: totalStatements, covered: coveredStatements, pct: totalStatements ? coveredStatements / totalStatements * 100 : 0 },
    branches: { total: totalBranches, covered: coveredBranches, pct: totalBranches ? coveredBranches / totalBranches * 100 : 0 },
    functions: { total: totalFunctions, covered: coveredFunctions, pct: totalFunctions ? coveredFunctions / totalFunctions * 100 : 0 },
    files,
  };
}

async function loadJson(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function loadPlaywrightCoverageMap() {
  const mergedByUrl = new Map();
  let fileNames = [];
  try {
    fileNames = (await readdir(e2eV8Dir)).filter((fileName) => fileName.endsWith('.json')).sort();
  } catch {
    return createCoverageMap({});
  }

  for (const fileName of fileNames) {
    const entries = JSON.parse(await readFile(path.join(e2eV8Dir, fileName), 'utf8'));
    for (const entry of entries) {
      if (!entry?.url?.includes('/app/js/') || entry.url.includes('/vendor/')) continue;
      const existing = mergedByUrl.get(entry.url);
      if (!existing) {
        mergedByUrl.set(entry.url, {
          url: entry.url,
          source: entry.source,
          functions: [...(entry.functions ?? [])],
        });
        continue;
      }
      existing.functions.push(...(entry.functions ?? []));
    }
  }

  const coverageMap = createCoverageMap({});
  for (const entry of mergedByUrl.values()) {
    const relativeMatch = entry.url.match(/\/app\/js\/(.+)$/);
    if (!relativeMatch) continue;
    const absPath = path.join(repoRoot, 'app', 'js', relativeMatch[1]);
    const ast = parseAstAsync(entry.source);
    const converted = await convert({
      ast,
      code: entry.source,
      coverage: {
        url: `file://${absPath}`,
        functions: entry.functions,
      },
      wrapperLength: 0,
    });
    coverageMap.merge(converted);
  }
  return coverageMap;
}

function writeCoverageArtifacts(coverageMap) {
  const context = libReport.createContext({
    dir: mergedLcovDir,
    coverageMap,
    watermarks: libReport.getDefaultWatermarks(),
  });
  reports.create('html').execute(context);
  reports.create('lcovonly', { file: path.basename(mergedLcovPath), projectRoot: repoRoot }).execute(context);
}

function parseLcov(content) {
  const files = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('SF:')) {
      current = { file: line.slice(3), lineTotal: 0, lineHit: 0 };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('LF:')) current.lineTotal = Number(line.slice(3));
    if (line.startsWith('LH:')) current.lineHit = Number(line.slice(3));
    if (line === 'end_of_record') {
      files.push(current);
      current = null;
    }
  }
  const lineTotal = files.reduce((sum, file) => sum + file.lineTotal, 0);
  const lineHit = files.reduce((sum, file) => sum + file.lineHit, 0);
  return {
    files: files.map((file) => ({ ...file, relFile: path.relative(repoRoot, file.file) })).sort((a, b) => a.relFile.localeCompare(b.relFile)),
    lines: { total: lineTotal, covered: lineHit, pct: lineTotal ? lineHit / lineTotal * 100 : 0 },
  };
}

function findStrategicGaps(jsSummary, tauriSummary) {
  const importantJs = jsSummary.files
    .filter((entry) => /app\/js\/(main|ui|startup-state|custom-tile-sources|tauri-bridge|track-ops|io)\.js$/.test(entry.file))
    .sort((a, b) => a.lines.pct - b.lines.pct)
    .slice(0, 6)
    .map((entry) => `- \`${entry.file}\` — ${entry.lines.covered}/${entry.lines.total} lines (${entry.lines.pct.toFixed(1)}%)`);

  const gaps = [];
  if (importantJs.length) {
    gaps.push('### Frontend JS gaps', '', ...importantJs, '');
  }
  if (tauriSummary?.tauriCommands?.length) {
    const highValueDesktop = ['set_config_value', 'get_config_value', 'add_tile_source', 'remove_tile_source', 'scan_tile_folder', 'clear_tile_cache'];
    const missing = highValueDesktop.filter((command) => !tauriSummary.tauriCommands.includes(command));
    if (missing.length) {
      gaps.push('### Desktop behavioral gaps', '', ...missing.map((command) => `- \`${command}\` is not currently exercised by tauri-e2e`), '');
    }
  }
  return gaps;
}

async function main() {
  await mkdir(coverageRoot, { recursive: true });
  const vitestData = await loadJson(vitestJsonPath, {});
  const vitestMap = createCoverageMap(vitestData ?? {});
  const playwrightMap = await loadPlaywrightCoverageMap();
  const mergedMap = createCoverageMap({});
  mergedMap.merge(vitestMap);
  mergedMap.merge(playwrightMap);

  const mergedJson = mergedMap.toJSON();
  await writeFile(mergedJsonPath, JSON.stringify(mergedJson, null, 2) + '\n');
  writeCoverageArtifacts(mergedMap);

  const jsSummary = computeSummary(mergedMap);
  const rustSummary = parseLcov(await readFile(rustLcovPath, 'utf8'));
  const tauriSummary = await loadJson(tauriSummaryPath, null);

  const reportLines = [
    '# Full Coverage Report',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- JS coverage sources merged: Vitest unit + Playwright e2e`,
    `- Additional suites included: Rust unit coverage + Tauri WebDriver e2e behavioral coverage`,
    '',
    '## Consolidated Summary',
    '',
    '| Suite | Kind | Lines covered | Coverage | Artifact |',
    '|---|---|---:|---:|---|',
    `| Frontend JS (Vitest + Playwright) | Line coverage | ${jsSummary.lines.covered}/${jsSummary.lines.total} | ${jsSummary.lines.pct.toFixed(1)}% | \`coverage/full-js.lcov\`, \`coverage/full-js-lcov-report/index.html\` |`,
    `| Rust backend (cargo llvm-cov) | Line coverage | ${rustSummary.lines.covered}/${rustSummary.lines.total} | ${rustSummary.lines.pct.toFixed(1)}% | \`coverage/rust-lcov.info\` |`,
    `| Tauri WebDriver e2e | Behavioral desktop coverage | ${tauriSummary?.totalTests ?? 0} tests | ${tauriSummary?.status === 'passed' ? 'pass' : tauriSummary?.status ?? 'n/a'} | \`coverage/tauri-e2e-summary.md\` |`,
    '',
    '## Frontend JS Top Covered Files',
    '',
    '| File | Lines | Coverage |',
    '|---|---:|---:|',
    ...jsSummary.files
      .filter((entry) => entry.lines.total > 0)
      .sort((a, b) => b.lines.pct - a.lines.pct)
      .slice(0, 10)
      .map((entry) => `| \`${entry.file}\` | ${entry.lines.covered}/${entry.lines.total} | ${entry.lines.pct.toFixed(1)}% |`),
    '',
    '## Frontend JS Lowest Coverage Files',
    '',
    '| File | Lines | Coverage |',
    '|---|---:|---:|',
    ...jsSummary.files
      .filter((entry) => entry.lines.total > 0)
      .sort((a, b) => a.lines.pct - b.lines.pct)
      .slice(0, 12)
      .map((entry) => `| \`${entry.file}\` | ${entry.lines.covered}/${entry.lines.total} | ${entry.lines.pct.toFixed(1)}% |`),
    '',
    '## Rust Backend Lowest Coverage Files',
    '',
    '| File | Lines | Coverage |',
    '|---|---:|---:|',
    ...rustSummary.files
      .filter((entry) => entry.lineTotal > 0)
      .sort((a, b) => (a.lineHit / a.lineTotal) - (b.lineHit / b.lineTotal))
      .slice(0, 10)
      .map((entry) => `| \`${entry.relFile}\` | ${entry.lineHit}/${entry.lineTotal} | ${(entry.lineTotal ? entry.lineHit / entry.lineTotal * 100 : 0).toFixed(1)}% |`),
    '',
    '## Tauri WebDriver E2E Inventory',
    '',
    `- Spec files: ${tauriSummary?.totalFiles ?? 0}`,
    `- Tests: ${tauriSummary?.totalTests ?? 0}`,
    `- Covered commands: ${(tauriSummary?.tauriCommands ?? []).map((command) => `\`${command}\``).join(', ') || 'n/a'}`,
    '',
    '## Strategic Coverage Gaps',
    '',
    ...findStrategicGaps(jsSummary, tauriSummary),
  ];

  await writeFile(reportPath, reportLines.join('\n') + '\n');
  console.log(`Wrote: ${path.relative(repoRoot, mergedJsonPath)}`);
  console.log(`Wrote: ${path.relative(repoRoot, mergedLcovPath)}`);
  console.log(`Wrote: ${path.relative(repoRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
