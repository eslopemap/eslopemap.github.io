---
description: Debug WKWebView / WebKit JavaScript execution issues on macOS
---
1. Confirm whether the failure is in the page script or in WebDriver execution.
   - Add a tiny standalone inline `<script>` before the main app script.
   - In that probe, set a DOM attribute such as `document.documentElement.setAttribute('data-inline-script-probe', '1')`.
   - Also set a page-owned global such as `window.__inlineScriptProbe = true`.

2. Capture runtime failures from the page itself.
   - In the standalone probe, register `window.addEventListener('error', ...)` and `window.addEventListener('unhandledrejection', ...)`.
   - Write the error message or rejection reason into DOM attributes such as `data-script-error` and `data-script-rejection`.
   - If possible, wrap the main app bootstrap in a top-level `try/catch` and write the stack trace into a DOM attribute before rethrowing.

3. Distinguish shared DOM visibility from page-global visibility.
   - From WebDriver, read both:
     - a DOM signal such as `document.documentElement.getAttribute('data-inline-script-probe')`
     - a page-owned global such as `window.__pageProbe`
   - If the DOM signal is visible but the page global is not, suspect a content-world mismatch.
   - If neither is visible, suspect that the page script did not run or failed very early.

4. Use parser diagnostics before changing code blindly.
   - On macOS, JavaScriptCore's CLI lives at:
     `/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Resources/jsc`
   - It may not be in `PATH`.
   - Extract inline script contents and run the CLI directly to syntax-check or evaluate small repros.
   - If `jsc` is unavailable in the shell environment, use an existing parser in the repo such as `esprima` or `@babel/parser` for a quick syntax check.

5. Check WebKit logs, but do not rely on them alone.
   - Use unified logs for the app and WebKit content process.
   - Look for JavaScript execution activity and surfaced exceptions.
   - Note that page load/runtime errors may still be opaque in unified logs, so DOM-level error capture is often more reliable.

6. For Tauri WebDriver on macOS, inspect content-world usage explicitly.
   - Search for `evaluateJavaScript`, `callAsyncJavaScript`, and `WKContentWorld` in the macOS implementation.
   - Verify whether sync and async execution paths are using `WKContentWorld::pageWorld(...)` consistently.
   - If only the async path uses `pageWorld`, patch the sync/shared execution path and validate with a focused repro that reads a page-defined `window` global.

7. Validate fixes with a minimal reproducible probe.
   - Use a page that sets both a DOM attribute and a `window.__probe` global from inline script.
   - From WebDriver, assert that sync execute and async execute can both see the DOM signal and the page-owned global.
   - Only after that, rerun the full app test suite.
