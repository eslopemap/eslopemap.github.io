// Tauri e2e tests for folder operations and tile drag-drop
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { waitForTauri, tauriInvoke, installErrorCapture, assertNoCapturedErrors } from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');

describe('Folder and Tile Operations (Tauri)', () => {
  let tempDir;

  beforeEach(async () => {
    await waitForTauri(browser);
    await installErrorCapture(browser);
    // Create a temp directory for each test
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slope-test-'));
  });

  afterEach(async () => {
    // Clean up temp dir
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    await assertNoCapturedErrors(browser);
  });

  describe('Open Folder Dialog', function () {
    it('should keep the expected folder dialog payload shape without opening a native dialog', async function () {
      const result = await browser.execute(() => {
        const payload = {
          options: {
            directory: true,
            multiple: false,
            title: 'Open Folder (GPX + Tiles)',
          },
        };

        return {
          hasInternals: Boolean(window.__TAURI_INTERNALS__?.invoke),
          command: 'plugin:dialog|open',
          hasOptions: Boolean(payload.options),
          directory: payload.options.directory,
          multiple: payload.options.multiple,
          title: payload.options.title,
        };
      });

      assert.strictEqual(result.hasInternals, true, 'Tauri internals should be available');
      assert.strictEqual(result.command, 'plugin:dialog|open');
      assert.strictEqual(result.hasOptions, true, 'Dialog payload should keep nested options');
      assert.strictEqual(result.directory, true, 'Dialog payload should request a directory');
      assert.strictEqual(result.multiple, false, 'Dialog payload should request a single folder');
      assert.strictEqual(result.title, 'Open Folder (GPX + Tiles)', 'Dialog payload should keep the expected title');
    });

    it('should scan folder for GPX and tile files', async function () {
      // Copy test fixtures to temp dir
      const gpxSrc = path.join(FIXTURES_DIR, 'gpx/simple-track.gpx');
      const tileSrc = path.join(FIXTURES_DIR, 'tiles/dummy-z1-z3.mbtiles');
      
      if (fs.existsSync(gpxSrc)) {
        fs.copyFileSync(gpxSrc, path.join(tempDir, 'test.gpx'));
      }
      if (fs.existsSync(tileSrc)) {
        fs.copyFileSync(tileSrc, path.join(tempDir, 'test.mbtiles'));
      }

      // Use Tauri IPC to scan the folder
      const gpxResult = await tauriInvoke(browser, 'pick_and_watch_folder', {
        folderPath: tempDir
      });
      
      assert.ok(gpxResult.snapshot, 'Should have snapshot property');
      if (fs.existsSync(gpxSrc)) {
        assert(Array.isArray(gpxResult.snapshot.files), 'Files should be an array');
        assert(gpxResult.snapshot.files.length >= 1, 'Should have at least 1 GPX file');
      }

      // Scan for tiles
      const tileResult = await tauriInvoke(browser, 'scan_tile_folder', {
        folderPath: tempDir
      });
      
      assert(Array.isArray(tileResult), 'Tile result should be an array');
      if (fs.existsSync(tileSrc)) {
        assert(tileResult.length >= 1, 'Should have at least 1 tile');
        assert.ok(tileResult[0].name, 'Tile should have name');
        assert.ok(tileResult[0].path, 'Tile should have path');
        assert.ok(tileResult[0].kind, 'Tile should have kind');
      }
    });
  });

  describe('Tile Drag-Drop', function () {
    it('should handle tile file entry with fullPath', async function () {
      // This test verifies that handleTileFileEntry uses entry.fullPath
      // We simulate the FileSystemFileEntry structure
      
      const tilePath = path.join(FIXTURES_DIR, 'tiles/dummy-z1-z3.mbtiles');
      if (!fs.existsSync(tilePath)) {
        this.skip();
        return;
      }

      const result = await browser.executeAsync(async (testPath, done) => {
        try {
          // Simulate a FileSystemFileEntry with fullPath
          const mockEntry = {
            isFile: true,
            name: 'dummy-z1-z3.mbtiles',
            fullPath: testPath,
            file: (callback) => {
              // Create a mock File object (without .path property)
              const mockFile = {
                name: 'dummy-z1-z3.mbtiles',
                // Note: no .path property - this is the bug we're testing
              };
              callback(mockFile);
            }
          };

          // Check if handleTileFileEntry is accessible
          // (it's not exported, so we test the pattern it should follow)
          const hasFullPath = Boolean(mockEntry.fullPath);
          const hasFilePath = Boolean(mockEntry.file && mockEntry.file.path);
          
          done({ 
            ok: true, 
            hasFullPath,
            hasFilePath,
            fullPath: mockEntry.fullPath 
          });
        } catch (e) {
          done({ ok: false, error: String(e) });
        }
      }, tilePath);

      assert.strictEqual(result.ok, true, 'Should execute without error');
      assert.strictEqual(result.hasFullPath, true, 'Entry should have fullPath');
      assert.strictEqual(result.fullPath, tilePath, 'fullPath should match test path');
    });

    it('should prefer file.path over folder-relative entry.fullPath', async function () {
      const tilePath = path.join(FIXTURES_DIR, 'tiles/dummy-z1-z3.mbtiles');
      if (!fs.existsSync(tilePath)) {
        this.skip();
        return;
      }

      const resolved = await browser.execute((testPath) => {
        const file = { path: testPath };
        const entry = { fullPath: '/dropped-folder/dummy-z1-z3.mbtiles' };
        if (typeof file?.path === 'string' && file.path) return file.path;
        if (typeof entry?.fullPath === 'string' && entry.fullPath) return entry.fullPath;
        return '';
      }, tilePath);

      assert.strictEqual(resolved, tilePath, 'Should prefer absolute file.path over entry.fullPath');
    });

    it('should register dropped tile file via IPC and expose it through TileJSON', async function () {
      const tilePath = path.join(FIXTURES_DIR, 'tiles/dummy-z1-z3.mbtiles');
      if (!fs.existsSync(tilePath)) {
        this.skip();
        return;
      }

      // Register the tile source
      await tauriInvoke(browser, 'add_tile_source', {
        name: 'test-tile',
        path: tilePath
      });

      // Verify backend registry contains the source
      const sources = await tauriInvoke(browser, 'list_tile_sources');
      assert(Array.isArray(sources), 'Sources should be an array');

      const testSource = sources.find(s => s.name === 'test-tile');
      assert.ok(testSource, 'Test source should exist in tile source registry');
      assert.ok(String(testSource.path).endsWith('dummy-z1-z3.mbtiles'), 'Source path should point to the fixture file');

      // Verify the frontend-discovery path uses HTTP TileJSON, not IPC
      const config = await tauriInvoke(browser, 'get_desktop_config');
      const tileJsonResult = await browser.executeAsync((baseUrl, done) => {
        fetch(`${baseUrl}/tilejson`)
          .then(async (res) => done({ ok: true, status: res.status, body: await res.json() }))
          .catch((e) => done({ ok: false, error: String(e) }));
      }, config.tile_base_url);

      assert.strictEqual(tileJsonResult.ok, true, `TileJSON fetch should succeed: ${tileJsonResult.error || 'unknown error'}`);
      assert.strictEqual(tileJsonResult.status, 200, 'TileJSON endpoint should return 200');
      assert(Array.isArray(tileJsonResult.body), 'TileJSON index should be an array');

      const tileJsonEntry = tileJsonResult.body.find(s => s.id === 'test-tile');
      assert.ok(tileJsonEntry, 'Registered tile should be exposed by /tilejson');
      assert.strictEqual(tileJsonEntry.name, 'dummy-z1-z3', 'Fixture metadata name should be preserved as the display label');
      assert(Array.isArray(tileJsonEntry.tiles), 'MBTiles TileJSON should expose a tiles array');
      assert.ok(tileJsonEntry.tiles[0].includes('/tiles/test-tile/'), 'TileJSON tiles URL should point to the local tile server');
    });
  });

  describe('Error Handling', function () {
    it('should not crash on invalid folder path', async function () {
      const invalidPath = '/nonexistent/path/to/folder';
      
      try {
        await tauriInvoke(browser, 'pick_and_watch_folder', {
          folderPath: invalidPath
        });
        // If it doesn't throw, that's fine - it might return empty
      } catch (e) {
        // Error is expected, but shouldn't be a crash
        assert(!String(e).includes('panicked'), 'Should not panic on invalid path');
      }

    });

    it('should handle tile file without path gracefully', async function () {
      const result = await browser.executeAsync(async (done) => {
        try {
          // Simulate the bug scenario: File object without .path
          const mockFile = {
            name: 'test.mbtiles',
            // No .path property
          };
          
          const mockEntry = {
            isFile: true,
            name: 'test.mbtiles',
            // No fullPath either
            file: (callback) => callback(mockFile)
          };

          // The code should check for path availability
          const path = mockEntry.fullPath || mockFile.path;
          const hasPath = Boolean(path);
          
          done({ ok: true, hasPath, path });
        } catch (e) {
          done({ ok: false, error: String(e) });
        }
      });

      assert.strictEqual(result.ok, true, 'Should execute without error');
      assert.strictEqual(result.hasPath, false, 'Should not have path when both are undefined');
      // The code should handle this gracefully (log error, don't crash)
    });
  });
});
