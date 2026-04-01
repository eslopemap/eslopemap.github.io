import { marked } from 'marked';

const pages = [
  {
    id: 'intro',
    label: 'Quick start',
    title: 'Get started with Slope Mapper',
    summary: 'Open the map, choose a terrain view, import a GPX file, and move into editing or profile analysis.',
    path: './content/intro.md'
  },
  {
    id: 'map-and-visualization',
    label: 'Map and visualization',
    title: 'Read the terrain layers',
    summary: 'Switch between slope, aspect, color-relief, contours, and regional overlays without leaving the main map.',
    path: './content/map-and-visualization.md'
  },
  {
    id: 'track-editing',
    label: 'Track editing',
    title: 'Create and edit tracks',
    summary: 'Draw tracks, select vertices, insert points, and use selection-based geometry tools from the workspace panel.',
    path: './content/track-editing.md'
  },
  {
    id: 'profile',
    label: 'Elevation profile',
    title: 'Inspect elevation and timing',
    summary: 'Use the profile panel to compare elevation, slope, pauses, and time-based views for the active track.',
    path: './content/profile.md'
  },
  {
    id: 'import-export',
    label: 'Import and export',
    title: 'Move files in and out',
    summary: 'Import GPX or GeoJSON files, work with grouped tracks and routes, then export the active item or the full workspace.',
    path: './content/import-export.md'
  },
  {
    id: 'settings-and-mobile',
    label: 'Settings and mobile',
    title: 'Tune the interface',
    summary: 'Adjust analysis opacity, 3D terrain, profile smoothing, and mobile editing behavior to match the task.',
    path: './content/settings-and-mobile.md'
  },
  {
    id: 'faq',
    label: 'FAQ',
    title: 'Common questions',
    summary: 'Short answers for the most common workflow questions and limitations.',
    path: './content/faq.md'
  }
];

const pageMap = new Map(pages.map((page) => [page.id, page]));
const navEl = document.getElementById('docs-nav');
const titleEl = document.getElementById('docs-title');
const summaryEl = document.getElementById('docs-summary');
const kickerEl = document.getElementById('docs-kicker');
const contentEl = document.getElementById('docs-content');

marked.setOptions({
  gfm: true,
  headerIds: false,
  mangle: false
});

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildNav() {
  navEl.innerHTML = pages.map((page) => (
    `<a class="docs-nav-link" href="#${page.id}" data-page="${page.id}">${page.label}</a>`
  )).join('');
}

function markActiveLink(pageId) {
  for (const link of navEl.querySelectorAll('.docs-nav-link')) {
    const isActive = link.dataset.page === pageId;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function decorateContent() {
  for (const heading of contentEl.querySelectorAll('h2, h3')) {
    if (!heading.id) {
      heading.id = slugify(heading.textContent || 'section');
    }
  }

  for (const link of contentEl.querySelectorAll('a[href^="http"]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noreferrer');
  }
}

async function renderPage() {
  const pageId = window.location.hash.replace(/^#/, '') || pages[0].id;
  const page = pageMap.get(pageId) || pages[0];
  kickerEl.textContent = page.label;
  titleEl.textContent = page.title;
  summaryEl.textContent = page.summary;
  markActiveLink(page.id);
  contentEl.innerHTML = '<p class="loading-state">Loading page...</p>';

  try {
    const response = await fetch(page.path);
    if (!response.ok) {
      throw new Error(`Failed to load ${page.path}`);
    }
    const markdown = await response.text();
    contentEl.innerHTML = marked.parse(markdown);
    decorateContent();
    document.title = `${page.title} | Slope Mapper User Guide`;
  } catch (error) {
    contentEl.innerHTML = `
      <div class="callout error">
        <strong>Page unavailable.</strong>
        <p>${error.message}</p>
      </div>
    `;
  }
}

buildNav();
window.addEventListener('hashchange', renderPage);
renderPage();
