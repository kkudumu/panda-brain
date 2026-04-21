<script lang="ts">
  import { workingDirectory, setWorkingDirectory } from '../lib/working-directory.js';

  type FileEntry = {
    name: string;
    path: string;
    kind: 'directory' | 'file';
  };

  type FilePreview = {
    kind: 'text' | 'binary' | 'too_large';
    content: string;
    size: number;
  };

  type VisibleEntry = {
    entry: FileEntry;
    level: number;
  };

  const MAX_ENTRIES_PER_DIRECTORY = 300;
  const LOAD_TIMEOUT_MS = 1500;

  type DesktopApi = {
    openFolder?: () => Promise<string | null>;
    listDirectory?: (dirPath: string) => Promise<FileEntry[]>;
    readTextFile?: (filePath: string) => Promise<FilePreview>;
  };

  let rootDir = $state<string | null>(null);
  let rootEntries = $state<FileEntry[]>([]);
  let childrenByPath = $state<Record<string, FileEntry[]>>({});
  let truncatedPaths = $state<Record<string, number>>({});
  let expandedDirs = $state<Record<string, boolean>>({});
  let loadingPaths = $state<Record<string, boolean>>({});
  let error = $state('');
  let selectedFile = $state<FileEntry | null>(null);
  let preview = $state<FilePreview | null>(null);
  let previewLoading = $state(false);
  let query = $state('');
  let pendingRootDir = $state<string | null>(null);

  function log(event: string, data: Record<string, unknown> = {}) {
    console.log('[FileBrowser]', event, data);
  }

  function getDesktopApi(): DesktopApi | undefined {
    return (window as unknown as { ftm?: DesktopApi }).ftm;
  }

  function setPathLoading(dirPath: string, loading: boolean) {
    loadingPaths = { ...loadingPaths, [dirPath]: loading };
  }

  function isPathLoading(dirPath: string): boolean {
    return !!loadingPaths[dirPath];
  }

  function isExpanded(dirPath: string): boolean {
    return !!expandedDirs[dirPath];
  }

  function setExpanded(dirPath: string, expanded: boolean) {
    expandedDirs = { ...expandedDirs, [dirPath]: expanded };
  }

  async function chooseFolder() {
    const api = getDesktopApi();
    if (!api?.openFolder) return;
    log('chooseFolder:start');
    const chosen = await api.openFolder();
    log('chooseFolder:result', { chosen });
    if (chosen) setWorkingDirectory(chosen);
  }

  async function listDirectory(dirPath: string): Promise<FileEntry[]> {
    const api = getDesktopApi();
    if (!api?.listDirectory) {
      throw new Error('Directory browsing is unavailable in this build.');
    }
    const startedAt = performance.now();
    log('listDirectory:start', { dirPath });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    return Promise.race([
      api.listDirectory(dirPath).then((result) => {
        if (timeoutId) clearTimeout(timeoutId);
        log('listDirectory:success', {
          dirPath,
          count: result.length,
          ms: Math.round(performance.now() - startedAt),
        });
        return result;
      }),
      new Promise<FileEntry[]>((_, reject) => {
        timeoutId = setTimeout(() => {
          log('listDirectory:timeout', {
            dirPath,
            timeoutMs: LOAD_TIMEOUT_MS,
          });
          reject(new Error('Directory load timed out. Try a smaller folder.'));
        }, LOAD_TIMEOUT_MS);
      }),
    ]);
  }

  async function loadRoot(dirPath: string) {
    if (pendingRootDir === dirPath) {
      log('loadRoot:skip-pending', { dirPath });
      return;
    }

    log('loadRoot:start', { dirPath });
    pendingRootDir = dirPath;
    error = '';
    setPathLoading(dirPath, true);

    try {
      const rootList = await listDirectory(dirPath);
      rootEntries = rootList.slice(0, MAX_ENTRIES_PER_DIRECTORY);
      rootDir = dirPath;
      childrenByPath = {};
      truncatedPaths = rootList.length > MAX_ENTRIES_PER_DIRECTORY
        ? { [dirPath]: rootList.length - MAX_ENTRIES_PER_DIRECTORY }
        : {};
      expandedDirs = { [dirPath]: true };
      selectedFile = null;
      preview = null;
      log('loadRoot:success', {
        dirPath,
        renderedCount: rootList.slice(0, MAX_ENTRIES_PER_DIRECTORY).length,
        hiddenCount: Math.max(0, rootList.length - MAX_ENTRIES_PER_DIRECTORY),
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load directory.';
      log('loadRoot:error', {
        dirPath,
        error,
      });
    } finally {
      setPathLoading(dirPath, false);
      pendingRootDir = null;
      log('loadRoot:finally', {
        dirPath,
        loading: isPathLoading(dirPath),
        pendingRootDir,
      });
    }
  }

  async function ensureChildrenLoaded(dirPath: string) {
    if (childrenByPath[dirPath] || isPathLoading(dirPath)) return;
    log('ensureChildrenLoaded:start', { dirPath });
    setPathLoading(dirPath, true);

    try {
      const children = await listDirectory(dirPath);
      childrenByPath = { ...childrenByPath, [dirPath]: children };
      truncatedPaths = {
        ...truncatedPaths,
        [dirPath]: Math.max(0, children.length - MAX_ENTRIES_PER_DIRECTORY),
      };
      childrenByPath = {
        ...childrenByPath,
        [dirPath]: children.slice(0, MAX_ENTRIES_PER_DIRECTORY),
      };
      log('ensureChildrenLoaded:success', {
        dirPath,
        renderedCount: childrenByPath[dirPath]?.length ?? 0,
        hiddenCount: truncatedPaths[dirPath] ?? 0,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load folder contents.';
      log('ensureChildrenLoaded:error', {
        dirPath,
        error,
      });
    } finally {
      setPathLoading(dirPath, false);
      log('ensureChildrenLoaded:finally', {
        dirPath,
        loading: isPathLoading(dirPath),
      });
    }
  }

  async function toggleDirectory(entry: FileEntry) {
    log('toggleDirectory', {
      path: entry.path,
      expanded: isExpanded(entry.path),
    });
    if (isExpanded(entry.path)) {
      setExpanded(entry.path, false);
      log('toggleDirectory:collapsed', { path: entry.path });
      return;
    }

    await ensureChildrenLoaded(entry.path);
    setExpanded(entry.path, true);
    log('toggleDirectory:expanded', { path: entry.path });
  }

  async function openFile(entry: FileEntry) {
    log('openFile:start', { path: entry.path });
    selectedFile = entry;
    preview = null;
    error = '';
    previewLoading = true;

    try {
      const api = getDesktopApi();
      if (!api?.readTextFile) {
        throw new Error('File preview is unavailable in this build.');
      }
      preview = await api.readTextFile(entry.path);
      log('openFile:success', {
        path: entry.path,
        kind: preview.kind,
        size: preview.size,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to read file.';
      log('openFile:error', { path: entry.path, error });
    } finally {
      previewLoading = false;
      log('openFile:finally', { path: entry.path });
    }
  }

  async function openEntry(entry: FileEntry) {
    if (entry.kind === 'directory') {
      await toggleDirectory(entry);
      return;
    }

    await openFile(entry);
  }

  function navigateUp() {
    if (!$workingDirectory || $workingDirectory === '/') return;
    const parts = $workingDirectory.split('/').filter(Boolean);
    const parent = '/' + parts.slice(0, -1).join('/');
    log('navigateUp', {
      current: $workingDirectory,
      parent: parent || '/',
    });
    setWorkingDirectory(parent || '/');
  }

  function clearFolder() {
    log('clearFolder', { current: $workingDirectory });
    setWorkingDirectory(null);
  }

  function fileSizeLabel(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
    return `${Math.round(size / 104857.6) / 10} MB`;
  }

  function collectVisible(entries: FileEntry[], level: number): VisibleEntry[] {
    const normalized = query.trim().toLowerCase();
    const visible: VisibleEntry[] = [];

    for (const entry of entries) {
      const childEntries = childrenByPath[entry.path] ?? [];
      const descendants = entry.kind === 'directory' && isExpanded(entry.path)
        ? collectVisible(childEntries, level + 1)
        : [];

      const matches = !normalized || entry.name.toLowerCase().includes(normalized);
      if (matches || descendants.length > 0) {
        visible.push({ entry, level });
        visible.push(...descendants);
      }
    }

    return visible;
  }

  function guideOpacity(level: number): string {
    return level > 0 ? '1' : '0';
  }

  let visibleEntries = $derived(
    rootDir ? collectVisible(rootEntries, 0) : []
  );

  let hiddenCount = $derived(
    rootDir ? (truncatedPaths[rootDir] ?? 0) : 0
  );

  let folderLabel = $derived(
    $workingDirectory
      ? $workingDirectory.split('/').filter(Boolean).slice(-2).join('/')
      : 'No folder'
  );

  $effect(() => {
    log('workingDirectory:effect', {
      workingDirectory: $workingDirectory,
      rootDir,
      pendingRootDir,
    });
    if (
      $workingDirectory &&
      $workingDirectory !== rootDir &&
      $workingDirectory !== pendingRootDir
    ) {
      loadRoot($workingDirectory);
    }

    if (!$workingDirectory) {
      rootDir = null;
      rootEntries = [];
      childrenByPath = {};
      expandedDirs = {};
      loadingPaths = {};
      selectedFile = null;
      preview = null;
      error = '';
      query = '';
      pendingRootDir = null;
    }
  });
</script>

<div class="file-browser">
  <div class="sidebar-topbar">
    <div class="topbar-icons">
      <button class="icon-btn" title="Choose folder" aria-label="Choose folder" onclick={chooseFolder}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.75 7.5a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2.25h8a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-btn" title="Up one level" aria-label="Up one level" onclick={navigateUp} disabled={!$workingDirectory || $workingDirectory === '/'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 6-4 4m4-4 4 4M12 18V6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-btn" title="Clear folder" aria-label="Clear folder" onclick={clearFolder} disabled={!$workingDirectory}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7 17 17M17 7 7 17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="topbar-title">Files</div>
  </div>

  {#if !$workingDirectory}
    <div class="empty-state">
      <div class="empty-card">
        <span class="empty-title">No workspace selected</span>
        <span class="empty-copy">Choose a working directory to pin a file tree here.</span>
        <button class="empty-action" onclick={chooseFolder}>Choose Folder</button>
      </div>
    </div>
  {:else}
    <div class="browser-header">
      <div class="folder-meta">
        <span class="folder-name">{folderLabel}</span>
        <span class="folder-path" title={$workingDirectory}>{$workingDirectory}</span>
      </div>
      <input
        bind:value={query}
        class="search-input"
        placeholder="Search files..."
        aria-label="Search files"
      />
    </div>

    <div class="browser-body">
      <div class="entry-list">
        {#if isPathLoading($workingDirectory)}
          <div class="status">Loading files…</div>
        {:else if error}
          <div class="status error">{error}</div>
        {:else if visibleEntries.length === 0}
          <div class="status">{query ? 'No matching files.' : 'This folder is empty.'}</div>
        {:else}
          {#if hiddenCount > 0 && !query}
            <div class="truncation-note">
              Showing first {MAX_ENTRIES_PER_DIRECTORY} items. {hiddenCount} more not rendered.
            </div>
          {/if}
          {#each visibleEntries as item}
            <button
              class="entry-row"
              class:selected={selectedFile?.path === item.entry.path}
              class:open={item.entry.kind === 'directory' && isExpanded(item.entry.path)}
              onclick={() => openEntry(item.entry)}
              title={item.entry.path}
              style={`--depth:${item.level}; --guide-opacity:${guideOpacity(item.level)};`}
            >
              <span class="entry-guides" aria-hidden="true"></span>
              <span class="entry-caret" aria-hidden="true">
                {#if item.entry.kind === 'directory'}
                  <svg viewBox="0 0 16 16" class:rotated={isExpanded(item.entry.path)}>
                    <path d="m6 3.5 4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                {/if}
              </span>
              <span class="entry-icon" aria-hidden="true">
                {#if item.entry.kind === 'directory'}
                  {#if isExpanded(item.entry.path)}
                    <svg viewBox="0 0 24 24">
                      <path d="M3.75 8.25a1.5 1.5 0 0 1 1.5-1.5h4.25l1.3 1.75h8.45a1.5 1.5 0 0 1 1.47 1.82l-.92 5a1.5 1.5 0 0 1-1.47 1.23H5.25a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
                    </svg>
                  {:else}
                    <svg viewBox="0 0 24 24">
                      <path d="M3.75 7.5a1.5 1.5 0 0 1 1.5-1.5h4l1.5 2.25h8a1.5 1.5 0 0 1 1.5 1.5v7.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
                    </svg>
                  {/if}
                {:else}
                  <svg viewBox="0 0 24 24">
                    <path d="M7.5 3.75h6.44l4.81 4.81v11.69a1.5 1.5 0 0 1-1.5 1.5h-9.75a1.5 1.5 0 0 1-1.5-1.5v-15a1.5 1.5 0 0 1 1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
                    <path d="M13.5 3.75v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path>
                  </svg>
                {/if}
              </span>
              <span class="entry-name">{item.entry.name}</span>
            </button>
          {/each}
        {/if}
      </div>

      <div class="preview-panel">
        {#if previewLoading}
          <div class="status">Loading preview…</div>
        {:else if selectedFile && preview}
          <div class="preview-header">
            <span class="preview-name">{selectedFile.name}</span>
            <span class="preview-size">{fileSizeLabel(preview.size)}</span>
          </div>

          {#if preview.kind === 'text'}
            <pre class="preview-content">{preview.content}</pre>
          {:else if preview.kind === 'binary'}
            <div class="status">Binary file preview is not supported.</div>
          {:else}
            <div class="status">File is too large to preview in-app.</div>
          {/if}
        {:else}
          <div class="status preview-empty">Select a file to preview it here.</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .file-browser {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: linear-gradient(180deg, #121212 0%, #0e0e0e 100%);
    border: 1px solid #1f1f1f;
    border-radius: 12px;
    overflow: hidden;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
  }

  .sidebar-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: #141414;
    border-bottom: 1px solid #202020;
  }

  .topbar-icons {
    display: flex;
    gap: 6px;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    border: 1px solid #2a2a2a;
    border-radius: 7px;
    background: #171717;
    color: #9d9d9d;
    cursor: pointer;
    transition: background 150ms ease, color 150ms ease, border-color 150ms ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }

  .icon-btn svg {
    width: 14px;
    height: 14px;
  }

  .icon-btn:hover:not(:disabled) {
    background: #1e1e1e;
    color: #f0f0f0;
    border-color: #3a3a3a;
  }

  .icon-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .topbar-title {
    color: #d8d8d8;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .empty-state,
  .status {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #686868;
    font-size: 12px;
    padding: 16px;
    text-align: center;
  }

  .empty-state {
    flex: 1;
  }

  .empty-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 240px;
  }

  .empty-title {
    color: #f0f0f0;
    font-size: 13px;
  }

  .empty-copy {
    line-height: 1.5;
  }

  .empty-action {
    border: 1px solid #2f7d54;
    border-radius: 8px;
    background: #113020;
    color: #aff3cb;
    padding: 9px 12px;
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .browser-header {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border-bottom: 1px solid #1d1d1d;
    background: rgba(255, 255, 255, 0.015);
  }

  .folder-meta {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .folder-name {
    color: #f4f4f4;
    font-size: 12px;
  }

  .folder-path {
    color: #7d7d7d;
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .search-input {
    width: 100%;
    border: 1px solid #232323;
    border-radius: 8px;
    background: #111;
    color: #e0e0e0;
    padding: 9px 10px;
    font: inherit;
    font-size: 12px;
    outline: none;
  }

  .search-input:focus {
    border-color: #2f7d54;
    box-shadow: 0 0 0 1px rgba(0, 255, 136, 0.2);
  }

  .browser-body {
    display: grid;
    grid-template-rows: minmax(0, 1fr) minmax(180px, 40%);
    min-height: 0;
    flex: 1;
  }

  .entry-list {
    overflow: auto;
    min-height: 0;
    padding: 6px 0;
  }

  .truncation-note {
    padding: 8px 12px 10px;
    color: #8a8a8a;
    font-size: 10px;
    line-height: 1.5;
    border-bottom: 1px solid #171717;
  }

  .entry-row {
    position: relative;
    display: grid;
    grid-template-columns: 14px 16px minmax(0, 1fr);
    align-items: center;
    width: 100%;
    padding: 7px 12px;
    padding-left: calc(12px + (var(--depth) * 16px));
    border: 0;
    background: transparent;
    color: #b8b8b8;
    text-align: left;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
  }

  .entry-row:hover {
    background: #171717;
    color: #ededed;
  }

  .entry-row.selected {
    background: linear-gradient(90deg, rgba(18, 79, 50, 0.95), rgba(18, 79, 50, 0.35));
    color: #f6fff9;
    box-shadow: inset 2px 0 0 #49c483;
  }

  .entry-row.open {
    color: #e9fdf1;
  }

  .entry-guides {
    position: absolute;
    left: calc(12px + (var(--depth) * 16px) - 8px);
    top: 6px;
    bottom: 6px;
    width: 1px;
    background: rgba(255, 255, 255, 0.09);
    opacity: var(--guide-opacity);
  }

  .entry-caret {
    width: 14px;
    height: 14px;
    color: #7a7a7a;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .entry-caret svg {
    width: 12px;
    height: 12px;
    transition: transform 120ms ease;
  }

  .entry-caret svg.rotated {
    transform: rotate(90deg);
  }

  .entry-icon {
    width: 16px;
    height: 16px;
    color: #9ab8aa;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .entry-row.open .entry-icon,
  .entry-row.selected .entry-icon {
    color: #7df0ad;
  }

  .entry-icon svg {
    width: 16px;
    height: 16px;
  }

  .entry-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .preview-panel {
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    border-top: 1px solid #1d1d1d;
    background: #0d0d0d;
  }

  .preview-header {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #1d1d1d;
    color: #9a9a9a;
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .preview-name {
    color: #d8d8d8;
  }

  .preview-content {
    margin: 0;
    padding: 12px;
    color: #d0d0d0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
    line-height: 1.55;
  }

  .status.error {
    color: #ff7d7d;
  }

  .preview-empty {
    flex: 1;
  }

  @media (max-width: 980px) {
    .browser-body {
      grid-template-rows: minmax(0, 1fr) 150px;
    }
  }
</style>
