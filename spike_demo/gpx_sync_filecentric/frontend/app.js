// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

const isTauri = Boolean(window.__TAURI_INTERNALS__);

async function tauriInvoke(cmd, args) {
    if (!isTauri) throw new Error('Not in Tauri runtime');
    return window.__TAURI_INTERNALS__.invoke(cmd, args);
}

async function tauriListen(event, handler) {
    if (!isTauri) return () => {};
    // Use the Tauri event system
    return window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
        event,
        handler: window.__TAURI_INTERNALS__.convertCallback(handler),
    });
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let watchedFolder = null;
/** @type {Map<string, {path:string, status:string, content_hash:string, mtime_secs:number}>} */
const fileStates = new Map();
let selectedPath = null;
let editorContent = '';      // current editor text
let originalContent = '';    // content at load time (to detect app-side dirtiness)
let diskConflictContent = null; // latest disk content during conflict

// File System Access API handle (browser mode)
let browserDirHandle = null;

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------

const $folderPath = document.getElementById('folder-path');
const $runtimeBadge = document.getElementById('runtime-badge');
const $btnWatch = document.getElementById('btn-watch');
const $btnSave = document.getElementById('btn-save');
const $btnReload = document.getElementById('btn-reload');
const $btnSimulate = document.getElementById('btn-simulate');
const $fileList = document.getElementById('file-list');
const $editorArea = document.getElementById('editor-area');
const $editor = document.getElementById('editor');
const $editorPlaceholder = document.getElementById('editor-placeholder');
const $editorTitle = document.getElementById('editor-title');
const $conflictBar = document.getElementById('conflict-bar');
const $btnKeepMine = document.getElementById('btn-keep-mine');
const $btnKeepDisk = document.getElementById('btn-keep-disk');
const $logEntries = document.getElementById('log-entries');
const $btnClearLog = document.getElementById('btn-clear-log');

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

function init() {
    $runtimeBadge.textContent = isTauri ? 'Tauri' : 'Browser';
    $runtimeBadge.className = isTauri ? 'tauri' : 'browser';

    $btnWatch.addEventListener('click', onWatchFolder);
    $btnSave.addEventListener('click', onSave);
    $btnReload.addEventListener('click', onReload);
    $btnSimulate.addEventListener('click', onSimulateExternalChange);
    $btnKeepMine.addEventListener('click', () => onResolveConflict('app'));
    $btnKeepDisk.addEventListener('click', () => onResolveConflict('disk'));
    $btnClearLog.addEventListener('click', () => { $logEntries.innerHTML = ''; });

    $editor.addEventListener('input', onEditorInput);

    if (isTauri) {
        setupTauriEvents();
    }

    // Hide simulate button in Tauri (real FS events work)
    if (isTauri) {
        $btnSimulate.style.display = 'none';
    }

    updateUI();
}

// ---------------------------------------------------------------------------
// Tauri event listener
// ---------------------------------------------------------------------------

function setupTauriEvents() {
    // Use the core event listener
    if (window.__TAURI_INTERNALS__) {
        const handler = (event) => {
            const events = event.payload;
            if (!Array.isArray(events)) return;
            for (const ev of events) {
                handleSyncEvent(ev);
            }
        };
        // Register the event listener via Tauri internals
        window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
            event: 'gpx:sync-events',
            target: { kind: 'Any' },
            handler: window.__TAURI_INTERNALS__.convertCallback(handler),
        });
    }
}

// ---------------------------------------------------------------------------
// Watch folder
// ---------------------------------------------------------------------------

async function onWatchFolder() {
    if (isTauri) {
        await onWatchFolderTauri();
    } else {
        await onWatchFolderBrowser();
    }
}

async function onWatchFolderTauri() {
    try {
        // Use the Tauri dialog to pick a folder
        const result = await window.__TAURI_INTERNALS__.invoke('plugin:dialog|open', {
            directory: true,
            multiple: false,
            title: 'Select GPX folder to watch',
        });
        if (!result) return;

        const folderPath = typeof result === 'string' ? result : result.path;
        const pickResult = await tauriInvoke('pick_and_watch_folder', { folderPath });
        watchedFolder = pickResult.snapshot.folder;
        syncFilesFromSnapshot(pickResult.snapshot);
        logEvent('watch', `Watching: ${watchedFolder}`);
    } catch (err) {
        logEvent('error', `Watch failed: ${err}`);
    }
}

