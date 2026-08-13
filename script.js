let rootDirectoryHandle = null;
let currentDirectoryHandle = null;
let directoryHistory = [];
let audioFilesFlat = [];
let currentSongIndex = 0;
const audioElement = new Audio();
let audioCtx = null;
let pannerNode = null;
let rotationInterval = null;
let favorites = JSON.parse(localStorage.getItem('aiivo_favorites') || '[]');
let isShowingFavorites = false;

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

btnSelectRoot.addEventListener('click', async () => {
    try {
        rootDirectoryHandle = await window.showDirectoryPicker();
        currentDirectoryHandle = rootDirectoryHandle;
        directoryHistory = [];
        await loadDirectory(rootDirectoryHandle);
    } catch (err) { console.log('Erro:', err); }
});

// Carregamento rápido: lê apenas o nível atual da pasta instantaneamente
async function loadDirectory(dirHandle, pathName = dirHandle.name) {
    currentDirectoryHandle = dirHandle;
    currentPathLabel.textContent = pathName;
    btnBack.disabled = directoryHistory.length === 0;
    explorerList.innerHTML = '<div class="welcome-message"><p>Carregando...</p></div>';
    
    audioFilesFlat = [];
    let entries = [];

    for await (const entry of dirHandle.values()) {
        entries.push(entry);
    }

    // Ordenar pastas primeiro, depois arquivos
    entries.sort((a, b) => {
        if (a.kind === b.kind) return a.name.localeCompare(b.name);
        return a.kind === 'directory' ? -1 : 1;
    });

    explorerList.innerHTML = '';

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
        } else if (entry.kind === 'file' && isAudioFile(entry.name)) {
            const fileObj = await entry.getFile();
            audioFilesFlat.push(fileObj);

            const div = document.createElement('div');
            div.className = 'explorer-item';
            div.innerHTML = `<i class="fa-solid fa-file-audio"></i><span>${entry.name}</span>`;
            div.onclick = () => playAudioFile(fileObj, audioFilesFlat.indexOf(fileObj));
            explorerList.appendChild(div);
        }
    }

    // Se houver subpastas, fazemos a varredura recursiva em segundo plano (sem traçar a tela) para manter o botão "Próxima" funcionando perfeitamente
    backgroundRecursiveCollect(dirHandle);
}

async function backgroundRecursiveCollect(dirHandle) {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
            backgroundRecursiveCollect(entry);
        } else if (entry.kind === 'file' && isAudioFile(entry.name)) {
            const fileObj = await entry.getFile();
            if (!audioFilesFlat.some(f => f.name === fileObj.name)) {
                audioFilesFlat.push(fileObj);
            }
        }
    }
}

function isAudioFile(filename) { return ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(filename.split('.').pop().toLowerCase()); }

async function playAudioFile(fileObj, index) {
    currentSongIndex = index;
    audioElement.src = URL.createObjectURL(fileObj);
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const source = audioCtx.createMediaElementSource(audioElement);
        pannerNode = audioCtx.createStereoPanner ? audioCtx.createStereoPanner() : null;
        if (pannerNode) source.connect(pannerNode).connect(audioCtx.destination);
        else source.connect(audioCtx.destination);
    }
    audioElement.play();
    btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>';
    currentSongTitle.textContent = fileObj.name;
}

btnPlayPause.onclick = () => { if (audioElement.paused) { audioElement.play(); btnPlayPause.innerHTML = '<i class="fa-solid fa-pause"></i>'; } else { audioElement.pause(); btnPlayPause.innerHTML = '<i class="fa-solid fa-play"></i>'; } };
btnNext.onclick = () => { if(audioFilesFlat.length === 0) return; currentSongIndex = (currentSongIndex + 1) % audioFilesFlat.length; playAudioFile(audioFilesFlat[currentSongIndex], currentSongIndex); };
btnPrev.onclick = () => { if(audioFilesFlat.length === 0) return; currentSongIndex = (currentSongIndex - 1 + audioFilesFlat.length) % audioFilesFlat.length; playAudioFile(audioFilesFlat[currentSongIndex], currentSongIndex); };
audioElement.ontimeupdate = () => { if(audioElement.duration) progressBar.value = (audioElement.currentTime / audioElement.duration) * 100; };

btnSettings.onclick = () => settingsModal.classList.remove('hidden');
btnCloseSettings.onclick = () => settingsModal.classList.add('hidden');
btnVolumeToggle.onclick = () => volumePopup.classList.toggle('show');
volumeSlider.oninput = (e) => audioElement.volume = e.target.value;

colorPrimary.oninput = (e) => document.documentElement.style.setProperty('--primary-color', e.target.value);
colorBg.oninput = (e) => document.documentElement.style.setProperty('--bg-color', e.target.value);
colorText.oninput = (e) => document.documentElement.style.setProperty('--text-color', e.target.value);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
}
