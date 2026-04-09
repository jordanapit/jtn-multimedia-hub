const { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme, session, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { execSync, exec } = require('child_process');

let mainWindow;

if (require('electron-squirrel-startup')) {
    app.quit();
}

const APP_URL = 'https://absen.hkbpjtn.web.id/multimedia';

autoUpdater.autoDownload = true; 
autoUpdater.autoInstallOnAppQuit = true; 

autoUpdater.on('update-downloaded', (info) => {
    // Tambahkan 'mainWindow' sebagai argumen pertama agar dialog bersifat modal
    dialog.showMessageBox(mainWindow || null, {
        type: 'info',
        title: 'Pembaruan Aplikasi',
        message: `Versi terbaru (${info.version}) tersedia.`,
        detail: 'Aplikasi akan diperbarui secara otomatis saat Anda menutupnya nanti. Atau, Anda bisa melakukan Restart sekarang untuk langsung menerapkan pembaruan.',
        buttons: ['Restart Aplikasi', 'Nanti Saja'],
        defaultId: 0,
        cancelId: 1
    }).then((result) => {
        if (result.response === 0) {
            autoUpdater.quitAndInstall(true, true);
        }
    });
});

async function checkForUpdates() {
    try {
        console.log("Mencari update di background...");
        await autoUpdater.checkForUpdates();
        return false; 
    } catch (error) {
        console.log("Gagal mengecek update (mungkin offline):", error);
        return false;
    }
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 768,
        minHeight: 768,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: 'rgba(0, 0, 0, 0)', 
            symbolColor: '#1a1a1a',
            height: 70 // FIXED: Ukuran default WCO dikembalikan ke 35px
        },
        transparent: false,     
        backgroundColor: '#00000000', 
        backgroundMaterial: 'mica',   
        show: false, 
        webPreferences: {
            plugins: true, // <--- TAMBAHKAN BARIS INI AGAR BISA BACA PDF
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true
        },
        icon: path.join(__dirname, 'assets/picture/favicon.png')
    });

    // BYPASS KEAMANAN SERVER AGAR PDF BISA TAMPIL DI IFRAME
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        const newHeaders = Object.assign({}, details.responseHeaders);
        delete newHeaders['X-Frame-Options'];
        delete newHeaders['x-frame-options'];
        delete newHeaders['Content-Security-Policy'];
        delete newHeaders['content-security-policy'];
        callback({ responseHeaders: newHeaders });
    });

    const cookies = await session.defaultSession.cookies.get({ url: APP_URL });
    const hasCookies = cookies.some(c => c.name === 'remember_token'); 

    let queryParams = { startup: '1' };
    if (hasCookies) queryParams.has_cookies = '1';

    mainWindow.loadFile('login.html', { query: queryParams });

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    const authUrls = [
        'https://absen.hkbpjtn.web.id/multimedia/auth',
        'https://absen.hkbpjtn.web.id/multimedia/auth/',
        'https://absen.hkbpjtn.web.id/multimedia/auth/index',
        'https://absen.hkbpjtn.web.id/multimedia/auth/index/'
    ];

    const handleAuthRedirect = (event, url) => {
        const urlObj = new URL(url);
        let cleanUrl = url.split('?')[0].replace(/\/$/, "");
        
        if (authUrls.includes(cleanUrl)) {
            if (urlObj.searchParams.get('from_local') === '1') return;

            event.preventDefault(); 
            if (urlObj.searchParams.get('logout') === 'success') {
                mainWindow.loadFile('login.html', { query: { logout: 'success' } });
            } else {
                mainWindow.loadFile('login.html', { query: { skip_splash: '1' } }); 
            }
        }
    };

    mainWindow.webContents.on('will-redirect', handleAuthRedirect);
    mainWindow.webContents.on('will-navigate', handleAuthRedirect);
    
    mainWindow.webContents.on('did-navigate', (event, url) => {
        const urlObj = new URL(url);
        let cleanUrl = url.split('?')[0].replace(/\/$/, "");
        if (authUrls.includes(cleanUrl)) {
            if (urlObj.searchParams.get('from_local') === '1') return;
            mainWindow.loadFile('login.html', { query: { skip_splash: '1' } }); 
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.toLowerCase().endsWith('.pdf') || url.includes('.pdf?')) {
            const fileName = path.basename(url).split('?')[0];
            mainWindow.loadFile(path.join(__dirname, 'pdf-viewer.html'), { 
                query: { file: url, title: decodeURIComponent(fileName) } 
            });
            mainWindow.setTitleBarOverlay({ color: '#323639', symbolColor: '#ffffff', height: 48 });
            return { action: 'deny' }; 
        }

        if (url.startsWith('whatsapp:') || url.startsWith('ms-windows-store:')) {
            shell.openExternal(url); 
            return { action: 'deny' };
        }

        if (url.startsWith('http:') || url.startsWith('https:')) {
            if (url.includes('drive.google.com') || url.includes('docs.google.com')) {
                handleSmartDownload(url); 
                return { action: 'deny' };
            } 
            else if (url.includes('force_download')) {
                mainWindow.webContents.downloadURL(url);
                return { action: 'deny' };
            }
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });

    mainWindow.webContents.on('did-commit-navigation', () => {
        const customCSS = `
            html, body { background-color: transparent !important; }
            .navbar-greeting, h1.greeting-class { visibility: hidden !important; opacity: 0 !important; }
        `;
        mainWindow.webContents.insertCSS(customCSS, { cssOrigin: 'user' }).catch(err => console.log(err));
    });

    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        if (errorCode === -3) return; 
        if (errorCode === -102 || errorCode === -105 || errorCode === -106) {
            mainWindow.loadFile(path.join(__dirname, 'offline.html'));
        }
    });

    // 1. SUNTIKKAN COOKIE KE IFRAME (Agar PDF tidak melempar ke Login Page)
    mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
        { urls: ['https://absen.hkbpjtn.web.id/*'] },
        (details, callback) => {
            // PERBAIKAN: Gunakan session.defaultSession agar aman dari ancaman null saat app ditutup
            session.defaultSession.cookies.get({ url: 'https://absen.hkbpjtn.web.id' })
                .then((cookies) => {
                    if (cookies.length > 0) {
                        const cookieStr = cookies.map(c => c.name + '=' + c.value).join('; ');
                        details.requestHeaders['Cookie'] = cookieStr;
                    }
                    callback({ requestHeaders: details.requestHeaders });
                }).catch(() => callback({ requestHeaders: details.requestHeaders }));
        }
    );

    // 2. CEGAH DOWNLOAD & HAPUS BLOKADE (Agar PDF tampil di dalam Iframe)
    mainWindow.webContents.session.webRequest.onHeadersReceived(
        { urls: ['https://absen.hkbpjtn.web.id/*'] },
        (details, callback) => {
            const headers = Object.assign({}, details.responseHeaders);
            
            delete headers['X-Frame-Options'];
            delete headers['x-frame-options'];
            delete headers['Content-Security-Policy'];
            delete headers['content-security-policy'];
            
            const cd = headers['Content-Disposition'] || headers['content-disposition'];
            if (cd) {
                const cdStr = Array.isArray(cd) ? cd[0] : cd;
                if (cdStr.toLowerCase().includes('attachment') && details.url.includes('generate_pdf')) {
                    // Paksa Chrome merender PDF, bukan mendownloadnya
                    headers['Content-Disposition'] = [cdStr.replace(/attachment/i, 'inline')];
                    headers['content-disposition'] = [cdStr.replace(/attachment/i, 'inline')];
                }
            }
            callback({ responseHeaders: headers });
        }
    );

    mainWindow.on('maximize', () => { mainWindow.webContents.send('maximize-change', true); });
    mainWindow.on('unmaximize', () => { mainWindow.webContents.send('maximize-change', false); });

    mainWindow.on('close', (event) => {
        if (currentAppConfigs.runInBackground && !app.isQuiting) {
            event.preventDefault(); // Cegah penutupan
            mainWindow.hide(); // Sembunyikan ke tray
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        if (projectorWindow && !projectorWindow.isDestroyed()) projectorWindow.close();
    });
}

