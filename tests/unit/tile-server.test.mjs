/**
 * Unit tests for the Node.js tile server helper.
 * Verifies that tiles are served correctly and contain expected pixel data.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const { startTileServer, FIXTURES } = require('../e2e/tile-server-helper.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MBTILES_PATH = path.join(FIXTURES, 'dummy-z1-z3.mbtiles');
const PMTILES_PATH = path.join(FIXTURES, 'dummy-z1-z3.pmtiles');

describe('Tile Server Helper', () => {
  let server;

  beforeAll(async () => {
    server = await startTileServer({
      'dummy-mbt': { path: MBTILES_PATH, kind: 'mbtiles' },
      'dummy-pmt': { path: PMTILES_PATH, kind: 'pmtiles' },
    });
  });

  afterAll(() => {
    server?.close();
  });

  describe('MBTiles serving', () => {
    it('returns 200 with PNG data for existing tile z=2 x=0 y=0', async () => {
      // TMS row for z=2, y=0: (1<<2)-1-0 = 3
      const resp = await fetch(`${server.url}/tiles/dummy-mbt/2/0/0.png`);
      expect(resp.status).toBe(200);
      expect(resp.headers.get('content-type')).toBe('image/png');
      const buf = await resp.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(100);
    });

    it('returns 204 for non-existent tile z=5 x=0 y=0', async () => {
      const resp = await fetch(`${server.url}/tiles/dummy-mbt/5/0/0.png`);
      expect(resp.status).toBe(204);
    });

    it('returns 404 for unknown source', async () => {
      const resp = await fetch(`${server.url}/tiles/nonexistent/2/0/0.png`);
      expect(resp.status).toBe(404);
    });

    it('tile at z=2 x=2 y=2 contains green pixels (75, 162, 116)', async () => {
      const resp = await fetch(`${server.url}/tiles/dummy-mbt/2/2/2.png`);
      expect(resp.status).toBe(200);

      const buf = Buffer.from(await resp.arrayBuffer());
      const png = PNG.sync.read(buf);
      expect(png.width).toBe(256);
      expect(png.height).toBe(256);

      // Count green pixels matching the expected tile color
      let greenCount = 0;
      let totalPixels = png.width * png.height;
      for (let i = 0; i < png.data.length; i += 4) {
        const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
        if (r >= 60 && r <= 90 && g >= 150 && g <= 180 && b >= 100 && b <= 130) {
          greenCount++;
        }
      }

      const greenRatio = greenCount / totalPixels;
      expect(greenRatio).toBeGreaterThan(0.8); // Source tiles are ~87% green
    });

    it('all z=2 tiles contain non-white pixels', async () => {
      // z=2 has 4x4 = 16 tiles (x: 0-3, y: 0-3)
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          const resp = await fetch(`${server.url}/tiles/dummy-mbt/2/${x}/${y}.png`);
          expect(resp.status).toBe(200);
          const buf = Buffer.from(await resp.arrayBuffer());
          const png = PNG.sync.read(buf);

          // Check that at least some pixels are not white
          let nonWhite = 0;
          for (let i = 0; i < png.data.length; i += 4) {
            if (png.data[i] !== 255 || png.data[i + 1] !== 255 || png.data[i + 2] !== 255) {
              nonWhite++;
            }
          }
          const ratio = nonWhite / (png.width * png.height);
          expect(ratio, `Tile z=2 x=${x} y=${y} should have non-white pixels`).toBeGreaterThan(0.5);
        }
      }
    });
  });

  describe('PMTiles serving', () => {
    it('serves PMTiles file with Range request support', async () => {
      const resp = await fetch(`${server.url}/pmtiles/dummy-pmt`, {
        headers: { Range: 'bytes=0-99' }
      });
      expect(resp.status).toBe(206);
      expect(resp.headers.get('content-range')).toMatch(/^bytes 0-99\//);
      const buf = await resp.arrayBuffer();
      expect(buf.byteLength).toBe(100);
    });

    it('serves full PMTiles file without Range header', async () => {
      const resp = await fetch(`${server.url}/pmtiles/dummy-pmt`);
      expect(resp.status).toBe(200);
      const buf = await resp.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(1000);
    });

    it('returns 404 for unknown PMTiles source', async () => {
      const resp = await fetch(`${server.url}/pmtiles/nonexistent`);
      expect(resp.status).toBe(404);
    });
  });
});
