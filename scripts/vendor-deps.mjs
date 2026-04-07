#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const appRoot = path.join(repoRoot, 'app');
const vendorRoot = path.join(appRoot, 'vendor');
const manifestPath = path.join(repoRoot, 'deps.json');
const lockPath = path.join(vendorRoot, 'deps.lock.json');
const importMapAppPath = path.join(vendorRoot, 'importmap.app.generated.json');
const importMapDocsPath = path.join(vendorRoot, 'importmap.docs.generated.json');
const importMapAppScriptPath = path.join(vendorRoot, 'importmap.app.generated.js');
const importMapDocsScriptPath = path.join(vendorRoot, 'importmap.docs.generated.js');
const indexHtmlPath = path.join(appRoot, 'index.html');

async function readJson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch file from ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function isStableVersion(version) {
  return !version.includes('-');
}

function parseVersion(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function normalizeRange(range) {
  return range.trim();
}

function isExactVersionRange(rawRange) {
  const range = normalizeRange(rawRange);
  return Boolean(range) && !range.startsWith('^') && !range.startsWith('~') && range !== '*';
}

function versionSatisfies(version, rawRange) {
  const range = normalizeRange(rawRange);
  if (!range || range === '*') return true;
  if (range.startsWith('^')) {
    const base = range.slice(1);
    const [major, minor = 0, patch = 0] = parseVersion(base);
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    if (vMajor !== major) return false;
    if (vMinor < minor) return false;
    if (vMinor === minor && vPatch < patch) return false;
    return true;
  }
  if (range.startsWith('~')) {
    const base = range.slice(1);
    const [major, minor = 0, patch = 0] = parseVersion(base);
    const [vMajor, vMinor = 0, vPatch = 0] = parseVersion(version);
    if (vMajor !== major || vMinor !== minor) return false;
    return vPatch >= patch;
  }
  return version === range;
}

function toPackageDirectory(packageName, version) {
  return path.join(vendorRoot, packageName, version);
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('base64');
}

async function ensureDirectory(directoryPath) {
  await mkdir(directoryPath, { recursive: true });
}

async function getEligibleVersion(pkg, minimumAgeDays, registryBaseUrl) {
  const packageUrl = `${registryBaseUrl}/${encodeURIComponent(pkg.name)}`;
  const metadata = await fetchJson(packageUrl);
  const cutoff = Date.now() - minimumAgeDays * 24 * 60 * 60 * 1000;
  const exactVersion = isExactVersionRange(pkg.range) ? normalizeRange(pkg.range) : null;
  if (exactVersion) {
    if (!metadata.versions?.[exactVersion]) {
      throw new Error(`Pinned version ${exactVersion} not found for ${pkg.name}`);
    }
    return {
      version: exactVersion,
      publishedAt: metadata.time?.[exactVersion] || null
    };
  }
  const versions = Object.keys(metadata.versions || {})
    .filter((version) => isStableVersion(version) && versionSatisfies(version, pkg.range))
    .filter((version) => {
      const published = metadata.time?.[version];
      return published && new Date(published).getTime() <= cutoff;
    })
    .sort(compareVersions);
  const selectedVersion = versions.at(-1);
  if (!selectedVersion) {
    throw new Error(`No eligible stable version found for ${pkg.name} with range ${pkg.range}`);
  }
  return {
    version: selectedVersion,
    publishedAt: metadata.time[selectedVersion]
  };
}

async function listDirectoryFilesFromJsDelivr(pkgName, version, directory) {
  const url = `https://data.jsdelivr.com/v1/package/npm/${encodeURIComponent(pkgName)}@${version}/flat`;
  const payload = await fetchJson(url);
  const prefix = `/${directory.replace(/^\//, '').replace(/\/$/, '')}/`;
  return (payload.files || [])
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(1));
}

async function collectFiles(pkg, version) {
  const fileSet = new Set(pkg.files || []);
  for (const directory of pkg.directories || []) {
    const files = await listDirectoryFilesFromJsDelivr(pkg.name, version, directory);
    for (const file of files) {
      fileSet.add(file);
    }
  }
  return Array.from(fileSet).sort();
}

async function downloadPackageFiles(pkg, version, files, cdnBaseUrl) {
  const packageDirectory = toPackageDirectory(pkg.name, version);
  await rm(packageDirectory, { recursive: true, force: true });
  await ensureDirectory(packageDirectory);

  const downloadedFiles = [];
  for (const relativeFile of files) {
    const fileUrl = `${cdnBaseUrl}/${pkg.name}@${version}/${relativeFile}`;
    const targetPath = path.join(packageDirectory, relativeFile);
    await ensureDirectory(path.dirname(targetPath));
    const buffer = await fetchBuffer(fileUrl);
    await writeFile(targetPath, buffer);
    downloadedFiles.push({
      path: relativeFile,
      size: buffer.byteLength,
      integrity: `sha256-${sha256(buffer)}`,
      sourceUrl: fileUrl
    });
  }

  return downloadedFiles;
}

