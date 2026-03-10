// Extracted from track-bug.html (Approach A2)
// Demonstrates the mixed filter form that triggers the bug:
// ['all', ['==', '$type', 'Point'], ['case', ... ['global-state', ...] ...]]

const isActive = ['==', ['get', 'id'], ['global-state', 'activeTrackId']];

map.addLayer({
  id: 'pts-A2',
  type: 'circle',
  source: 'src-A2',
  filter: [
    'all',
    ['==', '$type', 'Point'],
    ['case', isActive, true,
      ['any',
        ['==', ['get', 'role'], 'start'],
        ['==', ['get', 'role'], 'end']
      ]
    ]
  ],
  paint: {
    'circle-radius': ['case', isActive,
      ['match', ['get', 'role'], 'insert', 3, 4],
      3
    ],
    'circle-color': ['match', ['get', 'role'],
      'start', '#22c55e',
      'end', '#ef4444',
      'insert', 'rgba(128,128,128,0.5)',
      '#06b6d4'
    ],
    'circle-stroke-color': '#fff',
    'circle-stroke-width': ['case', isActive,
      ['match', ['get', 'role'], 'insert', 0.5, 1.5],
      1
    ]
  }
});

map.setGlobalStateProperty('activeTrackId', 'A2');