function openPDFWindow(pdfUrl, title) {
    let pdfWin = new BrowserWindow({
        width: 1200, height: 800, frame: false, titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#323639', symbolColor: '#ffffff', height: 48 },
        webPreferences: { plugins: true, nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });

    const updateWCO = (isFocused) => {
        if (pdfWin && !pdfWin.isDestroyed()) {
            setTimeout(() => {
                pdfWin.setTitleBarOverlay({ color: '#323639', symbolColor: isFocused ? '#ffffff' : '#9eaab7', height: 48 });
                pdfWin.webContents.send('pdf-window-focus', isFocused);
            }, 50);
        }
    };

    pdfWin.on('focus', () => updateWCO(true));
    pdfWin.on('blur', () => updateWCO(false));
    pdfWin.loadFile('pdf-viewer.html', { query: { file: pdfUrl } });
    pdfWin.show();
}

function handleSmartDownload(url) {
    let dlWin = new BrowserWindow({
        width: 800, height: 400, parent: mainWindow, modal: true, show: false, frame: true, autoHideMenuBar: true, 
        title: "Google Drive - JTN Multimedia Hub", backgroundMaterial: 'mica', icon: path.join(__dirname, 'assets/picture/favicon.png'), 
        maximizable: false, minimizable: false, resizable: true, 
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    dlWin.removeMenu();
    dlWin.on('page-title-updated', (event) => { event.preventDefault(); dlWin.setTitle("Google Drive - JTN Multimedia Hub"); });

    const beepListener = () => { if (dlWin && !dlWin.isDestroyed()) { shell.beep(); dlWin.focus(); } };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.on('focus', beepListener);

    dlWin.webContents.on('did-finish-load', () => {
        dlWin.webContents.insertCSS(`
            html, body, div, iframe { overflow: hidden !important; }
            hr, .uc-divider, .uc-page-divider { display: none !important; }
            body > div, body > div > div { border-top: none !important; border-bottom: none !important; }
        `).catch(e => {});

        if (dlWin && !dlWin.isDestroyed()) {
            dlWin.show(); dlWin.focus(); 
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.executeJavaScript(`
                    $('#globalDownloadModal').modal('hide'); $('.modal-backdrop').remove(); $('body').removeClass('modal-open');
                `).catch(e => {});
            }
        }
    });

    dlWin.on('closed', () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.removeListener('focus', beepListener);
        dlWin = null;
    });

    dlWin.loadURL(url);
}

// ========================================================
// IPC HANDLERS & BRANKAS TEMA
// ========================================================
let isAppDarkGlobal = false;

// ========================================================
// IPC HANDLERS - VERSI BERSIH & ANTI-MACET
// ========================================================

// 1. FIX TINGGI TOMBOL (WCO) & ANTI-CRASH SAAT APLIKASI DITUTUP
ipcMain.on('update-wco', (event, options) => {
    // Ambil window spesifik yang mengirim sinyal, bukan global mainWindow
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
        try {
            win.setTitleBarOverlay({
                color: options.color || 'rgba(0, 0, 0, 0)',
                symbolColor: options.symbolColor || '#000000',
                height: options.height || 35
            });
        } catch(e) { /* Abaikan jika jendela sedang proses ditutup */ }
    }
});

