#!/usr/bin/env python3
"""Build synthetic DEM tile fixtures in Terrarium encoding for e2e tests.

Generates a small set of 512x512 tiles around the default map location
(lng=6.8652, lat=45.8326) at zoom levels 10 and 12, encoded as WebP.

Terrarium encoding: elevation = (R * 256 + G + B / 256) - 32768
So for elevation E: R = floor((E + 32768) / 256), G = (E + 32768) % 256, B = 0

Tiles contain a gradient that simulates mountain terrain (500m–4000m range)
to produce visible color-relief rendering in the app.
"""

from __future__ import annotations

import io
import math
import sqlite3
import struct
import zlib
from pathlib import Path

TILE_SIZE = 512  # DEM tiles are 512x512
FIXTURES_DIR = Path(__file__).resolve().parent
DEM_DIR = FIXTURES_DIR / 'dem'
MBTILES_PATH = FIXTURES_DIR / 'dem-synthetic.mbtiles'

# Default map location
DEFAULT_LNG = 6.8652
DEFAULT_LAT = 45.8326

# Tiles to generate: 3x3 grid at z10 and z12 around the default location
def compute_tile_xy(lat: float, lng: float, z: int) -> tuple[int, int]:
    n = 2 ** z
    x = int((lng + 180) / 360 * n)
    lat_rad = math.radians(lat)
    y = int((1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n)
    return x, y


def terrarium_encode(elevation: float) -> tuple[int, int, int]:
    """Encode an elevation value (meters) as Terrarium RGB."""
    val = elevation + 32768.0
    r = int(val / 256) & 0xFF
    g = int(val) & 0xFF
    b = int((val % 1) * 256) & 0xFF
    return r, g, b


def build_dem_tile_png(z: int, x: int, y: int) -> bytes:
    """Create a 512x512 Terrarium-encoded PNG tile with synthetic mountain terrain.

    Features steep ridges, valleys, and sharp gradients to produce visible
    slopes in all analysis modes (slope, color-relief, aspect).
    """
    pixels = bytearray(TILE_SIZE * TILE_SIZE * 3)
    for py in range(TILE_SIZE):
        for px in range(TILE_SIZE):
            # Vertical gradient: 800m at bottom, 3800m at top
            base_elev = 800 + (1 - py / TILE_SIZE) * 3000
            # Sharp ridge/valley pattern — steep enough for slope analysis
            ridge_x = 800 * math.sin(px / TILE_SIZE * math.pi * 6)
            ridge_y = 600 * math.sin(py / TILE_SIZE * math.pi * 8)
            # Diagonal steep feature
            diag = 500 * math.sin((px + py) / TILE_SIZE * math.pi * 4)
            # Tile-position variation
            tile_offset = ((x % 5) - 2) * 400 + ((y % 5) - 2) * 300
            elev = base_elev + ridge_x + ridge_y + diag + tile_offset
            elev = max(0, min(8000, elev))
            r, g, b = terrarium_encode(elev)
            offset = (py * TILE_SIZE + px) * 3
            pixels[offset] = r
            pixels[offset + 1] = g
            pixels[offset + 2] = b
    return encode_png(pixels, TILE_SIZE, TILE_SIZE)


def encode_png(pixels: bytearray, width: int, height: int) -> bytes:
    """Encode raw RGB pixels as a PNG image."""
    import binascii
    def chunk(tag: bytes, payload: bytes) -> bytes:
        crc = binascii.crc32(tag + payload) & 0xFFFFFFFF
        return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', crc)

    rows = bytearray()
    stride = width * 3
    for y_row in range(height):
        rows.append(0)  # filter byte
        start = y_row * stride
        rows.extend(pixels[start:start + stride])
    compressed = zlib.compress(bytes(rows), level=9)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b''.join([
        b'\x89PNG\r\n\x1a\n',
        chunk(b'IHDR', ihdr),
        chunk(b'IDAT', compressed),
        chunk(b'IEND', b''),
    ])


def generate_tile_set() -> list[tuple[int, int, int, bytes]]:
    """Generate tiles for z10 and z12 around the default location."""
    tiles = []
    for z in [10, 12]:
        cx, cy = compute_tile_xy(DEFAULT_LAT, DEFAULT_LNG, z)
        for dx in range(-1, 2):
            for dy in range(-1, 2):
                x, y = cx + dx, cy + dy
                data = build_dem_tile_png(z, x, y)
                tiles.append((z, x, y, data))
    # Also add z=0 tile (MapLibre always requests it)
    tiles.append((0, 0, 0, build_dem_tile_png(0, 0, 0)))
    return tiles


def write_png_files(tiles: list[tuple[int, int, int, bytes]]) -> None:
    """Write tiles as individual PNG files for direct HTTP serving."""
    DEM_DIR.mkdir(parents=True, exist_ok=True)
    for z, x, y, data in tiles:
        out_path = DEM_DIR / str(z) / str(x) / f'{y}.png'
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(data)


def build_mbtiles(tiles: list[tuple[int, int, int, bytes]]) -> None:
    """Create an MBTiles archive from the DEM tiles."""
    if MBTILES_PATH.exists():
        MBTILES_PATH.unlink()
    conn = sqlite3.connect(MBTILES_PATH)
    try:
        conn.executescript('''
            CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE tiles (
                zoom_level INTEGER NOT NULL,
                tile_column INTEGER NOT NULL,
                tile_row INTEGER NOT NULL,
                tile_data BLOB NOT NULL
            );
            CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
        ''')
        metadata = {
            'name': 'dem-synthetic',
            'type': 'overlay',
            'version': '1.0.0',
            'description': 'Synthetic DEM tiles (Terrarium encoding) for e2e tests.',
            'format': 'png',
            'minzoom': '0',
            'maxzoom': '12',
            'bounds': f'{DEFAULT_LNG - 1},{DEFAULT_LAT - 1},{DEFAULT_LNG + 1},{DEFAULT_LAT + 1}',
            'center': f'{DEFAULT_LNG},{DEFAULT_LAT},12',
        }
        conn.executemany(
            'INSERT INTO metadata(name, value) VALUES (?, ?)',
            list(metadata.items()),
        )
        rows = []
        for z, x, y, data in tiles:
            tms_y = (1 << z) - 1 - y
            rows.append((z, x, tms_y, sqlite3.Binary(data)))
        conn.executemany(
            'INSERT INTO tiles(zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)',
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def main() -> None:
    tiles = generate_tile_set()
    write_png_files(tiles)
    build_mbtiles(tiles)
    print(f'Generated {len(tiles)} synthetic DEM tiles')
    print(f'  PNG files: {DEM_DIR}')
    print(f'  MBTiles:   {MBTILES_PATH}')


if __name__ == '__main__':
    main()
