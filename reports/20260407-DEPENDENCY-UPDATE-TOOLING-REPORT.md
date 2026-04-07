# Dependency Update Tooling — Decision Report

**Date:** 2026-04-07  
**Goal:** Automated dependency updates with ≤1 PR per ~2 months, CLI-callable, integrated with custom vendor script

## Project Specifics

| Ecosystem | File | Update mechanism |
|---|---|---|
| JS vendor deps | `deps.json` → `vendor-deps.mjs` | Custom script fetches from CDN, checks age, vendors files |
| npm devDependencies | `package.json` | Standard `npm update` |
| Rust | `src-tauri/Cargo.toml` | Standard `cargo update` |

The JS vendor deps use a custom system (`deps.json` + `vendor-deps.mjs`) that already has a built-in 7-day cooldown (`minimumAgeDays: 7`). Standard tools (Renovate/Dependabot) don't understand this format.

## Options Considered

### 1. GitHub Dependabot

**Pros:** Zero setup (just a YAML file), native GitHub integration, Cargo.toml + package.json support  
**Cons:** Cannot handle custom `deps.json`; creates many individual PRs (one per dep); no CLI mode; grouping is limited; no way to run `vendor-deps.mjs`

### 2. Renovate (Mend)

**Pros:** Highly configurable grouping, scheduling, and automerge; supports Cargo.toml + package.json; can group all updates into a single PR; custom managers via regex  
**Cons:** Complex config; runs as a GitHub App (not easily CLI); custom manager for `deps.json` is fragile; still can't run the vendor script in-PR

### 3. Custom GitHub Actions workflow (chosen ✅)

**Pros:**
- Single unified workflow handles all three ecosystems
- Calls `vendor-deps.mjs` directly for JS vendor deps
- Enforces a **uniform 7-day cooldown** across all ecosystems via dedicated scripts
- Creates exactly one PR with all changes
- Runs on a cron schedule (every 2 months) AND manually via `workflow_dispatch`
- Full control over commit message, PR title, labels
- No external service dependency

**Cons:** More initial setup than Dependabot YAML; must maintain the workflow

### 4. Dependabot + custom workflow hybrid

Use Dependabot for Cargo.toml/package.json and a separate workflow for `deps.json`. **Rejected** because it would create multiple PRs and adds complexity for a small project.

## Decision

**Custom GitHub Actions workflow** — a single `.github/workflows/deps-update.yml` that:

1. Runs every 2 months on cron OR manually via `workflow_dispatch`
2. Runs `node scripts/vendor-deps.mjs update` (JS vendor deps with built-in 7-day cooldown)
3. Runs `scripts/cargo-cooldown-update.sh` (Rust deps with 7-day publish-age cooldown)
4. Runs `scripts/npm-cooldown-update.sh` (npm devDependencies with 7-day publish-age cooldown)
5. If any files changed, creates a single PR titled `chore(deps): update all dependencies`
6. Labels the PR with `dependencies`

Additionally, a `just deps-update` task is provided for local CLI usage.

## Scheduling

- **Cron:** `0 8 1 */2 *` — 8:00 UTC on the 1st of every other month (Jan, Mar, May, Jul, Sep, Nov)
- **Manual:** `workflow_dispatch` button in GitHub Actions UI
- **Local CLI:** `just deps-update` runs all three update steps locally

## Cooldown Principle

**Never adopt a dependency version published less than 7 days ago.** This is enforced uniformly across all three ecosystems:

| Ecosystem | Mechanism | Script |
|---|---|---|
| JS vendor deps | `minimumAgeDays: 7` in `deps.json` | `vendor-deps.mjs` |
| Rust crates | `cargo update` → query crates.io publish dates → `cargo update --precise` to revert too-fresh versions | `scripts/cargo-cooldown-update.sh` |
| npm devDeps | `npm update` → query registry publish dates → `npm install pkg@oldVer` to revert too-fresh versions | `scripts/npm-cooldown-update.sh` |

The bi-monthly cron provides the macro scheduling (at most 6 PRs/year). The 7-day cooldown ensures each adopted version has had time for community testing regardless of when the workflow runs.

### Note on cargo-cooldown crate

The [`cargo-cooldown`](https://github.com/dertin/cargo-cooldown) crate exists and provides a more sophisticated approach (full dependency graph analysis, semver-aware downgrades). However, as of 2026-04-07, it exhibited infinite loop issues during testing. The custom script approach is used for now; revisit `cargo-cooldown` when it stabilizes.