function buildImportMaps(packages) {
  const appImports = {};
  const docsImports = {};

  for (const pkg of packages) {
    const scopes = pkg.importMap || {};
    for (const [specifier, relativeFile] of Object.entries(scopes.app || {})) {
      appImports[specifier] = `./vendor/${toPosixPath(path.join(pkg.name, pkg.version, relativeFile))}`;
    }
    for (const [specifier, relativeFile] of Object.entries(scopes.docs || {})) {
      docsImports[specifier] = `../vendor/${toPosixPath(path.join(pkg.name, pkg.version, relativeFile))}`;
    }
  }

  return {
    app: { imports: appImports },
    docs: { imports: docsImports }
  };
}

function formatImportMapImports(imports) {
  const entries = Object.entries(imports);
  if (entries.length === 0) {
    return '{\n  "imports": {}\n}';
  }

  const formattedEntries = entries.map(([specifier, target]) => `    ${JSON.stringify(specifier)}: ${JSON.stringify(target)}`);
  return [
    '{',
    '  "imports": {',
    formattedEntries.join(',\n\n'),
    '  }',
    '}'
  ].join('\n');
}

function buildImportMapBootstrap(importMap) {
  const formattedImportMap = formatImportMapImports(importMap.imports || {});
  return [
    '(function () {',
    `  const importMap = ${formattedImportMap.replace(/\n/g, '\n  ')};`,
    '  const script = document.createElement(\'script\');',
    '  script.type = \'importmap\';',
    '  script.textContent = JSON.stringify(importMap, null, 2);',
    '  const currentScript = document.currentScript;',
    '  if (currentScript && currentScript.parentNode) {',
    '    currentScript.parentNode.insertBefore(script, currentScript.nextSibling);',
    '  } else {',
    '    document.head.appendChild(script);',
    '  }',
    '})();',
    ''
  ].join('\n');
}

async function patchInlineImportMap(importMap) {
  const html = await readFile(indexHtmlPath, 'utf8');
  const inlineJson = JSON.stringify(importMap, null, 4);
  const replacement = `<script type="importmap">\n  ${inlineJson.replace(/\n/g, '\n  ')}\n  </script>`;
  const patched = html.replace(
    /<script type="importmap">[\s\S]*?<\/script>/,
    replacement
  );
  if (patched === html) {
    console.warn('Warning: could not find inline import map in index.html to patch');
    return false;
  }
  await writeFile(indexHtmlPath, patched, 'utf8');
  return true;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runCheck(manifest) {
  if (!(await fileExists(lockPath))) {
    throw new Error('Missing vendor/deps.lock.json. Run vendor:update first.');
  }
  const lock = await readJson(lockPath);
  const missingFiles = [];
  for (const pkg of lock.packages || []) {
    for (const file of pkg.files || []) {
      const targetPath = path.join(vendorRoot, pkg.name, pkg.version, file.path);
      if (!(await fileExists(targetPath))) {
        missingFiles.push(targetPath);
      }
    }
  }
  if (missingFiles.length > 0) {
    throw new Error(`Missing vendored files:\n${missingFiles.join('\n')}`);
  }
  console.log(`Checked ${manifest.packages.length} package definitions and ${lock.packages.length} locked packages.`);
}

async function runUpdate(manifest) {
  await ensureDirectory(vendorRoot);

  const resolvedPackages = [];
  for (const pkg of manifest.packages) {
    const resolved = await getEligibleVersion(pkg, manifest.minimumAgeDays, manifest.registryBaseUrl);
    const files = await collectFiles(pkg, resolved.version);
    const downloadedFiles = await downloadPackageFiles(pkg, resolved.version, files, manifest.cdnBaseUrl);
    resolvedPackages.push({
      name: pkg.name,
      range: pkg.range,
      version: resolved.version,
      publishedAt: resolved.publishedAt,
      files: downloadedFiles,
      importMap: pkg.importMap || {}
    });
  }

  const importMaps = buildImportMaps(resolvedPackages);
  const lock = {
    generatedAt: new Date().toISOString(),
    minimumAgeDays: manifest.minimumAgeDays,
    packages: resolvedPackages
  };

  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await writeFile(importMapAppPath, `${JSON.stringify(importMaps.app, null, 2)}\n`, 'utf8');
  await writeFile(importMapDocsPath, `${JSON.stringify(importMaps.docs, null, 2)}\n`, 'utf8');
  await writeFile(importMapAppScriptPath, buildImportMapBootstrap(importMaps.app), 'utf8');
  await writeFile(importMapDocsScriptPath, buildImportMapBootstrap(importMaps.docs), 'utf8');
  if (await patchInlineImportMap(importMaps.app)) {
    console.log(`Patched inline import map in ${path.relative(repoRoot, indexHtmlPath)}.`);
  }

  console.log(`Vendored ${resolvedPackages.length} packages.`);
  console.log(`Wrote ${path.relative(repoRoot, lockPath)}.`);
  console.log(`Wrote ${path.relative(repoRoot, importMapAppPath)}.`);
  console.log(`Wrote ${path.relative(repoRoot, importMapDocsPath)}.`);
  console.log(`Wrote ${path.relative(repoRoot, importMapAppScriptPath)}.`);
  console.log(`Wrote ${path.relative(repoRoot, importMapDocsScriptPath)}.`);
}

async function main() {
  const manifest = await readJson(manifestPath);
  const mode = process.argv[2] || 'update';
  if (mode === 'check') {
    await runCheck(manifest);
    return;
  }
  if (mode === 'update') {
    await runUpdate(manifest);
    return;
  }
  throw new Error(`Unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
