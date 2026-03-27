import {
  clearAll,
  loadProfileSettings,
  loadSettings,
  loadTracks,
  loadWaypoints,
  loadWorkspace,
  saveProfileSettings,
  saveSettings,
  saveTracks,
  saveWaypoints,
  saveWorkspace,
} from '../../js/persist.js';
import { installLocalStorageMock } from './test-helpers.mjs';

let storage;

beforeEach(() => {
  storage = installLocalStorageMock();
});

afterEach(() => {
  storage.cleanup();
});

describe('persist', () => {
  it('round-trips tracks with stable ids and strips internal-only fields', () => {
    saveTracks([
      {
        id: 'trk-1',
        name: 'Morning Loop',
        color: '#ff0000',
        coords: [[6.8, 45.9, 1000]],
        groupId: 'grp-1',
        groupName: 'Loop Day',
        segmentLabel: 'Segment 1',
        _statsCache: { dist: 1.23 },
      },
    ]);

    expect(loadTracks()).toEqual([
      {
        id: 'trk-1',
        name: 'Morning Loop',
        color: '#ff0000',
        coords: [[6.8, 45.9, 1000]],
        groupId: 'grp-1',
        groupName: 'Loop Day',
        segmentLabel: 'Segment 1',
      },
    ]);

    const raw = JSON.parse(storage.localStorage.getItem('slope:tracks'));
    expect(raw[0]._statsCache).toBeUndefined();
  });

  it('round-trips waypoints with ids and export metadata', () => {
    saveWaypoints([
      {
        id: 'wpt-1',
        name: 'Cabin',
        coords: [6.8, 45.9, 1200],
        sym: 'Lodge',
        desc: 'Shelter',
        comment: 'Open in summer',
      },
    ]);

    expect(loadWaypoints()).toEqual([
      {
        id: 'wpt-1',
        name: 'Cabin',
        coords: [6.8, 45.9, 1200],
        sym: 'Lodge',
        desc: 'Shelter',
        comment: 'Open in summer',
      },
    ]);
  });

  it('persists only whitelisted settings keys', () => {
    saveSettings({
      basemap: 'osm',
      mode: 'slope',
      terrain3d: true,
      unknownSetting: 'ignored',
    });

    expect(loadSettings()).toEqual({
      basemap: 'osm',
      mode: 'slope',
      terrain3d: true,
    });
  });

  it('round-trips profile settings as-is', () => {
    saveProfileSettings({ xAxis: 'distance', smoothed: true });
    expect(loadProfileSettings()).toEqual({ xAxis: 'distance', smoothed: true });
  });

  it('persists workspace metadata including waypoint and legacy back-references', () => {
    saveWorkspace({
      children: [
        {
          id: 'file-1',
          type: 'file',
          name: 'Outing.gpx',
          desc: 'Primary file',
          children: [
            {
              id: 'trk-node-1',
              type: 'track',
              name: 'Traverse',
              _legacyTrackIds: ['seg-1', 'seg-2'],
              children: [
                { id: 'seg-node-1', type: 'segment', _legacyTrackId: 'seg-1' },
              ],
            },
          ],
        },
        {
          id: 'wpt-node-1',
          type: 'waypoint',
          name: 'Cabin',
          _waypointId: 'wpt-1',
          sym: 'Lodge',
        },
      ],
    });

    expect(loadWorkspace()).toEqual({
      children: [
        {
          id: 'file-1',
          type: 'file',
          name: 'Outing.gpx',
          desc: 'Primary file',
          children: [
            {
              id: 'trk-node-1',
              type: 'track',
              name: 'Traverse',
              _legacyTrackIds: ['seg-1', 'seg-2'],
              children: [
                { id: 'seg-node-1', type: 'segment', _legacyTrackId: 'seg-1' },
              ],
            },
          ],
        },
        {
          id: 'wpt-node-1',
          type: 'waypoint',
          name: 'Cabin',
          _waypointId: 'wpt-1',
          sym: 'Lodge',
        },
      ],
    });
  });

  it('clears all persisted keys', () => {
    saveTracks([{ id: 'trk-1', name: 'Track', color: '#000', coords: [] }]);
    saveWaypoints([{ id: 'wpt-1', name: 'Waypoint', coords: [0, 0] }]);
    saveSettings({ basemap: 'osm' });
    saveProfileSettings({ xAxis: 'distance' });
    saveWorkspace({ children: [] });

    clearAll();

    expect(loadTracks()).toEqual([]);
    expect(loadWaypoints()).toEqual([]);
    expect(loadSettings()).toBeNull();
    expect(loadProfileSettings()).toBeNull();
    expect(loadWorkspace()).toBeNull();
  });
});