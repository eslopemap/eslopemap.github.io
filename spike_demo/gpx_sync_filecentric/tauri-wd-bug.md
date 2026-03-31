# Bug: `browser.execute()` runs in isolated WKWebView content world

**Plugin**: [tauri-plugin-webdriver-automation](https://github.com/danielraffel/tauri-webdriver) + `tauri-wd` CLI  
**Platform**: macOS 15, WKWebView, Tauri v2  
**Severity**: Major

## Summary

`browser.execute()` evaluates JS in an isolated WKWebView content world, not the page's main world. Page script `window` properties are invisible to WebDriver script execution.

## Observed behavior

Given `index.html` with an inline script setting `window.__myApp = { ready: true }`:

```js
// From browser.execute() in WebDriverIO:
await browser.execute(() => window.__myApp);       // => undefined  (BUG)
await browser.execute(() => window.__TAURI_INTERNALS__); // => object (works)

// Setting window props from execute() works within execute() scope:
await browser.execute(() => { window.__test = 1; });
await browser.execute(() => window.__test);        // => 1 (persists in isolated world)
```

DOM is shared (reads/writes work), but JS globals from `<script>` tags are not visible.

## Expected behavior

`browser.execute()` should run in the page's main JavaScript world, like every other WebDriver implementation. `window` properties set by page scripts should be accessible.

## Root cause hypothesis

The plugin likely uses `WKWebView.evaluateJavaScript(_:in:contentWorld:)` with a non-default `WKContentWorld` (or the Tauri IPC bridge world), instead of `WKContentWorld.page`.

## Impact

- Standard pattern of exposing test hooks via `window.__myApp` is broken
- Page inline `<script>` tags appear in DOM but their side effects are invisible
- Workaround: call Tauri IPC directly via `window.__TAURI_INTERNALS__.invoke()` from `browser.execute()`, bypassing the frontend entirely

## Minimum reproducer

### 1. Create a minimal Tauri v2 app

```
cargo create-tauri-app repro --template vanilla
cd repro/src-tauri
cargo add tauri-plugin-webdriver-automation
```

### 2. Register plugin (src-tauri/src/main.rs)

```rust
fn main() {
    let mut builder = tauri::Builder::default();
    #[cfg(debug_assertions)]
    { builder = builder.plugin(tauri_plugin_webdriver_automation::init()); }
    builder.run(tauri::generate_context!()).unwrap();
}
```

### 3. Frontend (index.html)

```html
<!DOCTYPE html>
<html><body>
<div id="badge"></div>
<script>
  window.__myApp = { ready: true };
  document.getElementById('badge').textContent = 'initialized';
</script>
</body></html>
```

### 4. Build and test

```bash
cargo build
cargo install tauri-webdriver-automation
tauri-wd --port 4444 &
```

WebDriverIO test:

```js
describe('repro', () => {
  it('page window props should be visible', async () => {
    await browser.pause(2000);
    const badge = await browser.$('#badge').getText();
    console.log('badge:', badge);         // "" — script never ran in our world
    const app = await browser.execute(() => window.__myApp);
    console.log('__myApp:', app);         // undefined — isolated world
    const tauri = await browser.execute(() => typeof window.__TAURI_INTERNALS__);
    console.log('TAURI:', tauri);         // "object" — injected into all worlds
  });
});
```

## Environment

- macOS 15 (Sequoia), Apple Silicon
- Tauri 2.x stable
- tauri-plugin-webdriver-automation 0.1.x
- tauri-webdriver-automation (tauri-wd) 0.1.x
- WebDriverIO 9.x
