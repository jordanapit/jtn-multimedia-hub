const { contextBridge, ipcRenderer } = require("electron");

// --- EXPOSE API KE RENDERER (Frontend) ---
contextBridge.exposeInMainWorld("electronAPI", {
    // Window Controls
    minimize: () => ipcRenderer.send("minimize-window"),
    maximize: () => ipcRenderer.send("maximize-window"),
    close: () => ipcRenderer.send("close-window"),

    // Splash Screen & Loading
    splashDone: () => ipcRenderer.send("splash-done"),
    onLoadingStatus: (callback) => { ipcRenderer.on('loading-status', (event, status) => callback(status)); },
    onAppReady: (callback) => { ipcRenderer.on('app-ready', () => callback()); },

    // Startup & WCO
    getStartupStatus: () => ipcRenderer.invoke('get-startup-status'),
    toggleStartup: (enable) => ipcRenderer.send('toggle-startup', enable),
    updateWCO: (options) => ipcRenderer.send('update-wco', options),
    retryConnection: () => ipcRenderer.send("retry-connection"),
    
    // Maximize State
    onMaximizeChange: (callback) => { ipcRenderer.on('maximize-change', (event, isMaximized) => { callback(event, isMaximized); }); },
    isMaximized: () => ipcRenderer.invoke('is-maximized'),

    // Links & PDF
    openExternal: (url) => ipcRenderer.invoke('open-external', url),
    onWindowFocus: (callback) => ipcRenderer.on('pdf-window-focus', (event, isFocused) => callback(isFocused)),
    openDownloadModal: (url) => ipcRenderer.send('open-download-modal', url),

    // System & Theme
    getOSTheme: () => ipcRenderer.invoke('get-os-theme'),
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getAppTheme: () => ipcRenderer.invoke('get-app-theme'),
    setAppTheme: (theme) => ipcRenderer.send('set-app-theme', theme),
    onSyncThemeRealtime: (callback) => ipcRenderer.on('sync-theme-realtime', (event, theme) => callback(theme)),

    // About App
    openAboutWindow: () => ipcRenderer.send('open-about-window'),

    // Presentation / Projector
    getDisplays: () => ipcRenderer.invoke('get-displays'),
    startPresentation: (monitorId) => ipcRenderer.send('start-presentation', monitorId), // (Ubah baris startPresentation yang lama jadi seperti ini)
    stopPresentation: () => ipcRenderer.send('stop-presentation'),
    sendToProjector: (text) => ipcRenderer.send('send-to-projector', text),
    onUpdateProjectorText: (callback) => ipcRenderer.on('update-projector-text', (event, text) => callback(text)),
    onPresentationStopped: (callback) => ipcRenderer.on('presentation-stopped', () => callback()),
    updateProjectorConfig: (config) => ipcRenderer.send('update-projector-config', config),
    onApplyProjectorConfig: (callback) => ipcRenderer.on('apply-projector-config', (event, config) => callback(config)),

    // Tambahkan ini di dalam contextBridge.exposeInMainWorld("electronAPI", { ... })
    openPDFInMain: (url) => ipcRenderer.send("open-pdf-in-main", url),

    // Settings Window
    openSettingsWindow: () => ipcRenderer.send('open-settings-window'),
    getAppConfigs: () => ipcRenderer.invoke('get-app-configs'),
    updateAppConfig: (key, value) => ipcRenderer.send('update-app-config', { key, value }),
});

// --- LOGIKA DRAG & DROP SPESIFIK URL ---
window.addEventListener('DOMContentLoaded', () => {
    const allowedPages = [
        '/multimedia/user/upload',
        '/multimedia/admin/unggahjadwal'
    ];

    function isPageAllowed() {
        const currentPath = window.location.href;
        return allowedPages.some(page => currentPath.includes(page));
    }

    document.addEventListener('dragover', (event) => {
        event.preventDefault();
        if (!isPageAllowed()) {
            event.dataTransfer.dropEffect = 'none';
        }
    });

    document.addEventListener('drop', (event) => {
        if (!isPageAllowed()) {
            event.preventDefault();
            event.stopPropagation();
        }
    });
});

