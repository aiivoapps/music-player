let rootDirectoryHandle = null;
let currentDirectoryHandle = null;
let directoryHistory = [];
let audioFilesFlat = []; // Lista recursiva de arquivos de áudio
let currentSongIndex = 0;

const audioElement = new Audio();
let audioCtx = null;
let sourceNode = null;
let pannerNode = null;
let gainNode = null;
let rotationInterval = null;

// Favoritos simulados no localStorage
let favorites = JSON.parse(localStorage.getItem('aiivo_favorites') || '[]');
let isShowingFavorites = false;

// Elementos DOM
const btnSelectRoot = document.getElementById('btn-select-root');
const btnBack = document.getElementById('btn-back');
const currentPathLabel = document.getElementById('current-path-label');
const explorerList = document.getElementById('explorer-list');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const currentSongTitle = document.getElementById('current-song-title');
const progressBar = document.getElementById('progress-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnFavorite = document.getElementById('btn-favorite');

const btnSettings = document.getElementById('btn-settings');
const settingsModal = document.getElementById('settings-modal');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnFilterFavorites = document.getElementById('btn-filter-favorites');
const audioEffectSelect = document.getElementById('audio-effect-select');

const colorPrimary = document.getElementById('color-primary');
const colorBg = document.getElementById('color-bg');
const colorText = document.getElementById('color-text');

const btnVolumeToggle = document.getElementById('btn-volume-toggle');
const volumePopup = document.getElementById('volume-popup');
const volumeSlider = document.getElementById('volume-slider');

// Selecionar Pasta Raiz
btnSelectRoot.addEventListener('click', async () => {
    try {
        rootDirectoryHandle = await window.showDirectoryPicker();
        currentDirectoryHandle = rootDirectoryHandle;
        directoryHistory = [];
        isShowingFavorites = false;
        await loadDirectory(rootDirectoryHandle);
    } catch (err) {
        console.log('Seleção cancelada ou não suportada', err);
    }
});

// Navegação em Pastas e Varredura Recursiva
async function loadDirectory(dirHandle, pathName = dirHandle.name) {
    currentDirectoryHandle = dirHandle;
    currentPathLabel.textContent = pathName;
    btnBack.disabled = directoryHistory.length === 0;
    explorerList.innerHTML = '';

    audioFilesFlat = [];
    let entries = [];

    for await (const entry of dirHandle.values()) {
        entries.push(entry);
    }

    // Ordenar: pastas primeiro, depois arquivos
    entries.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === 'directory' ? -1 : 1;
    });

    for (const entry of entries) {
        if (entry.kind === 'directory') {
            const div = document.createElement('div');
            div.className = 'explorer-item';
            div.innerHTML = `<i class="fa-solid fa-folder"></i><span>${entry.name}</span>`;
            div.onclick = () => {
                directoryHistory.push({ handle: currentDirectoryHandle, name: currentPathLabel.textContent });
                loadDirectory(entry, `${pathName} / ${entry.name}`);
            };
            explorerList.appendChild(div);

            // Varredura recursiva para coletar áudios internos
            await collectAudioRecursive(entry, audioFilesFlat);
        } else if (entry.kind === 'file' && isAudioFile(entry.name)) {
            const fileObj = await entry.getFile();
            fileObj.handle = entry; // guarda referência
            audioFilesFlat.push(fileObj);

            const div = document.createElement('div');
            div.className = 'explorer-item';
            div.innerHTML = `<i class="fa-solid fa-file-audio"></i><span>${entry.name}</span>`;
            div.onclick = () => {
                playAudioFile(fileObj, audioFilesFlat.indexOf(fileObj));
            };
            explorerList.appendChild(div);
        }
    }
}

async function collectAudioRecursive(dirHandle, list) {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            await collectAudioRecursive(entry, list);
        } else if (entry.kind === 'file' && isAudioFile(entry.name)) {
            const fileObj = await entry.getFile();
            fileObj.handle = entry;
            list.push(fileObj);
        }
    }
}

function isAudioFile(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    return ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext);
}

// Botão Voltar
btnBack.onclick = () => {
    if (directoryHistory.length > 0) {
        const prev = directoryHistory.pop();
        loadDirectory(prev.handle, prev.name);
    }
};

// Reprodução de Áudio
async function playAudioFile(fileObj, index) {
    currentSongIndex = index;
    const fileURL = URL.createObjectURL(fileObj);
    audioElement.src = fileURL;
    
    initAudioContext();
    audioElement.play();
    btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    currentSongTitle.textContent = fileObj.name;
    updateFavoriteButtonUI(fileObj.name);
}

// Controles Play/Pause
btnPlayPause.onclick = () => {
    if (!audioElement.src) return;
    if (audioElement.paused) {
        audioElement.play();
        btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    } else {
        audioElement.pause();
        btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>';
    }
};

btnNext.onclick = () => {
    if (audioFilesFlat.length === 0) return;
    currentSongIndex = (currentSongIndex + 1) % audioFilesFlat.length;
    playAudioFile(audioFilesFlat[currentSongIndex], currentSongIndex);
};

