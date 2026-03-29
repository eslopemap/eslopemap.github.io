import { buildGpxDocument } from '../../js/io.js';

describe('GPX round-trip', () => {
  it('exports multi-track multi-segment GPX with correct structure', () => {
    const payload = {
      name: 'MyFile',
      desc: 'A test file',
      tracks: [
        {
          name: 'Track A',
          desc: 'First track',
          cmt: 'comment A',
          type: 'hiking',
          segments: [
            [[6.1, 45.1, 100], [6.2, 45.2, 200]],
          ],
        },
        {
          name: 'Track B',
          desc: 'Second track with 2 segs',
          cmt: '',
          type: '',
          segments: [
            [[7.1, 46.1, 300], [7.2, 46.2, 400]],
            [[8.1, 47.1, 500], [8.2, 47.2, 600]],
          ],
        },
      ],
      routes: [
        {
          name: 'Route C',
          desc: 'A route',
          cmt: '',
          type: '',
          coords: [[9.1, 48.1, 700], [9.2, 48.2, 800]],
        },
      ],
      waypoints: [
        {
          name: 'Summit',
          desc: 'Top of mountain',
          cmt: 'Nice view',
          sym: 'Peak',
          type: '',
          coords: [6.5, 45.5, 3000],
        },
      ],
    };

    const gpx = buildGpxDocument(payload);

    // Verify XML structure
    expect(gpx).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(gpx).toContain('<gpx version="1.1"');

    // Track A — single segment
    expect(gpx).toContain('<name>Track A</name>');
    expect(gpx).toContain('<desc>First track</desc>');
    expect(gpx).toContain('<type>hiking</type>');

    // Track B — two segments (two <trkseg> blocks)
    expect(gpx).toContain('<name>Track B</name>');
    const trksegs = gpx.match(/<trkseg>/g);
    // Track A has 1 + Track B has 2 = 3 total
    expect(trksegs).toHaveLength(3);

    // Track B segment 1 point
    expect(gpx).toContain('lat="46.1" lon="7.1"');
    // Track B segment 2 point
    expect(gpx).toContain('lat="47.1" lon="8.1"');

    // Route
    expect(gpx).toContain('<rte>');
    expect(gpx).toContain('<name>Route C</name>');
    expect(gpx).toContain('<rtept lat="48.1" lon="9.1"');

    // Waypoint
    expect(gpx).toContain('<wpt lat="45.5" lon="6.5"');
    expect(gpx).toContain('<name>Summit</name>');
    expect(gpx).toContain('<sym>Peak</sym>');

    // Verify ordering: wpt before rte before trk
    const wptIdx = gpx.indexOf('<wpt');
    const rteIdx = gpx.indexOf('<rte>');
    const trkIdx = gpx.indexOf('<trk>');
    expect(wptIdx).toBeLessThan(rteIdx);
    expect(rteIdx).toBeLessThan(trkIdx);
  });

  it('exports timestamps when present', () => {
    const ts = new Date('2025-06-15T10:30:00Z').getTime();
    const payload = {
      name: 'Timed',
      desc: '',
      tracks: [{
        name: 'T',
        desc: '',
        cmt: '',
        type: '',
        segments: [[[6.1, 45.1, 100, ts]]],
      }],
      routes: [],
      waypoints: [],
    };
    const gpx = buildGpxDocument(payload);
    expect(gpx).toContain('<time>2025-06-15T10:30:00.000Z</time>');
  });

  it('round-trips multi-track structure through tree export', () => {
    // Simulate a file node whose tracks have been imported:
    // File "MyHike" → Track A (1 seg), Track B (2 segs)
    // buildPayloadFromNode would produce:
    const payload = {
      name: 'MyHike',
      desc: '',
      tracks: [
        {
          name: 'Track A',
          desc: 'desc-a',
          cmt: 'cmt-a',
          type: 'hiking',
          segments: [
            [[6.1, 45.1, 100], [6.2, 45.2, 200]],
          ],
        },
        {
          name: 'Track B',
          desc: 'desc-b',
          cmt: 'cmt-b',
          type: '',
          segments: [
            [[7.0, 46.0, 300], [7.1, 46.1, 350]],
            [[8.0, 47.0, 400], [8.1, 47.1, 450]],
          ],
        },
      ],
      routes: [],
      waypoints: [],
    };

    const gpx = buildGpxDocument(payload);

    // Verify 2 <trk> elements
    const trks = gpx.match(/<trk>/g);
    expect(trks).toHaveLength(2);

    // Track A: 1 trkseg with 2 trkpt
    const trackAStart = gpx.indexOf('<name>Track A</name>');
    const trackBStart = gpx.indexOf('<name>Track B</name>');
    expect(trackAStart).toBeGreaterThan(-1);
    expect(trackBStart).toBeGreaterThan(trackAStart);

    const trackASection = gpx.slice(trackAStart, trackBStart);
    const trackBSection = gpx.slice(trackBStart);

    expect(trackASection.match(/<trkseg>/g)).toHaveLength(1);
    expect(trackASection.match(/<trkpt /g)).toHaveLength(2);

    // Track B: 2 trkseg
    expect(trackBSection.match(/<trkseg>/g)).toHaveLength(2);
    expect(trackBSection.match(/<trkpt /g)).toHaveLength(4);

    // Verify metadata preserved
    expect(gpx).toContain('<desc>desc-a</desc>');
    expect(gpx).toContain('<cmt>cmt-a</cmt>');
    expect(gpx).toContain('<desc>desc-b</desc>');
  });

  it('escapes XML special characters in names and descriptions', () => {
    const payload = {
      name: 'Test & <Special>',
      desc: '"quotes" & ampersands',
      tracks: [{
        name: 'Track <A> & B',
        desc: '',
        cmt: '',
        type: '',
        segments: [[[0, 0, 0]]],
      }],
      routes: [],
      waypoints: [],
    };
    const gpx = buildGpxDocument(payload);
    expect(gpx).toContain('<name>Test &amp; &lt;Special&gt;</name>');
    expect(gpx).toContain('<name>Track &lt;A&gt; &amp; B</name>');
  });
});
