import { describe, it, expect, vi, beforeEach } from 'vitest';
import { importFileContent, parseGeoJSON } from '../../app/js/io.js';

// importFileContent depends on tracksFns being wired via initIO,
// but we can test the guard and parseGeoJSON directly.

describe('importFileContent — extension guard', () => {
  // importFileContent calls tracksFns internally, so we spy on console.warn
  // to verify unsupported files are rejected before any parsing attempt.

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects .mbtiles files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // This is the exact bug scenario: binary SQLite content passed as text
    expect(() => importFileContent('dummy-z1-z3.mbtiles', 'SQLite format 3\x00...')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'dummy-z1-z3.mbtiles');
  });

  it('rejects .pmtiles files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => importFileContent('tiles.pmtiles', '\x00PMTiles...')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'tiles.pmtiles');
  });

  it('rejects .png files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => importFileContent('image.png', '\x89PNG...')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'image.png');
  });

  it('rejects files with no extension without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => importFileContent('README', 'Hello')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'README');
  });

  it('rejects .txt files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => importFileContent('notes.txt', 'some text')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'notes.txt');
  });

  it('rejects .csv files without throwing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => importFileContent('data.csv', 'lat,lon\n45,6')).not.toThrow();
    expect(warn).toHaveBeenCalledWith('Unsupported file type, skipping:', 'data.csv');
  });
});

describe('parseGeoJSON', () => {
  it('parses a simple LineString Feature', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[6.86, 45.83, 1500], [6.87, 45.84, 1600]] },
      properties: {},
    });
    const result = parseGeoJSON(geojson);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual([[6.86, 45.83, 1500], [6.87, 45.84, 1600]]);
  });

  it('parses a MultiLineString into multiple tracks', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [[6.86, 45.83], [6.87, 45.84]],
          [[6.90, 45.90], [6.91, 45.91]],
        ],
      },
      properties: {},
    });
    const result = parseGeoJSON(geojson);
    expect(result).toHaveLength(2);
  });

  it('parses a FeatureCollection', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[6.86, 45.83]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[7.0, 46.0]] }, properties: {} },
      ],
    });
    const result = parseGeoJSON(geojson);
    expect(result).toHaveLength(2);
  });

  it('ignores non-line geometries (Point, Polygon)', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [6.86, 45.83] }, properties: {} },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[6, 45], [7, 45], [7, 46], [6, 45]]] }, properties: {} },
      ],
    });
    const result = parseGeoJSON(geojson);
    expect(result).toHaveLength(0);
  });

  it('fills null for missing elevation', () => {
    const geojson = JSON.stringify({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[6.86, 45.83], [6.87, 45.84]] },
      properties: {},
    });
    const result = parseGeoJSON(geojson);
    expect(result[0][0]).toEqual([6.86, 45.83, null]);
    expect(result[0][1]).toEqual([6.87, 45.84, null]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseGeoJSON('not json')).toThrow();
  });

  it('returns empty for bare geometry with unsupported type', () => {
    const geojson = JSON.stringify({ type: 'Point', coordinates: [6.86, 45.83] });
    const result = parseGeoJSON(geojson);
    expect(result).toHaveLength(0);
  });
});
