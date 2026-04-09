# Slope Mapper — common dev tasks
# Requires: just (https://github.com/casey/just)

# Default: list available recipes
default:
    @just --list

# ── Web ─────────────────────────────────────────────────────────────

# Serve the web app locally (http://localhost:8089/app/)
serve:
    python3 -m http.server 8089

# Run JS unit tests (vitest)
test-unit:
    npm run test:unit

# Run JS unit tests in watch mode
test-unit-watch:
    npm run test:unit:watch

# Run Playwright E2E tests (headless)
test-e2e:
    npm test

# Run Playwright E2E tests (headed, visible browser)
test-e2e-headed:
    npm run test:headed

# Run E2E tests with JS coverage
test-e2e-coverage:
    npm run test:e2e:coverage

# ── Desktop (Tauri) ────────────────────────────────────────────────

# Build the Tauri desktop app (debug)
build:
    cd src-tauri && cargo build

# Run the Tauri desktop app in dev mode
dev:
    cargo tauri dev --features webdriver

# Build the Tauri desktop app with webdriver support
tauri-build-webdriver:
    cd src-tauri && cargo build --features webdriver

# Run Tauri WebDriver E2E tests
test-tauri-e2e: tauri-build-webdriver
    cd tests/tauri-e2e && npm test

# Run Rust unit tests
test-rust:
    cd src-tauri && cargo test

# Run Rust unit tests with coverage (requires cargo-llvm-cov)
test-rust-coverage:
    cd src-tauri && cargo llvm-cov --text

# ── All tests ──────────────────────────────────────────────────────

# Run all test suites (JS unit + Playwright E2E + Rust)
test-all:  test-rust test-unit test-tauri-e2e test-e2e

# ── Dependencies ───────────────────────────────────────────────────

# Update vendored JS dependencies (deps.json → vendor/)
vendor-update:
    node scripts/vendor-deps.mjs update

# Check vendored JS dependencies are up to date
vendor-check:
    node scripts/vendor-deps.mjs check

# Update all dependencies (JS vendor + Cargo + npm devDeps) with 7-day cooldown
deps-update: vendor-update
    bash scripts/cargo-cooldown-update.sh src-tauri
    bash scripts/npm-cooldown-update.sh

# Install all Node.js dependencies
npm-install:
    npm ci
    cd tests/tauri-e2e && npm install

# ── Utilities ──────────────────────────────────────────────────────

# Check Rust code compiles (fast feedback)
check:
    cd src-tauri && cargo check

# Run clippy with warnings denied
clippy:
    cd src-tauri && cargo clippy -- -D warnings

# Format Rust code
fmt:
    cd src-tauri && cargo fmt

# Clean Rust build artifacts
clean:
    cd src-tauri && cargo clean