// ==========================================
// JURUS PAMUNGKAS: BLINDFOLD & NINJA OBSERVER
// ==========================================
const style = document.createElement('style');
style.textContent = `
    /* Sembunyikan isi web SELAMA html belum punya class 'jtn-ready' */
    html:not(.jtn-ready) body {
        opacity: 0 !important;
        visibility: hidden !important;
    }
    /* Paksa Mica transparan permanen */
    html, body, #root, #app, .wrapper, .main-content, .container-fluid {
        background-color: transparent !important;
        background: transparent !important;
    }
`;
document.documentElement.appendChild(style);

const observer = new MutationObserver(() => {
    const sapaan = document.querySelector('.navbar-greeting') || document.querySelector('h1'); 
    
    if (sapaan && !sapaan.dataset.jtnModified) {
        sapaan.innerText = "JTN Multimedia Hub"; 
        sapaan.dataset.jtnModified = "true";     
    }

    if (document.body && !document.documentElement.classList.contains('jtn-ready')) {
        document.documentElement.classList.add('jtn-ready');
    }
});

observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true 
});

window.addEventListener('DOMContentLoaded', () => {
    if (!document.documentElement.classList.contains('jtn-ready')) {
        document.documentElement.classList.add('jtn-ready');
    }
});

// ==========================================
// GLOBAL THEME ENFORCER (ELECTRON MASTER)
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        // Ambil tema asli dari Brankas main.js
        const savedTheme = await ipcRenderer.invoke('get-app-theme');
        
        const forceApplyTheme = async (theme) => {
            let isDark = false;
            if (theme === 'dark') {
                isDark = true;
            } else if (theme === 'system') {
                isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            }
            if (isDark) {
                document.body.classList.add('dark-mode');
            } else {
                document.body.classList.remove('dark-mode');
            }

            // RADAR PINTAR: Deteksi sidebar murni (Login tidak punya ini)
            const isDashboard = document.getElementById('accordionSidebar') !== null;
            const isPDFViewer = document.querySelector('.pdf-header') !== null;
            
            let tinggiWCO = 35; // Default untuk Login & Modal
            if (isDashboard) tinggiWCO = 70; // Untuk Dashboard
            if (isPDFViewer) tinggiWCO = 48; // Untuk PDF Reader

            // Kirim tinggi yang BENAR ke main.js
            ipcRenderer.send('update-wco', {
                color: 'rgba(0, 0, 0, 0)',
                symbolColor: isDark ? '#ffffff' : '#1a1a1a',
                height: tinggiWCO
            });

            localStorage.setItem('appTheme', theme);
        };

        // Terapkan saat halaman baru beres dimuat
        await forceApplyTheme(savedTheme);

        // Pasang Telinga: Kalau kamu ganti tema dari tab lain, halaman ini langsung ikut berubah
        ipcRenderer.on('sync-theme-realtime', (event, newTheme) => {
            forceApplyTheme(newTheme);
        });

        // Kalau kamu ganti opsi dropdown tema dari dalam web CI, laporkan ke main.js
        const attachListeners = () => {
            const themeSelects = document.querySelectorAll('#themeSelectStand, #themeSelect');
            themeSelects.forEach(select => {
                if (!select.dataset.electronBound) {
                    select.addEventListener('change', (e) => {
                        const val = e.target.value;
                        ipcRenderer.send('set-app-theme', val); 
                    });
                    select.dataset.electronBound = "true";
                }
            });
        }
        
        attachListeners();
        
        // Pantau terus barangkali Modal Setting-nya baru muncul belakangan
        const domObserver = new MutationObserver(() => { attachListeners(); });
        domObserver.observe(document.body, { childList: true, subtree: true });

    } catch (e) {
        console.error("Gagal menjalankan Global Theme Enforcer:", e);
    }
});