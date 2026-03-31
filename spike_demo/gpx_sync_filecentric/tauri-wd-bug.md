# Bug: `browser.execute()` runs in isolated WKWebView content world

**Affects**: ALL macOS Tauri WebDriver plugins using `WKWebView.evaluateJavaScript`  
**Tested on**:
- [tauri-plugin-webdriver-automation](https://github.com/danielraffel/tauri-webdriver) 0.1.x + `tauri-wd` CLI
- [tauri-plugin-webdriver](https://github.com/Choochmeque/tauri-plugin-webdriver) 0.2.x  
**Platform**: macOS 15 (Sequoia), WKWebView, Tauri v2  
**Severity**: Major — standard WebDriver testing patterns broken on macOS

## Summary

`browser.execute()` (W3C `/session/{id}/execute/sync`) evaluates JS in an
**isolated WKWebView content world**, not the page's main world. This is a
fundamental WKWebView behavior: `evaluateJavaScript(_:)` runs in a separate
JS context that shares the DOM but NOT `window` properties set by page scripts.

Both plugins listed above exhibit the same behavior — this is not plugin-specific
but a WKWebView platform constraint.

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

## Root cause

WKWebView's `evaluateJavaScript(_:)` and `evaluateJavaScript(_:in:contentWorld:)`
with `WKContentWorld.defaultClient` (the default) run in an isolated JS world.
To access the page's main world, plugins must use `WKContentWorld.page` explicitly.

Both tested plugins appear to use the default content world, which is isolated.

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

## Workaround

Drive tests via Tauri IPC directly from `browser.execute()`:

```js
// Instead of relying on page script's window.__myApp:
const result = await browser.executeAsync(async (done) => {
    const r = await window.__TAURI_INTERNALS__.invoke('my_command', { arg: 'val' });
    done(r);
});
```

`__TAURI_INTERNALS__` is injected into all content worlds and IPC works correctly.
This bypasses the frontend JS entirely — tests interact with the Rust backend directly.

## Possible fix

Plugins should use `WKContentWorld.page` when evaluating WebDriver `execute/sync`
and `execute/async` scripts, so that the evaluated JS shares the same world as
page `<script>` tags. This is how Safari's WebDriver (SafariDriver) works.

## Environment

- macOS 15 (Sequoia), Apple Silicon
- Tauri 2.10.x
- tauri-plugin-webdriver-automation 0.1.x (danielraffel)
- tauri-plugin-webdriver 0.2.x (Choochmeque)
- WebDriverIO 9.x
