#!/usr/bin/env bash
# npm-cooldown-update.sh — update npm devDependencies with a minimum-age cooldown.
#
# Principle: only adopt versions published ≥ COOLDOWN_DAYS ago.
#
# How it works:
#   1. Snapshot current package-lock.json
#   2. `npm update`
#   3. For each changed package, query npm registry for publish date
#   4. If too fresh, revert by installing the old version explicitly
#
# Usage: COOLDOWN_DAYS=7 ./scripts/npm-cooldown-update.sh

set -euo pipefail

COOLDOWN_DAYS="${COOLDOWN_DAYS:-7}"

if [ ! -f "package-lock.json" ]; then
  echo "[npm-cooldown] package-lock.json not found"
  exit 1
fi

# Snapshot versions before update
node -e '
  const lock = require("./package-lock.json");
  const pkgs = lock.packages || {};
  const out = {};
  for (const [k, v] of Object.entries(pkgs)) {
    if (k && k.startsWith("node_modules/")) {
      const name = k.replace("node_modules/", "");
      out[name] = v.version;
    }
  }
  process.stdout.write(JSON.stringify(out));
' > /tmp/npm_before.json

# Run the update
echo "[npm-cooldown] running npm update (cooldown=${COOLDOWN_DAYS}d)..."
npm update 2>&1

# Snapshot versions after update
node -e '
  const lock = require("./package-lock.json");
  const pkgs = lock.packages || {};
  const out = {};
  for (const [k, v] of Object.entries(pkgs)) {
    if (k && k.startsWith("node_modules/")) {
      const name = k.replace("node_modules/", "");
      out[name] = v.version;
    }
  }
  process.stdout.write(JSON.stringify(out));
' > /tmp/npm_after.json

# Find changes and check cooldown
node -e '
  const before = require("/tmp/npm_before.json");
  const after = require("/tmp/npm_after.json");
  const changed = [];
  for (const [name, newVer] of Object.entries(after)) {
    const oldVer = before[name];
    if (oldVer && oldVer !== newVer) {
      changed.push({ name, oldVer, newVer });
    }
  }
  process.stdout.write(JSON.stringify(changed));
' > /tmp/npm_changed.json

COOLDOWN_DAYS="$COOLDOWN_DAYS" node -e '
  const https = require("https");
  const changed = require("/tmp/npm_changed.json");
  const cooldown = parseInt(process.env.COOLDOWN_DAYS || "7", 10);
  const now = Date.now();

  function fetchPublishDate(name, version) {
    return new Promise((resolve, reject) => {
      const url = `https://registry.npmjs.org/${name}/${version}`;
      https.get(url, { headers: { "User-Agent": "slope-dep-updater" } }, res => {
        let data = "";
        res.on("data", d => data += d);
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.publish_time ? new Date(json.publish_time) : null);
          } catch { resolve(null); }
        });
      }).on("error", reject);
    });
  }

  (async () => {
    const toRevert = [];
    for (const { name, oldVer, newVer } of changed) {
      const pubDate = await fetchPublishDate(name, newVer);
      if (!pubDate) {
        console.log(`[npm-cooldown] ${name} ${newVer} — could not fetch publish date, keeping`);
        continue;
      }
      const ageDays = Math.floor((now - pubDate.getTime()) / 86400000);
      if (ageDays < cooldown) {
        console.log(`[npm-cooldown] ${name} ${newVer} published ${ageDays}d ago (< ${cooldown}d) — reverting to ${oldVer}`);
        toRevert.push(`${name}@${oldVer}`);
      } else {
        console.log(`[npm-cooldown] ${name} ${newVer} published ${ageDays}d ago — OK`);
      }
    }
    if (toRevert.length > 0) {
      console.log(`[npm-cooldown] reverting ${toRevert.length} package(s)...`);
      process.stdout.write("REVERT:" + toRevert.join(" ") + "\n");
    } else {
      console.log("[npm-cooldown] all updates within cooldown. done.");
    }
  })();
' | while IFS= read -r line; do
  if [[ "$line" == REVERT:* ]]; then
    pkgs="${line#REVERT:}"
    npm install $pkgs 2>&1
  else
    echo "$line"
  fi
done

echo "[npm-cooldown] done."
