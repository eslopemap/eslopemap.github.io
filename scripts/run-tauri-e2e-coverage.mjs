#!/usr/bin/env node

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const suiteRoot = path.join(repoRoot, 'tests', 'tauri-e2e');
const specRoot = path.join(suiteRoot, 'tests');
const coverageRoot = path.join(repoRoot, 'coverage');
const summaryJsonPath = path.join(coverageRoot, 'tauri-e2e-summary.json');
const summaryMdPath = path.join(coverageRoot, 'tauri-e2e-summary.md');

async function listSpecFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listSpecFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.spec.mjs')) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function collectSpecSummary(sourceText) {
  const tests = [...sourceText.matchAll(/\bit\s*\(\s*(['"`])([\s\S]*?)\1\s*,/g)].map((match) => match[2]);
  const commands = [...sourceText.matchAll(/tauriInvoke\s*\(\s*browser\s*,\s*(['"`])([^'"`]+)\1/g)].map((match) => match[2]);
  const browserFetches = [...sourceText.matchAll(/fetch\(\s*`([^`]+)`|fetch\(\s*(['"])([^'"]+)\2/g)].map((match) => match[1] || match[3]).filter(Boolean);
  return {
    testCount: tests.length,
    tests,
    commands,
    browserFetches,
  };
}

async function buildInventory() {
  const specFiles = await listSpecFiles(specRoot);
  const files = [];
  const commandSet = new Set();
  const fetchSet = new Set();
  let totalTests = 0;

  for (const filePath of specFiles) {
    const sourceText = await readFile(filePath, 'utf8');
    const summary = collectSpecSummary(sourceText);
    totalTests += summary.testCount;
    summary.commands.forEach((command) => commandSet.add(command));
    summary.browserFetches.forEach((entry) => fetchSet.add(entry));
    files.push({
      file: path.relative(repoRoot, filePath),
      tests: summary.testCount,
      titles: summary.tests,
      tauriCommands: [...new Set(summary.commands)].sort(),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    suite: 'tauri-e2e',
    files,
    totalFiles: files.length,
    totalTests,
    tauriCommands: [...commandSet].sort(),
    browserFetches: [...fetchSet].sort(),
  };
}

async function runSuite() {
  await new Promise((resolve, reject) => {
    const child = spawn('npm', ['test'], {
      cwd: suiteRoot,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Tauri e2e suite failed with exit code ${code}`));
    });
  });
}

function renderMarkdown(summary, status) {
  const lines = [
    '# Tauri E2E Coverage Summary',
    '',
    `- Status: **${status}**`,
    `- Generated: ${summary.generatedAt}`,
    `- Spec files: ${summary.totalFiles}`,
    `- Tests: ${summary.totalTests}`,
    `- Covered Tauri commands: ${summary.tauriCommands.length}`,
    '',
    '## Spec Inventory',
    '',
    '| File | Tests | Tauri commands |',
    '|---|---:|---|',
    ...summary.files.map((entry) => `| \`${entry.file}\` | ${entry.tests} | ${entry.tauriCommands.length ? entry.tauriCommands.map((command) => `\`${command}\``).join(', ') : '—'} |`),
    '',
    '## Covered Tauri Commands',
    '',
    ...summary.tauriCommands.map((command) => `- \`${command}\``),
  ];

  if (summary.browserFetches.length) {
    lines.push('', '## Covered Desktop HTTP Flows', '', ...summary.browserFetches.map((entry) => `- \`${entry}\``));
  }

  lines.push('', '## Notes', '', '- This suite currently provides **behavioral desktop coverage** over the real Tauri/WKWebView runtime.', '- It is reported alongside JS line coverage and Rust line coverage in the consolidated full report.', '- WKWebView WebDriver does not currently expose a repo-native JS line coverage artifact comparable to Chromium V8 coverage.');
  return lines.join('\n') + '\n';
}

async function main() {
  await mkdir(coverageRoot, { recursive: true });
  let status = 'passed';
  try {
    await runSuite();
  } catch (error) {
    status = 'failed';
    const inventory = await buildInventory();
    const summary = { ...inventory, status, error: String(error.message || error) };
    await writeFile(summaryJsonPath, JSON.stringify(summary, null, 2) + '\n');
    await writeFile(summaryMdPath, renderMarkdown(summary, status));
    throw error;
  }

  const inventory = await buildInventory();
  const summary = { ...inventory, status };
  await writeFile(summaryJsonPath, JSON.stringify(summary, null, 2) + '\n');
  await writeFile(summaryMdPath, renderMarkdown(summary, status));
  console.log(`Wrote: ${path.relative(repoRoot, summaryJsonPath)}`);
  console.log(`Wrote: ${path.relative(repoRoot, summaryMdPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
