- get me a full coverage report merging the 4 test suite coverages, including the tauri-e2e (we're already building with webdriver enabled)

adress any strategic coverage gaps.

---

* the issues with custom-*tiles look to me more of a zoom-level mismatch
* I have set the crop from 400 to 600
* so, please copy actual into expect at this point, I have validated them
* then get going with unified coverage

---

1. oh, I got it, the screenshots are probably impacted by runnig on different displays that have different resolutions and MacOS hidpi scaling.

according to upstream issue, use something ScreenshotScale.Css like
        var imageBytes = await _page.Locator("#toSnapshot")
            .ScreenshotAsync(new LocatorScreenshotOptions() { Scale = ScreenshotScale.Css });

actually you can remove the custom helper code and custom png lib dependencies by using expect page toHaveScreenshot, see https://playwright.dev/docs/test-snapshots, https://playwright.dev/docs/api/class-snapshotassertions
this will apply css option automatically
so implement this

2. then also adress  the flaky undo test is flaky, I validated undo still works so the number of points should indeed decrease after undo !

3. keep trying to stabilize enough for this coverage run
 
---

AI:

Your suggestion is good in principle, but these Tauri tests are running under WebdriverIO + Tauri WebDriver, not Playwright.
The Tauri stack doesn’t support Playwright’s toHaveScreenshot directly
I confirmed these desktop tests run on WebdriverIO, not Playwright, and there’s no snapshot plugin configured. So I can’t truthfully swap in Playwright’s toHaveScreenshot here.

What I can do cleanly is the part that matters for HiDPI stability:

* stop cropping raw viewport PNGs by hand
* capture the map element itself with WebDriver’s element screenshot API
That should normalize away the display/viewport math that’s likely causing drift, while keeping the existing thresholded baseline comparison.

I’m switching the custom-map tests to element screenshots, then I’ll stabilize the undo assertion.

---

End note: even after all this there is still an issue where the app starts loading the correct layers eg the mocked DEM hillshade, then suddenly (reset for next test?) the app resets to its default 'OSM + Slope' state.