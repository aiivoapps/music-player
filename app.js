(() => {
  'use strict';

  // ============ State ============
  const state = {
    rootHandle: null,
    rootName: '',
    tree: null,
    flatAudio: [],
    currentIndex: -1,
    isPlaying: false,
    shuffle: false,
    repeat: 0,
    volume: 0.8,
    muted: false,
    prevVolume: 0.8,
    favorites: new Set(),
    filterFavorites: false,
    queueMode: 'folder',
    audioEffect: 'normal',
    currentFolderPath: '',
    rememberPosition: true,
    autoPlayNext: true,
    showHidden: false,
    positions: {},
  };

  // ============ DOM ============
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    treeView: $('#tree-view'),
    emptyState: $('#empty-state'),
    rootPathBar: $('#root-path-bar'),
    rootPathText: $('#root-path-text'),
    trackTitle: $('#track-title'),
    trackPath: $('#track-path'),
    timeCurrent: $('#time-current'),
    timeTotal: $('#time-total'),
    progress: $('#progress-slider'),
    volume: $('#volume-slider'),
    volumeValue: $('#volume-value'),
    volumePanel: $('#volume-panel'),
    volumeWidth: $('#volume-width'),
    btnPlay: $('#btn-play'),
    iconPlay: $('#icon-play'),
    btnFav: $('#btn-favorite'),
    iconFav: $('#icon-fav'),
    iconVolume: $('#icon-volume'),
    btnVolumeToggle: $('#btn-volume-toggle'),
    effectBadge: $('#effect-badge'),
    btnQueueMode: $('#btn-queue-mode'),
    settingsModal: $('#settings-modal'),
    toast: $('#toast'),
  };

  // ============ Audio Engine ============
  let audioEl = new Audio();
  audioEl.crossOrigin = 'anonymous';
  let audioCtx = null;
  let sourceNode = null;
  let gainNode = null;
  let pannerNode = null;
  let delayNode = null;
  let delayGain = null;
  let effectInterval = null;
  let effectAngle = 0;

  function ensureAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      gainNode = audioCtx.createGain();
      pannerNode = audioCtx.createStereoPanner();
      delayNode = audioCtx.createDelay(1.0);
      delayGain = audioCtx.createGain();
      delayGain.gain.value = 0;

      sourceNode.connect(gainNode);
      gainNode.connect(pannerNode);
      pannerNode.connect(audioCtx.destination);

      pannerNode.connect(delayNode);
      delayNode.connect(delayGain);
      delayGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function applyEffect(mode) {
    state.audioEffect = mode;
    els.effectBadge.textContent = mode === 'normal' ? 'Normal' : mode.toUpperCase();
    if (effectInterval) {
      clearInterval(effectInterval);
      effectInterval = null;
    }
    if (!pannerNode) return;

    pannerNode.pan.value = 0;
    delayGain.gain.value = 0;
    delayNode.delayTime.value = 0;

    if (mode === 'normal') return;

    const speed = mode === '3d' ? 0.015 : mode === '8d' ? 0.035 : 0.055;
    const depth = mode === '3d' ? 0.55 : mode === '8d' ? 0.85 : 1.0;

    effectInterval = setInterval(() => {
      effectAngle += speed;
      const pan = Math.sin(effectAngle) * depth;
      pannerNode.pan.setValueAtTime(pan, audioCtx.currentTime);
      if (mode === '16d') {
        delayGain.gain.setValueAtTime(0.22 + Math.abs(pan) * 0.15, audioCtx.currentTime);
        delayNode.delayTime.setValueAtTime(0.12 + Math.abs(Math.cos(effectAngle)) * 0.18, audioCtx.currentTime);
      }
    }, 40);
  }

  // ============ File System ============
  const AUDIO_EXTS = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.opus', '.webm'];

  function isAudio(name) {
    const lower = name.toLowerCase();
    return AUDIO_EXTS.some(ext => lower.endsWith(ext));
  }

  function isHidden(name) {
    return name.startsWith('.');
  }

  async function scanDirectory(dirHandle, relPath = '') {
    const children = [];
    const entries = [];
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of entries) {
      if (!state.showHidden && isHidden(entry.name)) continue;
      const path = relPath ? `\( {relPath}/ \){entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        const sub = await scanDirectory(entry, path);
        children.push({
          type: 'folder',
          name: entry.name,
          path,
          handle: entry,
          children: sub,
          expanded: false,
        });
      } else if (isAudio(entry.name)) {
        children.push({
          type: 'audio',
          name: entry.name,
          path,
          handle: entry,
        });
      }
    }
    return children;
  }

  function collectFlat(nodes, list = []) {
    for (const n of nodes) {
      if (n.type === 'audio') list.push(n);
      else if (n.type === 'folder' && n.children) collectFlat(n.children, list);
    }
    return list;
  }

  function collectInFolder(node, list = []) {
    if (!node) return list;
    if (node.type === 'audio') {
      list.push(node);
      return list;
    }
    if (node.children) {
      for (const c of node.children) collectInFolder(c, list);
    }
    return list;
  }

  async function selectRoot() {
    // Tenta a API moderna primeiro (computador)
    if (window.showDirectoryPicker) {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        state.rootHandle = handle;
        state.rootName = handle.name;
        els.rootPathText.textContent = handle.name;
        els.rootPathBar.classList.remove('hidden');
        els.emptyState.classList.add('hidden');
        showToast('Escaneando pastas...');
        const tree = await scanDirectory(handle);
        state.tree = tree;
        state.flatAudio = collectFlat(tree);
        renderTree();
        showToast(`${state.flatAudio.length} faixas encontradas`);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error(err);
      }
    }

    // Fallback para Android
    const input = document.getElementById('folder-input');
    if (input) {
      input.value = '';
      input.click();
    } else {
      showToast('Seu navegador não suporta seleção de pasta.');
    }
  }

  // Processa os arquivos selecionados pelo input (Android)
  function handleFolderInput(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) {
      showToast('Nenhum arquivo selecionado');
      return;
    }

    showToast('Organizando pastas...');

    const root = { type: 'folder', name: 'Músicas', path: '', children: [], expanded: true };
    const flat = [];

    files.forEach(file => {
      if (!isAudio(file.name)) return;

      const rel = file.webkitRelativePath || file.name;
      const parts = rel.split('/');
      const fileName = parts.pop();

      let current = root;
      let currentPath = '';

      parts.forEach(part => {
        if (!part) return;
        currentPath = currentPath ? `\( {currentPath}/ \){part}` : part;
        let child = current.children.find(c => c.name === part && c.type === 'folder');
        if (!child) {
          child = { type: 'folder', name: part, path: currentPath, children: [], expanded: false };
          current.children.push(child);
        }
        current = child;
      });

      const filePath = currentPath ? `\( {currentPath}/ \){fileName}` : fileName;
      const audioNode = {
        type: 'audio',
        name: fileName,
        path: filePath,
        file: file,
      };
      current.children.push(audioNode);
      flat.push(audioNode);
    });

    function sortTree(node) {
      if (!node.children) return;
      node.children.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      node.children.forEach(sortTree);
    }
    sortTree(root);

    state.rootHandle = null;
    state.rootName = root.name;
    state.tree = root.children;
    state.flatAudio = flat;

    els.rootPathText.textContent = root.name + ` (${flat.length} faixas)`;
    els.rootPathBar.classList.remove('hidden');
    els.emptyState.classList.add('hidden');

    renderTree();
    showToast(`${flat.length} faixas encontradas`);
  }

  // ============ Tree Rendering ============
  function renderTree() {
    els.treeView.innerHTML = '';
    if (!state.tree || state.tree.length === 0) {
      els.emptyState.classList.remove('hidden');
      els.treeView.appendChild(els.emptyState);
      return;
    }
    const frag = document.createDocumentFragment();
    state.tree.forEach(node => frag.appendChild(createTreeNode(node, 0)));
    els.treeView.appendChild(frag);
  }

  function createTreeNode(node, depth) {
    const wrapper = document.createElement('div');
    wrapper.className = 'tree-node';
    wrapper.dataset.path = node.path;

    const item = document.createElement('div');
    item.className = `tree-item ${node.type}`;
    if (node.type === 'audio' && state.currentIndex >= 0 && state.flatAudio[state.currentIndex]?.path === node.path) {
      item.classList.add('active-playing');
    }

    let html = '';
    if (node.type === 'folder') {
      html += `<svg class="chevron ${node.expanded ? 'open' : ''}" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/></svg>`;
      html += `<span class="icon"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg></span>`;
    } else {
      html += `<span style="width:16px"></span>`;
      html += `<span class="icon"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg></span>`;
    }
    html += `<span class="name">${escapeHtml(node.name)}</span>`;
    if (node.type === 'audio' && state.favorites.has(node.path)) {
      html += `<span class="fav-star">♥</span>`;
    }
    if (node.type === 'folder') {
      const count = collectInFolder(node).length;
      if (count) html += `<span class="meta">${count}</span>`;
    }
    item.innerHTML = html;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (node.type === 'folder') {
        node.expanded = !node.expanded;
        renderTree();
      } else {
        playTrackByPath(node.path);
      }
    });

    let pressTimer;
    item.addEventListener('touchstart', () => {
      if (node.type !== 'audio') return;
      pressTimer = setTimeout(() => toggleFavorite(node.path), 600);
    }, { passive: true });
    item.addEventListener('touchend', () => clearTimeout(pressTimer));
    item.addEventListener('touchmove', () => clearTimeout(pressTimer));
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (node.type === 'audio') toggleFavorite(node.path);
    });

    wrapper.appendChild(item);

    if (node.type === 'folder' && node.expanded && node.children) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'tree-children';
      node.children.forEach(c => childrenEl.appendChild(createTreeNode(c, depth + 1)));
      wrapper.appendChild(childrenEl);
    }
    return wrapper;
  }

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ============ Playback ============
  function getPlayQueue() {
    if (state.filterFavorites || state.queueMode === 'favorites') {
      return state.flatAudio.filter(t => state.favorites.has(t.path));
    }
    if (state.queueMode === 'all') return state.flatAudio;
    if (state.currentIndex >= 0) {
      const cur = state.flatAudio[state.currentIndex];
      const folderPath = cur.path.includes('/') ? cur.path.slice(0, cur.path.lastIndexOf('/')) : '';
      if (folderPath) {
        const folderNode = findNodeByPath(state.tree, folderPath);
        if (folderNode) return collectInFolder(folderNode);
      }
    }
    return state.flatAudio;
  }

  function findNodeByPath(nodes, path) {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (n.children) {
        const found = findNodeByPath(n.children, path);
        if (found) return found;
      }
    }
    return null;
  }

  async function playTrackByPath(path) {
    const idx = state.flatAudio.findIndex(t => t.path === path);
    if (idx === -1) return;
    await playIndex(idx);
  }

  async function playIndex(idx) {
    if (idx < 0 || idx >= state.flatAudio.length) return;
    const track = state.flatAudio[idx];
    state.currentIndex = idx;

    try {
      ensureAudioContext();
      if (audioEl.src && audioEl.src.startsWith('blob:')) {
        URL.revokeObjectURL(audioEl.src);
      }

      let file;
      if (track.file) {
        file = track.file;
      } else if (track.handle) {
        file = await track.handle.getFile();
      } else {
        throw new Error('Arquivo não encontrado');
      }

      const url = URL.createObjectURL(file);
      audioEl.src = url;
      audioEl.volume = state.muted ? 0 : state.volume;

      if (state.rememberPosition && state.positions[track.path]) {
        audioEl.currentTime = state.positions[track.path];
      }

      await audioEl.play();
      state.isPlaying = true;
      updatePlayIcon();
      updateNowPlaying(track);
      updateFavoriteBtn();
      highlightPlaying();
      applyEffect(state.audioEffect);
    } catch (err) {
      console.error(err);
      showToast('Não foi possível tocar: ' + track.name);
      playNext();
    }
  }

  function updateNowPlaying(track) {
    els.trackTitle.textContent = track.name.replace(/\.[^.]+$/, '');
    els.trackPath.textContent = track.path;
  }

  function updatePlayIcon() {
    if (state.isPlaying) {
      els.iconPlay.innerHTML = '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
    } else {
      els.iconPlay.innerHTML = '<path fill="currentColor" d="M8 5v14l11-7z"/>';
    }
  }

  function highlightPlaying() {
    $$('.tree-item.active-playing').forEach(el => el.classList.remove('active-playing'));
    if (state.currentIndex >= 0) {
      const path = state.flatAudio[state.currentIndex].path;
      const node = els.treeView.querySelector(`[data-path="${CSS.escape(path)}"] .tree-item`);
      if (node) node.classList.add('active-playing');
    }
  }

  function togglePlay() {
    if (state.currentIndex < 0) {
      if (state.flatAudio.length) playIndex(0);
      return;
    }
    ensureAudioContext();
    if (state.isPlaying) {
      audioEl.pause();
      state.isPlaying = false;
    } else {
      audioEl.play();
      state.isPlaying = true;
    }
    updatePlayIcon();
  }

  function playNext() {
    const queue = getPlayQueue();
    if (!queue.length) return;