// Hapus listener 'update-theme-state' lama yang isinya height: 70
ipcMain.on('update-theme-state', (event, isDark) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win && !win.isDestroyed()) {
        try {
            win.setTitleBarOverlay({ 
                color: 'rgba(0, 0, 0, 0)', 
                symbolColor: isDark ? '#ffffff' : '#1a1a1a', 
                height: 35 
            });
        } catch(e) {}
    }
});

ipcMain.on('open-pdf-viewer', (event, pdfUrl) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const targetUrl = (typeof pdfUrl === 'string') ? pdfUrl : pdfUrl.url;
        // Buka di Window yang sama (mainWindow)
        mainWindow.loadFile(path.join(__dirname, 'pdf-viewer.html'), {
            query: { file: targetUrl }
        });
        mainWindow.setTitleBarOverlay({ color: '#323639', symbolColor: '#ffffff', height: 48 });
    }
});

const themePrefsPath = path.join(app.getPath('userData'), 'theme_prefs.json');

ipcMain.handle('get-app-theme', () => {
    try {
        if (fs.existsSync(themePrefsPath)) {
            return JSON.parse(fs.readFileSync(themePrefsPath, 'utf8')).theme;
        }
    } catch(e) {}
    return 'system';
});

ipcMain.on('set-app-theme', (event, theme) => {
    try {
        fs.writeFileSync(themePrefsPath, JSON.stringify({theme: theme}));
        BrowserWindow.getAllWindows().forEach(win => {
            if (win && !win.isDestroyed() && win.webContents) { // <--- TAMBAH PELINDUNG INI
                win.webContents.send('sync-theme-realtime', theme);
            }
        });
    } catch(e) {}
});

// FIXED: Detektor OS Theme Native (Bypass kuncian Mica, baca Registry langsung)
ipcMain.handle('get-os-theme', () => {
    try {
        const stdout = execSync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme', { encoding: 'utf8' });
        // Jika value-nya 0x0 berarti Windows lagi Dark Mode
        return stdout.includes('0x0') ? 'dark' : 'light';
    } catch (e) {
        return 'light'; // Default jika registry gagal dibaca
    }
});