async function onWatchFolderBrowser() {
    try {
        if (!('showDirectoryPicker' in window)) {
            logEvent('error', 'File System Access API not supported in this browser');
            return;
        }
        browserDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
        watchedFolder = browserDirHandle.name;
        await scanBrowserFolder();
        logEvent('watch', `Watching (browser): ${watchedFolder}`);
        // Start polling for changes
        startBrowserPolling();
    } catch (err) {
        if (err.name !== 'AbortError') {
            logEvent('error', `Watch failed: ${err}`);
        }
    }
}

// ---------------------------------------------------------------------------
// Browser mode: File System Access API
// ---------------------------------------------------------------------------

let browserPollingTimer = null;
const browserFileHashes = new Map(); // path -> hash

async function scanBrowserFolder() {
    fileStates.clear();
    browserFileHashes.clear();
    for await (const [name, handle] of browserDirHandle.entries()) {
        if (handle.kind === 'file' && name.endsWith('.gpx')) {
            const file = await handle.getFile();
            const text = await file.text();
            const hash = await hashString(text);
            const path = name;
            browserFileHashes.set(path, hash);
            fileStates.set(path, {
                path,
                status: 'clean',
                content_hash: hash,
                mtime_secs: Math.floor(file.lastModified / 1000),
            });
        }
    }
    updateUI();
}

function startBrowserPolling() {
    if (browserPollingTimer) clearInterval(browserPollingTimer);
    browserPollingTimer = setInterval(pollBrowserFolder, 1500);
}

async function pollBrowserFolder() {
    if (!browserDirHandle) return;
    const currentPaths = new Set();

    for await (const [name, handle] of browserDirHandle.entries()) {
        if (handle.kind === 'file' && name.endsWith('.gpx')) {
            currentPaths.add(name);
            const file = await handle.getFile();
            const text = await file.text();
            const hash = await hashString(text);
            const oldHash = browserFileHashes.get(name);

            if (!fileStates.has(name)) {
                // New file
                browserFileHashes.set(name, hash);
                fileStates.set(name, {
                    path: name,
                    status: 'clean',
                    content_hash: hash,
                    mtime_secs: Math.floor(file.lastModified / 1000),
                });
                handleSyncEvent({ kind: 'file_added', path: name, content: text });
            } else if (oldHash && oldHash !== hash) {
                // Changed
                browserFileHashes.set(name, hash);
                const state = fileStates.get(name);
                if (state.status === 'dirty_in_app' || state.status === 'conflict') {
                    handleSyncEvent({ kind: 'conflict', path: name, disk_content: text });
                } else {
                    handleSyncEvent({ kind: 'file_changed', path: name, content: text });
                }
            }
        }
    }

    // Detect deletions
    for (const [path] of fileStates) {
        if (!currentPaths.has(path)) {
            handleSyncEvent({ kind: 'file_removed', path });
        }
    }
}

