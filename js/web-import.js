import { importFileContent } from './io.js';

const URL_HANDLERS = [
  {
    name: 'skitour',
    match: /skitour\.fr\/sorties\/(\d+)/,
    resolve: (m) => `https://skitour.fr/downloadGPX/sorties/${m[1]}`,
    format: 'gpx'
  },
  {
    name: 'camptocamp',
    match: /camptocamp\.org\/outings\/(\d+)/,
    resolve: (m) => `https://api.camptocamp.org/outings/${m[1]}`,
    format: 'c2c-json'
  },
  {
    name: 'gulliver-gpx',
    match: /gulliver\.it\/.*\.gpx$/i,
    resolve: (m) => m[0].startsWith('http') ? m[0] : `https://${m[0]}`,
    format: 'gpx'
  },
  {
    name: 'gulliver-page',
    match: /gulliver\.it\/itinerari\//,
    resolve: () => null,
    format: null,
    error: 'Gulliver page URLs are not supported due to CORS. Paste the direct GPX download link instead (right-click \u2192 Copy link on the GPX button).'
  },
  {
    name: 'direct-gpx',
    match: /\.gpx(\?.*)?$/i,
    resolve: (m) => m.input,
    format: 'gpx'
  }
];

function mercatorToLonLat(x, y) {
  const lon = (x / 20037508.342789244) * 180;
  let lat = (y / 20037508.342789244) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(lat * Math.PI / 180)) - Math.PI / 2);
  return [lon, lat];
}

function convertC2cToGpx(data) {
  const geomStr = data.geometry?.geom_detail;
  if (!geomStr) throw new Error("C2C API did not return track geometry");
  const geom = JSON.parse(geomStr);
  
  const title = data.locales?.[0]?.title || 'C2C outing';
  
  const trkpts = geom.coordinates.map(([x, y, ele, ts]) => {
    const [lon, lat] = mercatorToLonLat(x, y);
    const time = ts ? new Date(ts * 1000).toISOString() : '';
    const timeFragment = time ? `<time>${time}</time>` : '';
    const eleFragment = ele != null ? `<ele>${ele.toFixed(1)}</ele>` : '';
    return `      <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">${eleFragment}${timeFragment}</trkpt>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="slope.html (c2c import)" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(title)}</name></metadata>
  <trk>
    <name>${escapeXml(title)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

export async function processUrlImport(url) {
  const statusEl = document.getElementById('importUrlStatus');
  if (statusEl) {
    statusEl.textContent = 'Importing...';
    statusEl.style.display = 'inline-block';
    statusEl.style.color = 'gray';
  }

  try {
    let resolvedUrl = url;
    let format = 'gpx';
    let matchedName = 'direct';

    for (const handler of URL_HANDLERS) {
      const m = url.match(handler.match);
      if (m) {
        if (handler.error) throw new Error(handler.error);
        resolvedUrl = handler.resolve(m);
        format = handler.format;
        matchedName = handler.name;
        break;
      }
    }

    if (!resolvedUrl) throw new Error("Could not parse URL.");

    let resp;
    try {
      resp = await fetch(resolvedUrl);
    } catch (e) {
      throw new Error(`Cannot load: the server doesn't allow cross-origin requests. Try downloading the file and importing it manually.`);
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${matchedName}`);

    let trackContent = '';
    let importName = matchedName + ' track';

    if (format === 'gpx') {
      trackContent = await resp.text();
      // Try to extract title from URL for default naming if track name is empty
      try {
        const urlObj = new URL(url);
        importName = urlObj.pathname.split('/').pop() || importName;
      } catch (e) {}
    } else if (format === 'c2c-json') {
      const data = await resp.json();
      trackContent = convertC2cToGpx(data);
      importName = data.locales?.[0]?.title || importName;
    }

    // Call io's import logic which adds it to the list
    if (trackContent.trim() === '') throw new Error("Empty GPX file");
    
    // We expect importFileContent from io.js. 
    importFileContent(importName, trackContent);

    if (statusEl) {
      statusEl.style.display = 'none';
      statusEl.textContent = '';
    }
  } catch (err) {
    console.error('Import from URL failed', err);
    if (statusEl) {
      statusEl.textContent = err.message || err.toString();
      statusEl.style.color = 'red';
      setTimeout(() => {
         statusEl.style.display = 'none';
      }, 5000);
    }
  }
}

export function initWebImport() {
  const btn = document.getElementById('import-url-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      const url = prompt("Paste GPX URL or Camptocamp/Skitour URL:");
      if (url && url.trim() !== '') {
        processUrlImport(url.trim());
      }
    });
  }

  // Ctrl+V logic on window/document
  document.addEventListener('paste', (e) => {
    // skip if pasting into input fields (e.g. track name edits)
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
    if (!pastedText) return;
    
    const trimmed = pastedText.trim();
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      processUrlImport(trimmed);
    } else if (trimmed.startsWith('<?xml') && trimmed.includes('<gpx')) {
      // pasted raw GPX
      importFileContent('Pasted Track', trimmed);
    }
  });
}
