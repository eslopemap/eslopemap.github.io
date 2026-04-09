// Tauri e2e tests for config persistence: get/set config values,
// custom TileJSON source persistence in the backend config.
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    waitForTauri,
    tauriInvoke,
    resetDesktopTestState,
    installErrorCapture,
    assertNoCapturedErrors,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Config Persistence (Tauri desktop)', () => {

    beforeEach(async () => {
        await waitForTauri(browser);
        await installErrorCapture(browser);
    });

    afterEach(async () => {
        await assertNoCapturedErrors(browser);
    });

    it('get_config_value returns default cache.max_size_mb', async () => {
        const value = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });
        assert.strictEqual(typeof value, 'number', 'cache.max_size_mb should be a number');
        assert.ok(value > 0, `cache.max_size_mb should be positive, got ${value}`);
        console.log(`[test] default cache.max_size_mb = ${value}`);
    });

    it('set_config_value + get_config_value roundtrip for cache.max_size_mb', async () => {
        const original = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });

        await tauriInvoke(browser, 'set_config_value', { key: 'cache.max_size_mb', value: 999 });
        const updated = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });
        assert.strictEqual(updated, 999, 'cache.max_size_mb should be updated to 999');

        // Restore original
        await tauriInvoke(browser, 'set_config_value', { key: 'cache.max_size_mb', value: original });
    });

    it('get_config_value returns default sources.folders (empty array)', async () => {
        const value = await tauriInvoke(browser, 'get_config_value', { key: 'sources.folders' });
        assert.ok(Array.isArray(value), 'sources.folders should be an array');
        console.log(`[test] sources.folders = ${JSON.stringify(value)}`);
    });

    it('set_config_value + get_config_value roundtrip for sources.custom_tilejsons', async () => {
        const original = await tauriInvoke(browser, 'get_config_value', { key: 'sources.custom_tilejsons' });

        const testTileJson = [{ id: 'e2e-cfg-test', name: 'E2E Config Test', tiles: ['https://example.test/{z}/{x}/{y}.png'] }];
        await tauriInvoke(browser, 'set_config_value', { key: 'sources.custom_tilejsons', value: testTileJson });

        const updated = await tauriInvoke(browser, 'get_config_value', { key: 'sources.custom_tilejsons' });
        assert.ok(Array.isArray(updated), 'sources.custom_tilejsons should be an array');
        assert.strictEqual(updated.length, 1, 'Should have 1 custom tilejson entry');
        assert.strictEqual(updated[0].id, 'e2e-cfg-test', 'TileJSON id should match');
        assert.strictEqual(updated[0].name, 'E2E Config Test', 'TileJSON name should match');

        // Restore original
        await tauriInvoke(browser, 'set_config_value', { key: 'sources.custom_tilejsons', value: original || [] });
    });

    it('cache.max_size_mb persists across app reload', async () => {
        const original = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });
        const nextValue = Math.max(64, Number(original) + 17);

        await tauriInvoke(browser, 'set_config_value', { key: 'cache.max_size_mb', value: nextValue });
        const updated = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });
        assert.strictEqual(updated, nextValue, 'cache.max_size_mb should update before reload');

        await browser.refresh();
        await waitForTauri(browser);

        const afterReload = await tauriInvoke(browser, 'get_config_value', { key: 'cache.max_size_mb' });
        assert.strictEqual(afterReload, nextValue, 'cache.max_size_mb should survive page reload');

        await tauriInvoke(browser, 'set_config_value', { key: 'cache.max_size_mb', value: original });
    });

    it('set_config_value rejects unsupported key', async () => {
        try {
            await tauriInvoke(browser, 'set_config_value', { key: 'bad.key', value: 42 });
            assert.fail('Should have thrown for unsupported key');
        } catch (e) {
            assert.ok(String(e).includes('Unsupported config key'), `Expected unsupported key error, got: ${e}`);
        }
    });

    it('get_config_value rejects unsupported key', async () => {
        try {
            await tauriInvoke(browser, 'get_config_value', { key: 'bad.key' });
            assert.fail('Should have thrown for unsupported key');
        } catch (e) {
            assert.ok(String(e).includes('Unsupported config key'), `Expected unsupported key error, got: ${e}`);
        }
    });

    it('set_config_value rejects invalid type for cache.max_size_mb', async () => {
        try {
            await tauriInvoke(browser, 'set_config_value', { key: 'cache.max_size_mb', value: 'not a number' });
            assert.fail('Should have thrown for invalid type');
        } catch (e) {
            assert.ok(String(e).includes('invalid cache.max_size_mb'), `Expected type error, got: ${e}`);
        }
    });

    it('sources.custom_tilejsons persists across app reload', async () => {
        const testTileJsons = [
            { id: 'persist-test', name: 'Persist Test', tiles: ['https://example.test/{z}/{x}/{y}.png'] },
        ];
        await tauriInvoke(browser, 'set_config_value', { key: 'sources.custom_tilejsons', value: testTileJsons });

        // Reload the page (not the Tauri process — the config is saved to disk)
        await browser.refresh();
        await waitForTauri(browser);

        const afterReload = await tauriInvoke(browser, 'get_config_value', { key: 'sources.custom_tilejsons' });
        assert.ok(Array.isArray(afterReload), 'Should still be an array after reload');
        const found = afterReload.find(tj => tj.id === 'persist-test');
        assert.ok(found, 'Persisted custom TileJSON should survive page reload');

        // Clean up
        await tauriInvoke(browser, 'set_config_value', { key: 'sources.custom_tilejsons', value: [] });
    });
});
