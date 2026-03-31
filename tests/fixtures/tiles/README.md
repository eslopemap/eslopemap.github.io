# Spike 1 tile fixtures

This directory contains the deterministic raster fixture used by both Spike 1 MBTiles demonstrators:

- `dummy-z1-z3.mbtiles`
- `src_png/<z>/<x>/<y>.png`
- `build_dummy_mbtiles.py`

## Purpose

The fixture gives both demos the exact same raster dataset so only the transport path changes:

- `mbtiles_to_localhost` serves these tiles over `http://127.0.0.1:<port>/tiles/...`
- `mbtiles_custom_protocol` serves the same content over `mbtiles-demo://...`

## Rebuild

Run the generator from the repository root:

```bash
python3 tests/fixtures/tiles/build_dummy_mbtiles.py
```

The script:

- regenerates all source PNGs for z1/z2/z3
- writes deterministic tile labels containing `z`, `x`, and `y`
- rebuilds `dummy-z1-z3.mbtiles`
- stores tiles in MBTiles using the correct TMS row conversion

## Notes

- The generator uses only the Python standard library.
- The output is deterministic and safe to commit.
- Both the PNG sources and MBTiles file are expected to stay in version control for repeatable spike comparisons.
