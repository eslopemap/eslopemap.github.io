import assert from 'assert';
import path from 'path';
import {
    GPX_SAMPLES,
    createTestFolder,
    cleanupTestFolder,
    waitForTauri,
    tauriInvoke,
    watchFolder,
    loadGpx,
    saveGpx,
    markDirty,
    resolveConflict,
    writeTestFile,
    readTestFile,
    deleteTestFile,
    renameTestFile,
    takeScreenshot,
} from './helpers.mjs';

// Poll backend snapshot until a condition is met.
async function waitForSnapshot(browser, predicate, timeout = 5000, msg = '') {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const snap = await tauriInvoke(browser, 'get_snapshot');
        if (predicate(snap)) return snap;
        await browser.pause(250);
    }
    const final_ = await tauriInvoke(browser, 'get_snapshot');
    throw new Error(msg || `Snapshot condition not met. Final: ${JSON.stringify(final_)}`);
}

describe('Spike 2 — File-Centric GPX Sync (IPC-driven)', () => {
    let tmpDir;

    beforeEach(async () => {
        await waitForTauri(browser);
    });

    afterEach(() => {
        if (tmpDir) { cleanupTestFolder(tmpDir); tmpDir = null; }
    });

    // -----------------------------------------------------------------------
    // Test primitives
    // -----------------------------------------------------------------------

    describe('Test primitives', () => {
        it('Tauri IPC is reachable', async () => {
            const hasTauri = await browser.execute(() => Boolean(window.__TAURI_INTERNALS__));
            assert.strictEqual(hasTauri, true);
        });

        it('screenshot primitive works', async () => {
            const filepath = await takeScreenshot(browser, '00-primitive-test');
            assert.ok(filepath.endsWith('.png'));
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 0 — Watch folder and list files
    // -----------------------------------------------------------------------

    describe('Scenario 0 — Watch folder', () => {
        it('should watch a folder and return a snapshot of GPX files', async () => {
            tmpDir = createTestFolder({
                'ride.gpx': GPX_SAMPLES.simple,
                'walk.gpx': GPX_SAMPLES.simple2,
            });

            const snapshot = await watchFolder(browser, tmpDir);
            assert.strictEqual(snapshot.files.length, 2);
            const names = snapshot.files.map(f => f.path.split('/').pop());
            assert.ok(names.includes('ride.gpx'));
            assert.ok(names.includes('walk.gpx'));

            await takeScreenshot(browser, '01-folder-watched');
        });

        it('should load GPX content via IPC', async () => {
            tmpDir = createTestFolder({ 'test.gpx': GPX_SAMPLES.simple });
            await watchFolder(browser, tmpDir);

            const filePath = path.join(tmpDir, 'test.gpx');
            const content = await loadGpx(browser, filePath);
            assert.ok(content.includes('Morning Ride'));
            assert.ok(content.includes('<gpx'));
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 1 — Clean external edit (auto-reload)
    // -----------------------------------------------------------------------

    describe('Scenario 1 — Clean external edit', () => {
        it('should detect file change on disk via watcher', async () => {
            tmpDir = createTestFolder({ 'ride.gpx': GPX_SAMPLES.simple });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            // Load the file (marks it as "selected" in backend state)
            const original = await loadGpx(browser, filePath);
            assert.ok(original.includes('Morning Ride'));

            // External edit
            const edited = original.replace('Morning Ride', 'Morning Ride EDITED');
            writeTestFile(tmpDir, 'ride.gpx', edited);

            // Wait for watcher to detect the change
            const snap = await waitForSnapshot(
                browser,
                s => s.files.some(f => f.status === 'changed_on_disk'),
                5000,
                'File should be marked changed_on_disk after external edit'
            );

            const file = snap.files.find(f => f.path.endsWith('ride.gpx'));
            assert.strictEqual(file.status, 'changed_on_disk');

            // Re-load the file — should see the edit
            const reloaded = await loadGpx(browser, filePath);
            assert.ok(reloaded.includes('EDITED'));

            await takeScreenshot(browser, '02-clean-external-edit');
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 2 — Dirty in-app then external edit (conflict)
    // -----------------------------------------------------------------------

    describe('Scenario 2 — Conflict detection & resolution', () => {
        it('should detect conflict when file is dirty and changes on disk', async () => {
            tmpDir = createTestFolder({ 'ride.gpx': GPX_SAMPLES.simple });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            // Mark file as dirty in backend
            await markDirty(browser, filePath);

            // Verify dirty state
            let snap = await tauriInvoke(browser, 'get_snapshot');
            assert.strictEqual(snap.files[0].status, 'dirty_in_app');

            // External edit while dirty → should trigger conflict
            const edited = GPX_SAMPLES.simple.replace('Morning Ride', 'EXTERNAL CHANGE');
            writeTestFile(tmpDir, 'ride.gpx', edited);

            snap = await waitForSnapshot(
                browser,
                s => s.files.some(f => f.status === 'conflict'),
                5000,
                'File should enter conflict state'
            );
            assert.strictEqual(snap.files[0].status, 'conflict');

            await takeScreenshot(browser, '03-conflict-detected');
        });

        it('should resolve conflict by keeping disk version', async () => {
            tmpDir = createTestFolder({ 'ride.gpx': GPX_SAMPLES.simple });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            await markDirty(browser, filePath);
            const diskContent = GPX_SAMPLES.simple.replace('Morning Ride', 'DISK WINS');
            writeTestFile(tmpDir, 'ride.gpx', diskContent);

            await waitForSnapshot(
                browser,
                s => s.files.some(f => f.status === 'conflict'),
                5000
            );

            const resolved = await resolveConflict(browser, filePath, 'disk');
            assert.ok(resolved.includes('DISK WINS'));

            const snap = await tauriInvoke(browser, 'get_snapshot');
            assert.strictEqual(snap.files[0].status, 'clean');

            await takeScreenshot(browser, '04-conflict-resolved-disk');
        });

        it('should resolve conflict by keeping app version', async () => {
            tmpDir = createTestFolder({ 'ride.gpx': GPX_SAMPLES.simple });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            await markDirty(browser, filePath);
            writeTestFile(tmpDir, 'ride.gpx', GPX_SAMPLES.simple.replace('Morning Ride', 'DISK CHANGE'));

            await waitForSnapshot(
                browser,
                s => s.files.some(f => f.status === 'conflict'),
                5000
            );

            const appContent = GPX_SAMPLES.simple.replace('Morning Ride', 'APP WINS');
            await resolveConflict(browser, filePath, 'app', appContent);

            // Disk should now contain app version
            const diskAfter = readTestFile(tmpDir, 'ride.gpx');
            assert.ok(diskAfter.includes('APP WINS'));

            const snap = await tauriInvoke(browser, 'get_snapshot');
            assert.strictEqual(snap.files[0].status, 'clean');

            await takeScreenshot(browser, '05-conflict-resolved-app');
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 3 — App save
    // -----------------------------------------------------------------------

    describe('Scenario 3 — App save', () => {
        it('should save content atomically and update state to clean', async () => {
            tmpDir = createTestFolder({ 'ride.gpx': GPX_SAMPLES.simple });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            await markDirty(browser, filePath);

            const newContent = GPX_SAMPLES.simple.replace('Morning Ride', 'Saved Ride');
            const savedState = await saveGpx(browser, filePath, newContent);
            assert.strictEqual(savedState.status, 'clean');

            // Verify disk
            const diskContent = readTestFile(tmpDir, 'ride.gpx');
            assert.ok(diskContent.includes('Saved Ride'));

            // Wait a moment to ensure no false conflict from watcher
            await browser.pause(1500);
            const snap = await tauriInvoke(browser, 'get_snapshot');
            const file = snap.files.find(f => f.path.endsWith('ride.gpx'));
            assert.strictEqual(file.status, 'clean');

            await takeScreenshot(browser, '06-app-save');
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 4 — External rename
    // -----------------------------------------------------------------------

    describe('Scenario 4 — External rename', () => {
        it('should detect file rename via watcher', async () => {
            tmpDir = createTestFolder({
                'ride.gpx': GPX_SAMPLES.simple,
                'walk.gpx': GPX_SAMPLES.simple2,
            });
            await watchFolder(browser, tmpDir);

            renameTestFile(tmpDir, 'ride.gpx', 'renamed-ride.gpx');

            // The watcher should detect remove + add (or rename event)
            const snap = await waitForSnapshot(
                browser,
                s => {
                    const names = s.files.map(f => f.path.split('/').pop());
                    return names.includes('renamed-ride.gpx') && !names.includes('ride.gpx');
                },
                5000,
                'Snapshot should reflect renamed file'
            );

            assert.strictEqual(snap.files.length, 2);

            await takeScreenshot(browser, '07-external-rename');
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 5 — External delete
    // -----------------------------------------------------------------------

    describe('Scenario 5 — External delete', () => {
        it('should detect file deletion via watcher', async () => {
            tmpDir = createTestFolder({
                'ride.gpx': GPX_SAMPLES.simple,
                'walk.gpx': GPX_SAMPLES.simple2,
            });
            await watchFolder(browser, tmpDir);

            deleteTestFile(tmpDir, 'walk.gpx');

            const snap = await waitForSnapshot(
                browser,
                s => s.files.length === 1,
                5000,
                'Snapshot should have 1 file after deletion'
            );

            const remaining = snap.files[0].path.split('/').pop();
            assert.strictEqual(remaining, 'ride.gpx');

            await takeScreenshot(browser, '08-external-delete');
        });
    });

    // -----------------------------------------------------------------------
    // Scenario 6 — Multi-track GPX
    // -----------------------------------------------------------------------

    describe('Scenario 6 — Multi-track file', () => {
        it('should load, save, and verify a multi-track GPX as whole file', async () => {
            tmpDir = createTestFolder({ 'multi.gpx': GPX_SAMPLES.multiTrack });
            const snapshot = await watchFolder(browser, tmpDir);
            const filePath = snapshot.files[0].path;

            const content = await loadGpx(browser, filePath);
            assert.ok(content.includes('Col du Galibier'));
            assert.ok(content.includes('Col du Lautaret'));

            // Edit and save
            const edited = content.replace('Col du Galibier', 'Col du Galibier EDITED');
            await saveGpx(browser, filePath, edited);

            // Verify disk has all tracks + edit
            const diskContent = readTestFile(tmpDir, 'multi.gpx');
            assert.ok(diskContent.includes('Col du Galibier EDITED'));
            assert.ok(diskContent.includes('Col du Lautaret'));

            await takeScreenshot(browser, '09-multi-track');
        });
    });
});