async function hashString(str) {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Sync event handling
// ---------------------------------------------------------------------------

function handleSyncEvent(event) {
    const kind = event.kind;
    const path = event.path || event.old_path || '';
    const shortPath = path.split('/').pop() || path;

    switch (kind) {
        case 'file_added': {
            fileStates.set(path, {
                path,
                status: 'clean',
                content_hash: '',
                mtime_secs: 0,
            });
            logEvent('file_added', shortPath);
            break;
        }
        case 'file_changed': {
            const state = fileStates.get(path);
            if (state) {
                state.status = 'changed_on_disk';
            }
            // Auto-reload if this is the selected file and it was clean
            if (path === selectedPath && originalContent === editorContent) {
                editorContent = event.content;
                originalContent = event.content;
                $editor.value = editorContent;
                if (state) state.status = 'clean';
                if (isTauri) {
                    tauriInvoke('accept_change', { path }).catch(() => {});
                } else {
                    browserFileHashes.set(path, '');
                    hashString(event.content).then(h => browserFileHashes.set(path, h));
                }
                logEvent('reload', `Auto-reloaded: ${shortPath}`);
            } else {
                logEvent('file_changed', shortPath);
            }
            break;
        }
        case 'file_removed': {
            fileStates.delete(path);
            if (path === selectedPath) {
                selectedPath = null;
                editorContent = '';
                originalContent = '';
                diskConflictContent = null;
            }
            browserFileHashes.delete(path);
            logEvent('file_removed', shortPath);
            break;
        }
        case 'file_renamed': {
            const oldState = fileStates.get(event.old_path);
            fileStates.delete(event.old_path);
            fileStates.set(event.new_path, {
                ...(oldState || {}),
                path: event.new_path,
                status: 'clean',
            });
            if (selectedPath === event.old_path) {
                selectedPath = event.new_path;
            }
            logEvent('file_renamed', `${event.old_path.split('/').pop()} → ${event.new_path.split('/').pop()}`);
            break;
        }
        case 'conflict': {
            const cstate = fileStates.get(path);
            if (cstate) cstate.status = 'conflict';
            diskConflictContent = event.disk_content;
            logEvent('conflict', `CONFLICT: ${shortPath}`);
            break;
        }
    }

    updateUI();
}

// ---------------------------------------------------------------------------
// File state helpers
// ---------------------------------------------------------------------------

function syncFilesFromSnapshot(snapshot) {
    fileStates.clear();
    for (const f of snapshot.files) {
        fileStates.set(f.path, f);
    }
    selectedPath = null;
    editorContent = '';
    originalContent = '';
    diskConflictContent = null;
    updateUI();
}

// ---------------------------------------------------------------------------
// UI updates
// ---------------------------------------------------------------------------

function updateUI() {
    // Folder path
    $folderPath.textContent = watchedFolder || 'No folder selected';

    // File list
    $fileList.innerHTML = '';
    const sortedFiles = [...fileStates.values()].sort((a, b) =>
        a.path.localeCompare(b.path)
    );

    for (const f of sortedFiles) {
        const shortName = f.path.split('/').pop() || f.path;
        const item = document.createElement('div');
        item.className = 'file-item' + (f.path === selectedPath ? ' selected' : '');
        item.innerHTML = `
            <span class="status-dot ${f.status}"></span>
            <span class="filename">${shortName}</span>
            ${f.status !== 'clean' ? `<span class="status-label ${f.status}">${f.status.replace(/_/g, ' ')}</span>` : ''}
        `;
        item.addEventListener('click', () => selectFile(f.path));
        $fileList.appendChild(item);
    }

    // Editor visibility
    const hasFile = selectedPath !== null;
    $editor.style.display = hasFile ? 'block' : 'none';
    $editorPlaceholder.style.display = hasFile ? 'none' : 'flex';
    $editorTitle.textContent = hasFile ? (selectedPath.split('/').pop() || selectedPath) : '';

    // Buttons
    $btnSave.disabled = !hasFile || editorContent === originalContent;
    $btnReload.disabled = !hasFile;

    // Conflict bar
    const currentState = selectedPath ? fileStates.get(selectedPath) : null;
    const isConflict = currentState && currentState.status === 'conflict';
    $conflictBar.classList.toggle('visible', isConflict);
}

// ---------------------------------------------------------------------------
// File selection
// ---------------------------------------------------------------------------

async function selectFile(path) {
    selectedPath = path;
    diskConflictContent = null;

    try {
        let content;
        if (isTauri) {
            content = await tauriInvoke('load_gpx', { path });
        } else {
            // Browser: read from File System Access API handle
            content = await readBrowserFile(path);
        }
        editorContent = content;
        originalContent = content;
        $editor.value = content;
    } catch (err) {
        logEvent('error', `Failed to load: ${err}`);
        editorContent = '';
        originalContent = '';
        $editor.value = '';
    }

    updateUI();
}

async function readBrowserFile(name) {
    if (!browserDirHandle) throw new Error('No directory handle');
    const fileHandle = await browserDirHandle.getFileHandle(name);
    const file = await fileHandle.getFile();
    return file.text();
}

// ---------------------------------------------------------------------------
// Editor input
// ---------------------------------------------------------------------------

function onEditorInput() {
    editorContent = $editor.value;
    const isDirty = editorContent !== originalContent;

    if (isDirty && selectedPath) {
        const state = fileStates.get(selectedPath);
        if (state && state.status === 'clean') {
            state.status = 'dirty_in_app';
            if (isTauri) {
                tauriInvoke('mark_dirty', { path: selectedPath }).catch(() => {});
            }
            logEvent('app_dirty', selectedPath.split('/').pop());
        }
    }

    updateUI();
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

async function onSave() {
    if (!selectedPath) return;

    try {
        if (isTauri) {
            await tauriInvoke('save_gpx', { path: selectedPath, content: editorContent });
        } else {
            await writeBrowserFile(selectedPath, editorContent);
            const hash = await hashString(editorContent);
            browserFileHashes.set(selectedPath, hash);
        }

        originalContent = editorContent;
        const state = fileStates.get(selectedPath);
        if (state) {
            state.status = 'clean';
            state.content_hash = await hashString(editorContent);
        }
        diskConflictContent = null;
        logEvent('app_save', selectedPath.split('/').pop());
        updateUI();
    } catch (err) {
        logEvent('error', `Save failed: ${err}`);
    }
}

async function writeBrowserFile(name, content) {
    if (!browserDirHandle) throw new Error('No directory handle');
    const fileHandle = await browserDirHandle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

// ---------------------------------------------------------------------------
// Reload from disk
// ---------------------------------------------------------------------------

async function onReload() {
    if (!selectedPath) return;
    await selectFile(selectedPath);
    const state = fileStates.get(selectedPath);
    if (state) {
        state.status = 'clean';
        if (isTauri) {
            tauriInvoke('accept_change', { path: selectedPath }).catch(() => {});
        }
    }
    logEvent('reload', selectedPath.split('/').pop());
    updateUI();
}

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

async function onResolveConflict(keep) {
    if (!selectedPath) return;

    try {
        let resolvedContent;
        if (isTauri) {
            resolvedContent = await tauriInvoke('resolve_conflict', {
                path: selectedPath,
                keep,
                appContent: keep === 'app' ? editorContent : null,
            });
        } else {
            if (keep === 'disk') {
                resolvedContent = await readBrowserFile(selectedPath);
            } else {
                await writeBrowserFile(selectedPath, editorContent);
                const hash = await hashString(editorContent);
                browserFileHashes.set(selectedPath, hash);
                resolvedContent = editorContent;
            }
        }

        editorContent = resolvedContent;
        originalContent = resolvedContent;
        $editor.value = resolvedContent;
        diskConflictContent = null;

        const state = fileStates.get(selectedPath);
        if (state) {
            state.status = 'clean';
            state.content_hash = await hashString(resolvedContent);
        }
        if (!isTauri) {
            browserFileHashes.set(selectedPath, state?.content_hash || '');
        }

        logEvent('resolve', `Resolved (${keep}): ${selectedPath.split('/').pop()}`);
        updateUI();
    } catch (err) {
        logEvent('error', `Resolve failed: ${err}`);
    }
}

// ---------------------------------------------------------------------------
// Simulate external change (browser mode only)
// ---------------------------------------------------------------------------

async function onSimulateExternalChange() {
    if (!selectedPath) {
        logEvent('error', 'Select a file first');
        return;
    }

    const modified = editorContent + `\n<!-- External edit at ${new Date().toISOString()} -->\n`;

    try {
        if (isTauri) {
            // In Tauri mode the real FS watcher handles this
            return;
        }
        await writeBrowserFile(selectedPath, modified);
        const hash = await hashString(modified);
        // Don't update browserFileHashes — let the poll detect the diff
        logEvent('app_save', `Simulated external edit on ${selectedPath.split('/').pop()}`);
    } catch (err) {
        logEvent('error', `Simulate failed: ${err}`);
    }
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

function logEvent(kind, detail) {
    const now = new Date();
    const time = now.toLocaleTimeString('en-GB', { hour12: false });

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-kind ${kind}">${kind}</span>
        <span class="log-detail">${detail}</span>
    `;
    $logEntries.prepend(entry);

    // Cap at 200 entries
    while ($logEntries.children.length > 200) {
        $logEntries.removeChild($logEntries.lastChild);
    }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', init);