// Broadcast jika user ubah tema OS dari Windows Settings saat app sedang jalan
nativeTheme.on('updated', () => {
    BrowserWindow.getAllWindows().forEach(win => {
        if (win && !win.isDestroyed() && win.webContents) { // <--- TAMBAH PELINDUNG INI
            win.webContents.send('sync-theme-realtime', 'system');
        }
    });
});

ipcMain.on('open-download-modal', (event, url) => {
    let downloadModal = new BrowserWindow({
        width: 700, height: 600, parent: mainWindow, modal: true, show: false, autoHideMenuBar: true, title: "Konfirmasi Unduhan",
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });
    downloadModal.loadURL(url);
    downloadModal.once('ready-to-show', () => { downloadModal.show(); });
    downloadModal.webContents.session.on('will-download', (event, item, webContents) => {
        if (downloadModal && !downloadModal.isDestroyed()) { downloadModal.close(); }
    });
    downloadModal.on('closed', () => { downloadModal = null; });
});

// ========================================================
// JENDELA TENTANG APLIKASI (ABOUT)
// ========================================================
ipcMain.on('open-about-window', () => {
    let aboutWin = new BrowserWindow({
        width: 480, 
        height: 520, 
        parent: mainWindow, 
        modal: true, // Membuat jendela utama tidak bisa diklik saat About terbuka
        show: false, 
        resizable: false, 
        maximizable: false, 
        minimizable: false,
        titleBarStyle: 'hidden',
        titleBarOverlay: { 
            color: 'rgba(0,0,0,0)', 
            symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#1a1a1a', 
            height: 35 
        },
        backgroundMaterial: 'mica', // Windows 11 efek kaca
        icon: path.join(__dirname, 'assets/picture/favicon.png'),
        webPreferences: { 
            nodeIntegration: false, 
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    aboutWin.loadFile('about.html');
    aboutWin.once('ready-to-show', () => { aboutWin.show(); });
    aboutWin.on('closed', () => { aboutWin = null; });
});

ipcMain.on('open-pdf-in-main', (event, pdfUrl) => {
    const targetUrl = decodeURIComponent(pdfUrl);
    const tempPath = path.join(app.getPath('temp'), 'Rincian_Transport.pdf');
    
    // Sedot file pakai mesin inti Electron (Otomatis membawa Session Login)
    const request = require('electron').net.request(targetUrl);
    
    request.on('response', (response) => {
        const fileStream = fs.createWriteStream(tempPath);
        response.on('data', (chunk) => { fileStream.write(chunk); });
        
        response.on('end', () => {
            fileStream.end();
            if (mainWindow && !mainWindow.isDestroyed()) {
                // Tampilkan file PDF fisik yang sudah berhasil di-download
                const localFileUrl = "file:///" + tempPath.replace(/\\/g, '/');
                mainWindow.loadFile(path.join(__dirname, 'pdf-viewer.html'), {
                    query: { file: localFileUrl }
                });
                mainWindow.setTitleBarOverlay({ color: '#323639', symbolColor: '#ffffff', height: 48 });
            }
        });
    });
    
    request.on('error', (err) => {
        console.log("Gagal menyedot PDF:", err);
    });
    
    request.end();
});

ipcMain.on('minimize-window', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win) win.minimize();
});
ipcMain.on('maximize-window', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
});
ipcMain.on('close-window', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    if (win) win.close();
});
ipcMain.handle('is-maximized', () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    return win ? win.isMaximized() : false;
});
ipcMain.on('retry-connection', () => {
    if (mainWindow) mainWindow.loadFile('login.html');
});
ipcMain.handle('open-external', async (event, url) => {
    try {
        if (url.startsWith('whatsapp:') || url.startsWith('ms-windows-store:') || url.startsWith('http')) {
            await shell.openExternal(url); return true; 
        }
        return false;
    } catch (error) { return false; }
});

ipcMain.handle('get-startup-status', () => { return app.getLoginItemSettings().openAtLogin; });
ipcMain.on('toggle-startup', (event, enable) => { app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath('exe') }); });
ipcMain.handle('get-app-version', () => app.getVersion());

// ========================================================
// RADAR TEMA WINDOWS REAL-TIME (BYPASS MICA LOCK)
// ========================================================
let lastKnownOsTheme = 'light';

