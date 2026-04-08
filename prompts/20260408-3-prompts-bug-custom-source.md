- read 20260407-@20260407-TILE-RENDERING-INVESTIGATION.md#L63 .md
we have fixed the main bug, which was that layers where not added to the catalog. but the test still displays white and the functionality is hit-or-miss. make a tauri e2e test, investigate, check if the existing terst makes sense a web ui --> local tile server flow (this one may only work when ui is on localhost anyway due to CORS ?)

be critical, don;t take existing state as granted unless tested. work back and forth with me.

---

[ Report Written: reports/20260408-TILE-RENDERING-TAURI-REPORT.md ]

---

I have  indeed fixed it with cargo build --features webdriver, remember to use that in the future !
1. first, write ./report and git commit what you have done so far with detailed message.
2. then, I still don't see a tauri-e2e test including the custom .mbtiles and a screenshot. unless I missed it write it before anything else.
3. then, I'm worried about the filtering of errors inside dem-tile-serving:
        // Verify no fetch errors were captured
        const allErrors = await getCapturedErrors(browser);
        const demErrors = filterErrors(allErrors, /tiles\/dem\/.*(363|364|365).*\.webp/);
all tests should capture all errors and fail if any.
4. then, if not fixed yet, check why I would get this in 
`[tile-cache] upstream fetch error for https://tiles.mapterhorn.com/12/2130/1487.webp: https://tiles.mapterhorn.com/12/2130/1487.webp: Connection Failed: tls connection init failed: invalid peer certificate: UnknownIssuer
`
` [Error] Failed to load resource: the server responded with a status of 404 (Not Found) (373.jpg, line 0)
disable certificate check in the tests as my corpo VPN/proxy messes up those.
5. keep going with the other problems you found if there's still any

---

- update reports/20260408-TILE-RENDERING-TAURI-REPORT.md and keep updating it as you go
- simplify the certificate bypas. switch to ureq 3 and follow new patern, eg it  provides pub fn disable_verification(self, v: bool) -> Self  according to https://docs.rs/ureq/latest/ureq/tls/struct.TlsConfigBuilder.html 
- commit the current state again with message
- regarding the custom-source  test failure, I see the source in the dropdown (multiple times) with proper label, so at least this part works. what I want is:
  * change the functionality so that a newly imported custom source (if only one, ie file case fnot folder case) is always added as a basemap layer by default
  * see if that helps with the test
  * try to move the test forward up to the point where you can take a screenshot and validate with the screenshot that the source is added

---

- be careful about existing persisted config on client & server (slopemapper.toml) & server-side tile-cache  interfering in the e2e test.
be more principled about 'test mode' (currently there is a test mode in the UI that deselects some default layers, but that may not be enough and not enabled everywhere it needs to)
- I got ReferenceError: Can't find variable: buildCatalogEntryFromTileJson
- on drag and drop tile I now get Source Map "http://127.0.0.1:1430/vendor/chart.js/4.5.1/dist/chart.js.map" has SyntaxError: JSON Parse error: Unrecognized token '<'
- there are some cargo build warnings, adress them, maybe cache was not finished ? do not remove dead code without thinking what unfinished feature it may be part of
- in the failing/white test, display the maplibre layer list (eg from the settings panel) and check it against what you expect
- if test still shows white and you have some ideas, try to narrow it further or suggest next steps
- keep adding to report and git-commit-ing when appropriate