#!/usr/bin/env python3
"""Build deterministic PNG tile fixtures and a matching MBTiles archive."""

from __future__ import annotations

import binascii
import sqlite3
import struct
import zlib
from pathlib import Path

TILE_SIZE = 256
TEXT_SCALE = 5
BORDER_WIDTH = 6
FONT_WIDTH = 5
FONT_HEIGHT = 7
PNG_DIR = Path(__file__).resolve().parent / 'src_png'
MBTILES_PATH = Path(__file__).resolve().parent / 'dummy-z1-z3.mbtiles'

ZOOM_COLORS = {
    1: (224, 99, 99),
    2: (75, 162, 116),
    3: (72, 132, 212),
}

# Bitmask to draw each given character as a 5x7 grid
FONT = {
    '0': ('01110', '10001', '10011', '10101', '11001', '10001', '01110'),
    '1': ('00100', '01100', '00100', '00100', '00100', '00100', '01110'),
    '2': ('01110', '10001', '00001', '00010', '00100', '01000', '11111'),
    '3': ('11110', '00001', '00001', '01110', '00001', '00001', '11110'),
    '4': ('00010', '00110', '01010', '10010', '11111', '00010', '00010'),
    '5': ('11111', '10000', '10000', '11110', '00001', '00001', '11110'),
    '6': ('01110', '10000', '10000', '11110', '10001', '10001', '01110'),
    '7': ('11111', '00001', '00010', '00100', '01000', '01000', '01000'),
    '8': ('01110', '10001', '10001', '01110', '10001', '10001', '01110'),
    '9': ('01110', '10001', '10001', '01111', '00001', '00001', '01110'),
    'x': ('10001', '01010', '00100', '00100', '00100', '01010', '10001'),
    'y': ('10001', '01010', '00100', '00100', '00100', '00100', '00100'),
    'z': ('11111', '00010', '00100', '00100', '01000', '10000', '11111'),
    '=': ('00000', '11111', '00000', '11111', '00000', '00000', '00000'),
}


def ensure_dirs() -> None:
    """Ensure the fixture output directory exists."""
    PNG_DIR.mkdir(parents=True, exist_ok=True)



def chunk(tag: bytes, payload: bytes) -> bytes:
    """Encode a PNG chunk."""
    crc = binascii.crc32(tag + payload) & 0xFFFFFFFF
    return struct.pack('>I', len(payload)) + tag + payload + struct.pack('>I', crc)



def encode_png(pixels: bytearray, width: int, height: int) -> bytes:
    """Encode raw RGB pixels as a deterministic PNG image."""
    rows = bytearray()
    stride = width * 3
    for y in range(height):
        rows.append(0)
        start = y * stride
        rows.extend(pixels[start:start + stride])
    compressed = zlib.compress(bytes(rows), level=9)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0)
    return b''.join([
        b'\x89PNG\r\n\x1a\n',
        chunk(b'IHDR', ihdr),
        chunk(b'IDAT', compressed),
        chunk(b'IEND', b''),
    ])



def set_pixel(pixels: bytearray, x: int, y: int, color: tuple[int, int, int]) -> None:
    """Write one RGB pixel when it falls inside the image bounds."""
    if x < 0 or y < 0 or x >= TILE_SIZE or y >= TILE_SIZE:
        return
    offset = (y * TILE_SIZE + x) * 3
    pixels[offset:offset + 3] = bytes(color)



def draw_rect_outline(pixels: bytearray, left: int, top: int, right: int, bottom: int, color: tuple[int, int, int], width: int) -> None:
    """Draw a rectangle outline."""
    for stroke in range(width):
        for x in range(left + stroke, right - stroke + 1):
            set_pixel(pixels, x, top + stroke, color)
            set_pixel(pixels, x, bottom - stroke, color)
        for y in range(top + stroke, bottom - stroke + 1):
            set_pixel(pixels, left + stroke, y, color)
            set_pixel(pixels, right - stroke, y, color)