function startOSThemeRadar() {
    setInterval(() => {
        exec('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize /v AppsUseLightTheme', (err, stdout) => {
            if (err) return;
            const currentTheme = stdout.includes('0x0') ? 'dark' : 'light';
            if (currentTheme !== lastKnownOsTheme) {
                lastKnownOsTheme = currentTheme;
                BrowserWindow.getAllWindows().forEach(win => {
                    if (win && !win.isDestroyed() && win.webContents) { // <--- TAMBAH PELINDUNG INI
                        win.webContents.send('sync-theme-realtime', 'system');
                    }
                });
            }
        });
    }, 1000);
}

// ========================================================
// SISTEM PENGATURAN GLOBAL & TRAY ICON
// ========================================================
const appConfigsPath = path.join(app.getPath('userData'), 'jtn_configs.json');
let currentAppConfigs = {
    runInBackground: false,
    projTheme: 'dark',
    projFont: "'Sora', sans-serif",
    projSize: '5.5vw'
};

try {
    if (fs.existsSync(appConfigsPath)) {
        currentAppConfigs = Object.assign(currentAppConfigs, JSON.parse(fs.readFileSync(appConfigsPath, 'utf8')));
    }
} catch (e) {}

function saveAppConfigs() {
    try { fs.writeFileSync(appConfigsPath, JSON.stringify(currentAppConfigs)); } catch (e) {}
}

ipcMain.handle('get-app-configs', () => currentAppConfigs);
ipcMain.on('update-app-config', (event, { key, value }) => {
    currentAppConfigs[key] = value;
    saveAppConfigs();

    // Jika yang diubah adalah setting proyektor, langsung broadcast ke Projector
    if (['projTheme', 'projFont', 'projSize'].includes(key)) {
        if (projectorWindow && !projectorWindow.isDestroyed()) {
            projectorWindow.webContents.send('apply-projector-config', {
                theme: currentAppConfigs.projTheme,
                font: currentAppConfigs.projFont,
                size: currentAppConfigs.projSize
            });
        }
    }
    
    // Jika user menekan Jalankan di Belakang
    if (key === 'runInBackground') manageTray();
});

// GLOBAL TRAY ICON
let tray = null;
app.isQuiting = false; // Flag penting agar app bisa di-close

function manageTray() {
    if (currentAppConfigs.runInBackground) {
        if (tray) return; // Sudah ada
        tray = new Tray(path.join(__dirname, 'assets/picture/favicon.png'));
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Buka Multimedia Hub', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
            { type: 'separator' },
            { label: 'Keluar', click: () => { app.isQuiting = true; app.quit(); } }
        ]);
        tray.setToolTip('JTN Multimedia Hub');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
    } else {
        if (tray) { tray.destroy(); tray = null; }
    }
}

// WINDOW PENGATURAN
ipcMain.on('open-settings-window', () => {
    let settingsWin = new BrowserWindow({
        width: 550, height: 400, parent: mainWindow, modal: true, show: false, 
        resizable: false, maximizable: false, 
        minimizable: false, // <--- TAMBAHKAN BARIS INI
        titleBarStyle: 'hidden', titleBarOverlay: { color: 'rgba(0,0,0,0)', height: 35 },
        backgroundMaterial: 'mica', icon: path.join(__dirname, 'assets/picture/favicon.png'),
        webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    settingsWin.loadFile('settings.html');
    settingsWin.once('ready-to-show', () => { settingsWin.show(); });
});

app.whenReady().then(async () => {
    app.userAgentFallback = app.userAgentFallback + ' JTN-Electron/1.0';
    
    // LOCK Mica dan preferensi warna ke Light Mode secara permanen
    nativeTheme.themeSource = 'light'; 

    // JALANKAN RADAR TEMA DISINI
    startOSThemeRadar();

    const isUpdating = await checkForUpdates();
    if (isUpdating) return; 

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) { createWindow(); }
    });

    manageTray(); // Inisialisasi tray saat app jalan
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') { app.quit(); }
});

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });
}

// ========================================================
// GLOBAL DOWNLOAD MANAGER (NATIVE CHROMIUM ENGINE)
// ========================================================
const activeDownloads = new Map(); 