btnPrev.onclick = () => {
    if (audioFilesFlat.length === 0) return;
    currentSongIndex = (currentSongIndex - 1 + audioFilesFlat.length) % audioFilesFlat.length;
    playAudioFile(audioFilesFlat[currentSongIndex], currentSongIndex);
};

audioElement.onended = () => {
    btnNext.click();
};

// Progresso e Tempos
audioElement.ontimeupdate = () => {
    if (audioElement.duration) {
        progressBar.value = (audioElement.currentTime / audioElement.duration) * 100;
        timeCurrent.textContent = formatTime(audioElement.currentTime);
        timeTotal.textContent = formatTime(audioElement.duration);
    }
};

progressBar.oninput = (e) => {
    if (audioElement.duration) {
        audioElement.currentTime = (e.target.value / 100) * audioElement.duration;
    }
};

function formatTime(secs) {
    let m = Math.floor(secs / 60);
    let s = Math.floor(secs % 60);
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
}

// Web Audio API & Efeitos Espaciais (3D, 8D, 16D)
function initAudioContext() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceNode = audioCtx.createMediaElementSource(audioElement);
    pannerNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
    
    if (pannerNode) {
        sourceNode.connect(pannerNode);
        pannerNode.connect(audioCtx.destination);
    } else {
        sourceNode.connect(audioCtx.destination);
    }
}

audioEffectSelect.onchange = (e) => {
    const val = e.target.value;
    clearInterval(rotationInterval);
    if (!pannerNode) return;

    if (val === 'normal') {
        pannerNode.pan.value = 0;
    } else if (val === '3d') {
        pannerNode.pan.value = 0.75; // Foco lateral fixo
    } else if (val === '8d' || val === '16d') {
        let angle = 0;
        let speed = val === '8d' ? 0.03 : 0.08;
        rotationInterval = setInterval(() => {
            angle += speed;
            pannerNode.pan.value = Math.sin(angle); // Rotaciona esquerda/direita suavemente
        }, 50);
    }
};

// Sistema de Favoritos (Simulação de Playlists)
btnFavorite.onclick = () => {
    const currentName = currentSongTitle.textContent;
    if (currentName === 'Nenhuma música tocando') return;

    const index = favorites.indexOf(currentName);
    if (index >= 0) {
        favorites.splice(index, 1);
    } else {
        favorites.push(currentName);
    }
    localStorage.setItem('aiivo_favorites', JSON.stringify(favorites));
    updateFavoriteButtonUI(currentName);
};

function updateFavoriteButtonUI(songName) {
    if (favorites.includes(songName)) {
        btnFavorite.innerHTML = '<i class="fa-solid fa-heart" style="color:var(--primary-color)"></i>';
    } else {
        btnFavorite.innerHTML = '<i class="fa-regular fa-heart"></i>';
    }
}

btnFilterFavorites.onclick = () => {
    isShowingFavorites = !isShowingFavorites;
    settingsModal.classList.add('hidden');
    if (isShowingFavorites) {
        currentPathLabel.textContent = "Favoritos Filtrados";
        explorerList.innerHTML = '';
        
        // Filtra da lista global atual os favoritos
        const favFiles = audioFilesFlat.filter(f => favorites.includes(f.name));
        if(favFiles.length === 0) {
            explorerList.innerHTML = `<div class="welcome-message"><p>Nenhum favorito encontrado nesta pasta.</p></div>`;
            return;
        }

        favFiles.forEach(fileObj => {
            const div = document.createElement('div');
            div.className = 'explorer-item';
            div.innerHTML = `<i class="fa-solid fa-heart" style="color:var(--primary-color)"></i><span>${fileObj.name}</span>`;
            div.onclick = () => playAudioFile(fileObj, audioFilesFlat.indexOf(fileObj));
            explorerList.appendChild(div);
        });
    } else {
        if(currentDirectoryHandle) loadDirectory(currentDirectoryHandle);
    }
};

// Volume Vertical & Toggle
btnVolumeToggle.onclick = () => {
    volumePopup.classList.toggle('show');
};

volumeSlider.oninput = (e) => {
    audioElement.volume = e.target.value;
    if(e.target.value == 0) {
        btnVolumeToggle.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else if(e.target.value < 0.5) {
        btnVolumeToggle.innerHTML = '<i class="fa-solid fa-volume-low"></i>';
    } else {
        btnVolumeToggle.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }
};

// Modal Configurações e Cores
btnSettings.onclick = () => settingsModal.classList.remove('hidden');
btnCloseSettings.onclick = () => settingsModal.classList.add('hidden');

colorPrimary.oninput = (e) => {
    document.documentElement.style.setProperty('--primary-color', e.target.value);
};
colorBg.oninput = (e) => {
    document.documentElement.style.setProperty('--bg-color', e.target.value);
};
colorText.oninput = (e) => {
    document.documentElement.style.setProperty('--text-color', e.target.value);
};
