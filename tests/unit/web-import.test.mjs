import { mercatorToLonLat, convertC2cToGpx } from '../../app/js/web-import.js';

// ---- mercatorToLonLat ----

describe('mercatorToLonLat', () => {
  it('converts origin (0,0) to (0°, 0°)', () => {
    const [lon, lat] = mercatorToLonLat(0, 0);
    expect(lon).toBeCloseTo(0, 5);
    expect(lat).toBeCloseTo(0, 5);
  });

  it('converts a known Alpine point', () => {
    // Chamonix: lon=6.8696°, lat=45.9237°; EPSG:3857: x≈764720, y≈5768131
    const [lon, lat] = mercatorToLonLat(764720.374, 5768130.511);
    expect(lon).toBeCloseTo(6.8696, 3);
    expect(lat).toBeCloseTo(45.9237, 3);
  });
});

// ---- convertC2cToGpx ----

const SAMPLE_C2C = {
  locales: [{ title: 'Test outing' }],
  geometry: {
    geom_detail: JSON.stringify({
      type: 'LineString',
      coordinates: [
        [816067.602, 5485013.831, 2107.4, 1643000000],
        [816200.0,  5485100.0,   2120.0, 1643001000],
      ]
    })
  }
};

describe('convertC2cToGpx', () => {
  it('produces valid GPX XML string', () => {
    const gpx = convertC2cToGpx(SAMPLE_C2C);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('<trkpt');
    expect(gpx).toContain('<ele>');
    expect(gpx).toContain('<time>');
  });

  it('uses the title from locales', () => {
    const gpx = convertC2cToGpx(SAMPLE_C2C);
    expect(gpx).toContain('Test outing');
  });

  it('converts coordinates to reasonable lat/lon range', () => {
    const gpx = convertC2cToGpx(SAMPLE_C2C);
    // Should have lat around 44° and lon around 7° for these coordinates
    const latMatch = gpx.match(/lat="([\d.]+)"/);
    const lonMatch = gpx.match(/lon="([\d.]+)"/);
    expect(parseFloat(latMatch[1])).toBeGreaterThan(40);
    expect(parseFloat(latMatch[1])).toBeLessThan(50);
    expect(parseFloat(lonMatch[1])).toBeGreaterThan(5);
    expect(parseFloat(lonMatch[1])).toBeLessThan(10);
  });

  it('throws if geom_detail is missing', () => {
    expect(() => convertC2cToGpx({ locales: [], geometry: {} }))
      .toThrow('C2C API did not return track geometry');
  });

  it('escapes XML special chars in title', () => {
    const data = {
      ...SAMPLE_C2C,
      locales: [{ title: 'Sortie <test> & "fun"' }]
    };
    const gpx = convertC2cToGpx(data);
    expect(gpx).toContain('&lt;test&gt;');
    expect(gpx).toContain('&amp;');
  });
});
