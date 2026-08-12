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
      saveRecentRootName(handle.name);
      showToast(`${state.flatAudio.length} faixas encontradas`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err);
        showToast('Erro ao selecionar pasta. Use Chrome/Edge.');
      }
    }
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
      const file = await track.handle.getFile();
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
    \[ ('.tree-item.active-playing').forEach(el => el.classList.remove('active-playing'));
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

    let nextPath;
    if (state.shuffle) {
      const available = queue.filter((_, i) => i !== state.currentIndex || queue.length === 1);
      nextPath = available[Math.floor(Math.random() * available.length)]?.path;
    } else {
      const curPath = state.currentIndex >= 0 ? state.flatAudio[state.currentIndex].path : null;
      let idxInQueue = queue.findIndex(t => t.path === curPath);
      if (idxInQueue === -1) idxInQueue = -1;
      let nextIdx = idxInQueue + 1;
      if (nextIdx >= queue.length) {
        if (state.repeat === 1) nextIdx = 0;
        else return;
      }
      nextPath = queue[nextIdx]?.path;
    }
    if (nextPath) playTrackByPath(nextPath);
  }

  function playPrev() {
    if (audioEl.currentTime > 3) {
      audioEl.currentTime = 0;
      return;
    }
    const queue = getPlayQueue();
    if (!queue.length) return;
    const curPath = state.currentIndex >= 0 ? state.flatAudio[state.currentIndex].path : null;
    let idxInQueue = queue.findIndex(t => t.path === curPath);
    if (idxInQueue <= 0) {
      if (state.repeat === 1) idxInQueue = queue.length;
      else {
        audioEl.currentTime = 0;
        return;
      }
    }
    const prev = queue[idxInQueue - 1];
    if (prev) playTrackByPath(prev.path);
  }

  // ============ Favorites ============
  function toggleFavorite(path) {
    if (state.favorites.has(path)) {
      state.favorites.delete(path);
      showToast('Removido dos favoritos');
    } else {
      state.favorites.add(path);
      showToast('Adicionado aos favoritos');
    }
    saveFavorites();
    updateFavoriteBtn();
    renderTree();
  }

  function updateFavoriteBtn() {
    if (state.currentIndex < 0) {
      els.btnFav.disabled = true;
      return;
    }
    els.btnFav.disabled = false;
    const path = state.flatAudio[state.currentIndex].path;
    const isFav = state.favorites.has(path);
    els.btnFav.classList.toggle('fav-active', isFav);
    if (isFav) {
      els.iconFav.innerHTML = '<path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>';
    } else {
      els.iconFav.innerHTML = '<path fill="currentColor" d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"/>';
    }
  }

  // ============ UI Helpers ============
  function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `\( {m}: \){sec.toString().padStart(2, '0')}`;
  }

  function showToast(msg, ms = 2200) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(els.toast._tid);
    els.toast._tid = setTimeout(() => els.toast.classList.add('hidden'), ms);
  }

  // ============ Persistence ============
  function saveFavorites() {
    localStorage.setItem('emp_favorites', JSON.stringify([...state.favorites]));
  }
  function loadFavorites() {
    try {
      const arr = JSON.parse(localStorage.getItem('emp_favorites') || '[]');
      state.favorites = new Set(arr);
    } catch {}
  }

  function saveColors() {
    const colors = {}; \]('.color-grid input[type="color"]').forEach(inp => {
      colors[inp.id] = inp.value;
    });
    localStorage.setItem('emp_colors', JSON.stringify(colors));
  }

  function loadColors() {
    try {
      const colors = JSON.parse(localStorage.getItem('emp_colors') || '{}');
      Object.entries(colors).forEach(([id, val]) => {
        const inp = document.getElementById(id);
        if (inp) {
          inp.value = val;
          applyColor(id, val);
        }
      });
    } catch {}
  }

  function applyColor(id, val) {
    const map = {
      'color-bg': '--bg',
      'color-bg2': '--bg2',
      'color-text': '--text',
      'color-text2': '--text2',
      'color-accent': '--accent',
      'color-player': '--player',
      'color-tree': '--tree',
      'color-border': '--border',
      'color-play': '--play',
      'color-fav': '--fav',
      'color-vol': '--vol',
      'color-progress': '--progress',
    };
    if (map[id]) {
      document.documentElement.style.setProperty(map[id], val);
      if (id === 'color-bg') document.querySelector('meta[name="theme-color"]')?.setAttribute('content', val);
    }
  }

  function saveSettings() {
    localStorage.setItem('emp_settings', JSON.stringify({
      volume: state.volume,
      volWidth: els.volumeWidth.value,
      effect: state.audioEffect,
      shuffle: state.shuffle,
      repeat: state.repeat,
      queueMode: state.queueMode,
      autoPlayNext: state.autoPlayNext,
      rememberPosition: state.rememberPosition,
      showHidden: state.showHidden,
    }));
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('emp_settings') || '{}');
      if (s.volume != null) {
        state.volume = s.volume;
        els.volume.value = Math.round(s.volume * 100);
        els.volumeValue.textContent = Math.round(s.volume * 100) + '%';
        audioEl.volume = s.volume;
      }
      if (s.volWidth) {
        els.volumeWidth.value = s.volWidth;
        document.documentElement.style.setProperty('--vol-width', s.volWidth + 'px');
      }
      if (s.effect) {
        state.audioEffect = s.effect;
        \[ (`input[name="audio-effect"]`).forEach(r => r.checked = r.value === s.effect);
        applyEffect(s.effect);
      }
      if (s.shuffle != null) {
        state.shuffle = s.shuffle;
        $('#btn-shuffle').classList.toggle('on', s.shuffle);
      }
      if (s.repeat != null) {
        state.repeat = s.repeat;
        $('#btn-repeat').classList.toggle('on', s.repeat > 0);
      }
      if (s.queueMode) {
        state.queueMode = s.queueMode;
        els.btnQueueMode.textContent = s.queueMode === 'all' ? 'Tudo' : s.queueMode === 'favorites' ? 'Favoritos' : 'Pasta';
      }
      if (s.autoPlayNext != null) {
        state.autoPlayNext = s.autoPlayNext;
        $('#opt-auto-play-next').checked = s.autoPlayNext;
      }
      if (s.rememberPosition != null) {
        state.rememberPosition = s.rememberPosition;
        $('#opt-remember-position').checked = s.rememberPosition;
      }
      if (s.showHidden != null) {
        state.showHidden = s.showHidden;
        $('#opt-show-hidden').checked = s.showHidden;
      }
    } catch {}
  }

  function saveRecentRootName(name) {
    localStorage.setItem('emp_root_name', name);
  }

  function loadPositions() {
    try {
      state.positions = JSON.parse(localStorage.getItem('emp_positions') || '{}');
    } catch { state.positions = {}; }
  }
  function savePosition() {
    if (state.currentIndex >= 0 && state.rememberPosition) {
      const path = state.flatAudio[state.currentIndex].path;
      state.positions[path] = audioEl.currentTime;
      localStorage.setItem('emp_positions', JSON.stringify(state.positions));
    }
  }

  // ============ Event Listeners ============
  function bindEvents() {
    $('#btn-select-root').addEventListener('click', selectRoot);
    $('#btn-select-root-empty').addEventListener('click', selectRoot);
    $('#btn-refresh').addEventListener('click', async () => {
      if (!state.rootHandle) return;
      showToast('Atualizando...');
      try {
        const tree = await scanDirectory(state.rootHandle);
        state.tree = tree;
        state.flatAudio = collectFlat(tree);
        renderTree();
        showToast(`${state.flatAudio.length} faixas`);
      } catch (e) {
        showToast('Erro ao atualizar. Selecione a pasta novamente.');
      }
    });

    $('#btn-settings').addEventListener('click', () => {
      els.settingsModal.classList.remove('hidden');
    });
    $('#btn-close-settings').addEventListener('click', () => {
      els.settingsModal.classList.add('hidden');
      saveSettings();
      saveColors();
    });
    els.settingsModal.addEventListener('click', (e) => {
      if (e.target === els.settingsModal) {
        els.settingsModal.classList.add('hidden');
        saveSettings();
        saveColors();
      }
    });

    $('#btn-play').addEventListener('click', togglePlay);
    $('#btn-next').addEventListener('click', playNext);
    $('#btn-prev').addEventListener('click', playPrev);

    $('#btn-shuffle').addEventListener('click', () => {
      state.shuffle = !state.shuffle;
      $('#btn-shuffle').classList.toggle('on', state.shuffle);
      saveSettings();
    });

    $('#btn-repeat').addEventListener('click', () => {
      state.repeat = (state.repeat + 1) % 3;
      const btn = $('#btn-repeat');
      btn.classList.toggle('on', state.repeat > 0);
      btn.title = state.repeat === 0 ? 'Repetir' : state.repeat === 1 ? 'Repetir tudo' : 'Repetir uma';
      saveSettings();
    });

    $('#btn-favorite').addEventListener('click', () => {
      if (state.currentIndex >= 0) toggleFavorite(state.flatAudio[state.currentIndex].path);
    });

    $('#btn-favorites-filter').addEventListener('click', () => {
      state.filterFavorites = !state.filterFavorites;
      $('#btn-favorites-filter').classList.toggle('active', state.filterFavorites);
      if (state.filterFavorites) {
        state.queueMode = 'favorites';
        els.btnQueueMode.textContent = 'Favoritos';
        showToast('Filtrando favoritos');
      } else {
        state.queueMode = 'folder';
        els.btnQueueMode.textContent = 'Pasta';
        showToast('Mostrando tudo');
      }
      saveSettings();
    });

    els.btnQueueMode.addEventListener('click', () => {
      const modes = ['folder', 'all', 'favorites'];
      const i = modes.indexOf(state.queueMode);
      state.queueMode = modes[(i + 1) % 3];
      const labels = { folder: 'Pasta', all: 'Tudo', favorites: 'Favoritos' };
      els.btnQueueMode.textContent = labels[state.queueMode];
      state.filterFavorites = state.queueMode === 'favorites';
      $('#btn-favorites-filter').classList.toggle('active', state.filterFavorites);
      saveSettings();
      showToast('Modo: ' + labels[state.queueMode]);
    });

    els.volume.addEventListener('input', () => {
      const v = els.volume.value / 100;
      state.volume = v;
      state.muted = false;
      audioEl.volume = v;
      els.volumeValue.textContent = els.volume.value + '%';
      els.btnVolumeToggle.classList.remove('muted');
      saveSettings();
    });

    els.btnVolumeToggle.addEventListener('click', () => {
      if (state.muted) {
        state.muted = false;
        audioEl.volume = state.volume;
        els.volume.value = Math.round(state.volume * 100);
        els.btnVolumeToggle.classList.remove('muted');
      } else {
        state.muted = true;
        state.prevVolume = state.volume;
        audioEl.volume = 0;
        els.btnVolumeToggle.classList.add('muted');
      }
    });

    els.volumeWidth.addEventListener('input', () => {
      document.documentElement.style.setProperty('--vol-width', els.volumeWidth.value + 'px');
      saveSettings();
    });

    els.progress.addEventListener('input', () => {
      if (!audioEl.duration) return;
      audioEl.currentTime = (els.progress.value / 1000) * audioEl.duration;
    });

    audioEl.addEventListener('timeupdate', () => {
      if (!audioEl.duration) return;
      els.progress.value = (audioEl.currentTime / audioEl.duration) * 1000;
      els.timeCurrent.textContent = formatTime(audioEl.currentTime);
      els.timeTotal.textContent = formatTime(audioEl.duration);
      if (Math.floor(audioEl.currentTime) % 5 === 0) savePosition();
    });

    audioEl.addEventListener('ended', () => {
      savePosition();
      if (state.repeat === 2) {
        audioEl.currentTime = 0;
        audioEl.play();
      } else if (state.autoPlayNext) {
        playNext();
      } else {
        state.isPlaying = false;
        updatePlayIcon();
      }
    });

    audioEl.addEventListener('play', () => {
      state.isPlaying = true;
      updatePlayIcon();
    });
    audioEl.addEventListener('pause', () => {
      state.isPlaying = false;
      updatePlayIcon();
    }); \]('.color-grid input[type="color"]').forEach(inp => {
      inp.addEventListener('input', () => {
        applyColor(inp.id, inp.value);
      });
    });
    $('#btn-reset-colors').addEventListener('click', () => {
      const defaults = {
        'color-bg': '#0f0f13',
        'color-bg2': '#1a1a22',
        'color-text': '#e8e8ed',
        'color-text2': '#9a9aa8',
        'color-accent': '#7c5cff',
        'color-player': '#16161e',
        'color-tree': '#1e1e28',
        'color-border': '#2a2a36',
        'color-play': '#7c5cff',
        'color-fav': '#ff5c8a',
        'color-vol': '#1a1a22',
        'color-progress': '#7c5cff',
      };
      Object.entries(defaults).forEach(([id, val]) => {
        const inp = document.getElementById(id);
        if (inp) {
          inp.value = val;
          applyColor(id, val);
        }
      });
      localStorage.removeItem('emp_colors');
    });

    $$('input[name="audio-effect"]').forEach(r => {
      r.addEventListener('change', () => {
        if (r.checked) {
          applyEffect(r.value);
          saveSettings();
        }
      });
    });

    $('#opt-auto-play-next').addEventListener('change', (e) => {
      state.autoPlayNext = e.target.checked;
      saveSettings();
    });
    $('#opt-remember-position').addEventListener('change', (e) => {
      state.rememberPosition = e.target.checked;
      saveSettings();
    });
    $('#opt-show-hidden').addEventListener('change', (e) => {
      state.showHidden = e.target.checked;
      saveSettings();
      if (state.rootHandle) {
        $('#btn-refresh').click();
      }
    });

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { audioEl.play(); });
      navigator.mediaSession.setActionHandler('pause', () => { audioEl.pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', playPrev);
      navigator.mediaSession.setActionHandler('nexttrack', playNext);
    }

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      if (e.code === 'ArrowRight') playNext();
      if (e.code === 'ArrowLeft') playPrev();
      if (e.code === 'ArrowUp') {
        els.volume.value = Math.min(100, +els.volume.value + 5);
        els.volume.dispatchEvent(new Event('input'));
      }
      if (e.code === 'ArrowDown') {
        els.volume.value = Math.max(0, +els.volume.value - 5);
        els.volume.dispatchEvent(new Event('input'));
      }
    });
  }

  // ============ Init ============
  function init() {
    loadFavorites();
    loadColors();
    loadSettings();
    loadPositions();
    bindEvents();
    applyEffect(state.audioEffect);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    if (!window.showDirectoryPicker) {
      showToast('Este navegador não suporta seleção de pastas. Use Chrome no Android.', 5000);
    }
  }

  init();
})();
