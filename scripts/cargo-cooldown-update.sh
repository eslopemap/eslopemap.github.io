#!/usr/bin/env bash
# cargo-cooldown-update.sh — update Cargo dependencies with a minimum-age cooldown.
#
# Principle: only adopt crate versions published ≥ COOLDOWN_DAYS ago.
# This mirrors the vendor-deps.mjs `minimumAgeDays` approach for JS deps.
#
# How it works:
#   1. `cargo update` to get the latest semver-compatible versions
#   2. For each changed crate in Cargo.lock, query crates.io for its publish date
#   3. If the version was published < COOLDOWN_DAYS ago, revert that specific update
#      using `cargo update --precise <old_version>`
#
# Usage: COOLDOWN_DAYS=7 ./scripts/cargo-cooldown-update.sh [cargo-dir]

set -euo pipefail

COOLDOWN_DAYS="${COOLDOWN_DAYS:-7}"
CARGO_DIR="${1:-src-tauri}"
LOCKFILE="$CARGO_DIR/Cargo.lock"

if [ ! -f "$LOCKFILE" ]; then
  echo "[cargo-cooldown] Cargo.lock not found at $LOCKFILE"
  exit 1
fi

# Snapshot the current lock state
cp "$LOCKFILE" /tmp/Cargo.lock.before

# Run the normal update
echo "[cargo-cooldown] running cargo update (cooldown=${COOLDOWN_DAYS}d)..."
(cd "$CARGO_DIR" && cargo update 2>&1)

# Diff the lockfile to find changed crates
# Format: "name old_version new_version"
changes=$(diff <(grep -E '^name|^version' /tmp/Cargo.lock.before) \
               <(grep -E '^name|^version' "$LOCKFILE") \
         2>/dev/null || true)

if [ -z "$changes" ]; then
  echo "[cargo-cooldown] no dependency changes"
  exit 0
fi

# Parse changed packages from the new lockfile vs old
# We compare [[package]] blocks. Simpler: just parse `cargo update` output.
# Actually, let's re-run with --verbose and parse, or diff the lock.
# Easiest: compare sorted "name = version" pairs.

extract_packages() {
  awk '/^\[\[package\]\]/{name="";ver=""} /^name = /{gsub(/"/, "", $3); name=$3} /^version = /{gsub(/"/, "", $3); ver=$3; if(name!="") print name, ver}' "$1" | sort
}

extract_packages /tmp/Cargo.lock.before > /tmp/cargo_before.txt
extract_packages "$LOCKFILE" > /tmp/cargo_after.txt

# Find packages that changed version
comm -13 /tmp/cargo_before.txt /tmp/cargo_after.txt > /tmp/cargo_new.txt
comm -23 /tmp/cargo_before.txt /tmp/cargo_after.txt > /tmp/cargo_old.txt

reverted=0
while IFS=' ' read -r crate new_ver; do
  # Check publish date via crates.io API
  api_url="https://crates.io/api/v1/crates/${crate}/${new_ver}"
  created_at=$(curl -sf -H "User-Agent: slope-dep-updater" "$api_url" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['version']['created_at'])" 2>/dev/null || echo "")

  if [ -z "$created_at" ]; then
    echo "[cargo-cooldown] $crate $new_ver — could not fetch publish date, keeping"
    continue
  fi

  # Compare dates
  pub_epoch=$(python3 -c "from datetime import datetime; print(int(datetime.fromisoformat('$created_at'.replace('Z','+00:00')).timestamp()))")
  now_epoch=$(date +%s)
  age_days=$(( (now_epoch - pub_epoch) / 86400 ))

  if [ "$age_days" -lt "$COOLDOWN_DAYS" ]; then
    # Find the old version to revert to
    old_ver=$(grep "^${crate} " /tmp/cargo_old.txt | head -1 | awk '{print $2}')
    if [ -n "$old_ver" ]; then
      echo "[cargo-cooldown] $crate $new_ver published ${age_days}d ago (< ${COOLDOWN_DAYS}d) — reverting to $old_ver"
      (cd "$CARGO_DIR" && cargo update "$crate@$new_ver" --precise "$old_ver" 2>&1)
      reverted=$((reverted + 1))
    else
      echo "[cargo-cooldown] $crate $new_ver published ${age_days}d ago (< ${COOLDOWN_DAYS}d) — no old version to revert to, keeping"
    fi
  else
    echo "[cargo-cooldown] $crate $new_ver published ${age_days}d ago — OK"
  fi
done < /tmp/cargo_new.txt

echo "[cargo-cooldown] done. $reverted update(s) reverted due to cooldown."
