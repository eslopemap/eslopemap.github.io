// Lightweight Node.js tile server for e2e tests.
// Serves MBTiles tiles via /tiles/{source}/{z}/{x}/{y}.png
// Serves PMTiles files via /pmtiles/{source} with Range support.

const http = require('http');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const FIXTURES = path.resolve(__dirname, '../fixtures/tiles');

/** Convert XYZ y to TMS row (MBTiles uses TMS). */
function xyzToTmsRow(z, y) {
  return (1 << z) - 1 - y;
}

/**
 * Start a tile server on a random port.
 * @param {Object} sources — { name: { path, kind } }
 * @returns {Promise<{url: string, close: () => void}>}
 */
function startTileServer(sources) {
  return new Promise((resolve) => {
    const dbs = {};
    for (const [name, src] of Object.entries(sources)) {
      if (src.kind === 'mbtiles') {
        dbs[name] = new Database(src.path, { readonly: true });
      }
    }

    const server = http.createServer((req, res) => {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url;

      // --- MBTiles: /tiles/{source}/{z}/{x}/{y}.png ---
      const tileMatch = url.match(/^\/tiles\/([^/]+)\/(\d+)\/(\d+)\/(\d+)\.\w+/);
      if (tileMatch) {
        const [, source, zStr, xStr, yStr] = tileMatch;
        const db = dbs[source];
        if (!db) {
          console.log(`[tile-server] 404: source '${source}' not found`);
          res.writeHead(404);
          res.end('source not found');
          return;
        }
        const z = parseInt(zStr), x = parseInt(xStr), y = parseInt(yStr);
        const tmsRow = xyzToTmsRow(z, y);
        const row = db.prepare(
          'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?'
        ).get(z, x, tmsRow);
        if (!row) {
          console.log(`[tile-server] 204: tile not found z=${z} x=${x} y=${y} tmsRow=${tmsRow}`);
          res.writeHead(204);
          res.end();
          return;
        }
        console.log(`[tile-server] 200: tile found z=${z} x=${x} y=${y} size=${row.tile_data.length}`);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': row.tile_data.length });
        res.end(row.tile_data);
        return;
      }

      // --- PMTiles: /pmtiles/{source} with Range ---
      const pmMatch = url.match(/^\/pmtiles\/([^/?]+)/);
      if (pmMatch) {
        const source = decodeURIComponent(pmMatch[1]);
        const src = sources[source];
        if (!src || src.kind !== 'pmtiles') {
          res.writeHead(404);
          res.end('pmtiles source not found');
          return;
        }

        const filePath = src.path;
        let stat;
        try { stat = fs.statSync(filePath); } catch {
          res.writeHead(500);
          res.end('file not found');
          return;
        }
        const fileSize = stat.size;

        res.setHeader('Accept-Ranges', 'bytes');

        const rangeHeader = req.headers['range'];
        if (rangeHeader) {
          const m = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (!m) {
            res.writeHead(416);
            res.end();
            return;
          }
          const start = parseInt(m[1]);
          const end = m[2] ? parseInt(m[2]) : fileSize - 1;
          if (start >= fileSize) {
            res.writeHead(416);
            res.end();
            return;
          }
          const clampedEnd = Math.min(end, fileSize - 1);
          const chunkSize = clampedEnd - start + 1;

          const fd = fs.openSync(filePath, 'r');
          const buf = Buffer.alloc(chunkSize);
          fs.readSync(fd, buf, 0, chunkSize, start);
          fs.closeSync(fd);

          res.writeHead(206, {
            'Content-Type': 'application/octet-stream',
            'Content-Range': `bytes ${start}-${clampedEnd}/${fileSize}`,
            'Content-Length': chunkSize,
          });
          res.end(buf);
        } else {
          const data = fs.readFileSync(filePath);
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileSize,
          });
          res.end(data);
        }
        return;
      }

      res.writeHead(404);
      res.end('not found');
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () => {
          for (const db of Object.values(dbs)) db.close();
          server.close();
        },
      });
    });
  });
}

module.exports = { startTileServer, FIXTURES };