app.whenReady().then(() => {
    session.defaultSession.on('will-download', (event, item, webContents) => {
        let lastBytes = 0; let lastTime = Date.now(); let uiCreated = false; let dlWin = null;
        const sourceWindow = BrowserWindow.fromWebContents(webContents);
        const isPopup = sourceWindow && sourceWindow !== mainWindow;

        item.setSaveDialogOptions({ title: 'Simpan File - JTN Multimedia Hub' });

        item.on('updated', (event, state) => {
            if (state === 'progressing') {
                if (item.isPaused()) return;
                if (!item.getSavePath()) return;

                if (!uiCreated) {
                    uiCreated = true;
                    if (isPopup && !sourceWindow.isDestroyed()) { sourceWindow.hide(); }

                    dlWin = new BrowserWindow({
                        width: 450, height: 160, resizable: false, maximizable: false, minimizable: false,
                        parent: mainWindow, modal: false, titleBarStyle: 'hidden', backgroundMaterial: 'mica',
                        webPreferences: { preload: path.join(__dirname, 'preload_dl_ui.js'), contextIsolation: true, nodeIntegration: false }
                    });
                    
                    dlWin.loadFile('download-ui.html');
                    activeDownloads.set(dlWin.id, item); 

                    dlWin.webContents.on('did-finish-load', () => {
                        if (isAppDarkGlobal) { dlWin.webContents.executeJavaScript(`document.body.classList.add('dark-mode');`).catch(e => console.log(e)); }
                    });

                    dlWin.on('closed', () => {
                        if (item && item.getState() === 'progressing') item.cancel();
                        activeDownloads.delete(dlWin.id);
                    });
                }

                const currentBytes = item.getReceivedBytes(); const totalBytes = item.getTotalBytes(); const currentTime = Date.now();
                const timeDiff = (currentTime - lastTime) / 1000; 
                let speed = 0; if (timeDiff > 0) speed = (currentBytes - lastBytes) / timeDiff;

                if (dlWin && !dlWin.isDestroyed()) {
                    dlWin.webContents.send('download-progress', { filename: item.getFilename(), received: currentBytes, total: totalBytes, speed: speed });
                }

                lastBytes = currentBytes; lastTime = currentTime;
            }
        });

        item.once('done', (event, state) => {
            if (uiCreated && dlWin && !dlWin.isDestroyed()) {
                if (state === 'completed') {
                    dlWin.webContents.send('download-complete', { status: 'success', path: item.getSavePath() });
                } else {
                    dlWin.close();
                }
            }
            if (isPopup && !sourceWindow.isDestroyed()) { sourceWindow.close(); }
        });
    });
});

ipcMain.removeAllListeners('cancel-active-download');
ipcMain.removeAllListeners('open-downloaded-file');

ipcMain.on('cancel-active-download', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin) {
        const item = activeDownloads.get(senderWin.id);
        if (item && item.getState() === 'progressing') item.cancel();
        senderWin.close(); 
    }
});

ipcMain.on('open-downloaded-file', (event, filePath) => {
    shell.openPath(filePath); 
    const senderWin = BrowserWindow.fromWebContents(event.sender);
    if (senderWin && !senderWin.isDestroyed()) { senderWin.close(); }
});

// ========================================================
// SISTEM SLIDE SHOW PROYEKTOR (DUAL MONITOR)
// ========================================================
let projectorWindow = null;

ipcMain.on('start-presentation', () => {
    if (projectorWindow) return; 

    const displays = screen.getAllDisplays();
    let externalDisplay = displays.find((display) => {
        return display.bounds.x !== 0 || display.bounds.y !== 0;
    });

    const targetDisplay = externalDisplay || screen.getPrimaryDisplay();

    projectorWindow = new BrowserWindow({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: targetDisplay.bounds.width,
        height: targetDisplay.bounds.height,
        fullscreen: true,
        frame: false,
        alwaysOnTop: false, 
        backgroundMaterial: 'mica', 
        backgroundColor: '#00000000', 
        show: false, 
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    projectorWindow.loadFile('projector.html');

    projectorWindow.once('ready-to-show', () => {
        projectorWindow.showInactive(); 
        
        // LANGSUNG TEMBAKKAN PENGATURAN TERAKHIR SAAT PROYEKTOR MUNCUL
        projectorWindow.webContents.send('apply-projector-config', {
            theme: currentAppConfigs.projTheme,
            font: currentAppConfigs.projFont,
            size: currentAppConfigs.projSize
        });
    });

    projectorWindow.on('closed', () => {
        projectorWindow = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('presentation-stopped');
        }
    });
});

ipcMain.on('stop-presentation', () => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.close();
    }
});

ipcMain.on('send-to-projector', (event, htmlText) => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.webContents.send('update-projector-text', htmlText);
    }
});

ipcMain.on('update-projector-config', (event, config) => {
    if (projectorWindow && !projectorWindow.isDestroyed()) {
        projectorWindow.webContents.send('apply-projector-config', config);
    }
});