def draw_glyph(pixels: bytearray, left: int, top: int, glyph: tuple[str, ...], color: tuple[int, int, int], scale: int) -> None:
    """Draw a single bitmap glyph."""
    for row_index, row in enumerate(glyph):
        for col_index, bit in enumerate(row):
            if bit != '1':
                continue
            for dx in range(scale):
                for dy in range(scale):
                    set_pixel(pixels, left + col_index * scale + dx, top + row_index * scale + dy, color)



def draw_text_centered(pixels: bytearray, top: int, text: str, color: tuple[int, int, int], scale: int) -> None:
    """Draw one centered line of text using the embedded bitmap font."""
    glyphs = [FONT[ch] for ch in text]
    spacing = scale
    width = len(glyphs) * FONT_WIDTH * scale + max(0, len(glyphs) - 1) * spacing
    left = (TILE_SIZE - width) // 2
    cursor = left
    for glyph in glyphs:
        draw_glyph(pixels, cursor, top, glyph, color, scale)
        cursor += FONT_WIDTH * scale + spacing



def build_tile_png(z: int, x: int, y: int) -> bytes:
    """Create one deterministic raster tile image for the given XYZ coordinate."""
    background = ZOOM_COLORS[z]
    pixels = bytearray(background * TILE_SIZE * TILE_SIZE)
    border = (22, 22, 22)
    text = (255, 255, 255)
    draw_rect_outline(pixels, 10, 10, TILE_SIZE - 11, TILE_SIZE - 11, border, BORDER_WIDTH)
    lines = [f'z={z}', f'x={x}', f'y={y}']
    total_height = len(lines) * FONT_HEIGHT * TEXT_SCALE + (len(lines) - 1) * (TEXT_SCALE * 2)
    top = (TILE_SIZE - total_height) // 2
    for index, line in enumerate(lines):
        line_top = top + index * (FONT_HEIGHT * TEXT_SCALE + TEXT_SCALE * 2)
        draw_text_centered(pixels, line_top, line, text, TEXT_SCALE)
    return encode_png(pixels, TILE_SIZE, TILE_SIZE)



def write_png_fixtures() -> list[tuple[int, int, int, bytes]]:
    """Write the PNG source tiles and return their raw bytes for MBTiles insertion."""
    tiles: list[tuple[int, int, int, bytes]] = []
    for z in range(1, 4):
        limit = 2 ** z
        for x in range(limit):
            for y in range(limit):
                data = build_tile_png(z, x, y)
                out_path = PNG_DIR / str(z) / str(x) / f'{y}.png'
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_bytes(data)
                tiles.append((z, x, y, data))
    return tiles



def build_mbtiles(tiles: list[tuple[int, int, int, bytes]]) -> None:
    """Create the MBTiles archive from the generated XYZ PNG fixtures."""
    if MBTILES_PATH.exists():
        MBTILES_PATH.unlink()
    conn = sqlite3.connect(MBTILES_PATH)
    try:
        conn.executescript(
            '''
            CREATE TABLE metadata (name TEXT NOT NULL, value TEXT NOT NULL);
            CREATE TABLE tiles (
                zoom_level INTEGER NOT NULL,
                tile_column INTEGER NOT NULL,
                tile_row INTEGER NOT NULL,
                tile_data BLOB NOT NULL
            );
            CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
            '''
        )
        metadata = {
            'name': 'dummy-z1-z3',
            'type': 'baselayer',
            'version': '1.0.0',
            'description': 'Deterministic raster fixture for Tauri MBTiles spike demos.',
            'format': 'png',
            'minzoom': '1',
            'maxzoom': '3',
            'bounds': '-180.0,-85.051129,180.0,85.051129',
            'center': '0.0,0.0,2',
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
    """Generate the full PNG source set and the MBTiles fixture."""
    ensure_dirs()
    tiles = write_png_fixtures()
    build_mbtiles(tiles)
    print(f'Wrote {len(tiles)} PNG tiles into {PNG_DIR}')
    print(f'Wrote MBTiles fixture into {MBTILES_PATH}')


if __name__ == '__main__':
    main()
