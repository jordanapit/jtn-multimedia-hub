const { app, BrowserWindow, shell, ipcMain, dialog, nativeTheme, session, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const { execSync, exec } = require('child_process');

// --- 1. DAFTARKAN PROTOKOL jtn:// KE SISTEM OPERASI ---
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('jtn', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('jtn');
}

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

    const isStartupLaunch = process.argv.includes('--startup');

    mainWindow.once('ready-to-show', () => {
        // Jika dijalankan lewat startup DAN user ingin sembunyi di background
        if (isStartupLaunch && currentAppConfigs.runInBackground) {
            mainWindow.hide(); 
            console.log("App started silently in background");
        } else {
            mainWindow.show();
        }
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
            
            // PERBAIKAN: Cek cookie diam-diam sebelum melempar ke login.html
            session.defaultSession.cookies.get({ url: APP_URL }).then((cookies) => {
                const hasCookies = cookies.some(c => c.name === 'remember_token');
                let qParams = {};
                
                // Jika token ada, selipkan parameter ini agar login.html otomatis masuk
                if (hasCookies) qParams.has_cookies = '1';

                if (urlObj.searchParams.get('logout') === 'success') {
                    qParams.logout = 'success';
                    mainWindow.loadFile('login.html', { query: qParams });
                } else {
                    qParams.skip_splash = '1';
                    mainWindow.loadFile('login.html', { query: qParams }); 
                }
            });
        }
    };

    mainWindow.webContents.on('will-redirect', handleAuthRedirect);
    mainWindow.webContents.on('will-navigate', handleAuthRedirect);
    
    mainWindow.webContents.on('did-navigate', (event, url) => {
        const urlObj = new URL(url);
        let cleanUrl = url.split('?')[0].replace(/\/$/, "");
        if (authUrls.includes(cleanUrl)) {
            if (urlObj.searchParams.get('from_local') === '1') return;
            
            // PERBAIKAN: Sama seperti di atas, pastikan cek cookie dulu
            session.defaultSession.cookies.get({ url: APP_URL }).then((cookies) => {
                const hasCookies = cookies.some(c => c.name === 'remember_token');
                let qParams = { skip_splash: '1' };
                if (hasCookies) qParams.has_cookies = '1';
                mainWindow.loadFile('login.html', { query: qParams }); 
            });
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
        if (!app.isQuiting) {
            event.preventDefault(); // Cegah penutupan aplikasi
            mainWindow.hide();      // Sembunyikan ke System Tray
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
ipcMain.on('toggle-startup', (event, enable) => {
    app.setLoginItemSettings({ 
        openAtLogin: enable, 
        path: app.getPath('exe'),
        args: ['--startup'] // Flag penting
    });
});
ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-displays', () => {
    const { screen } = require('electron');
    return screen.getAllDisplays().map((d, index) => ({
        id: d.id,
        bounds: d.bounds,
        label: `Monitor ${index + 1} (${d.bounds.width}x${d.bounds.height}) ${d.id === screen.getPrimaryDisplay().id ? '(Utama)' : ''}`
    }));
});

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

// --- BAGIAN 1: SETTING TRAY YANG SELALU AKTIF (ANTI GAGAL) ---
function manageTray() {
    if (tray) return; // Jika sudah ada, jangan buat lagi
    
    try {
        // Ambil path gambar
        const iconPath = path.join(__dirname, 'assets/picture/favicon.png');
        
        // Jurus Paksa: Resize gambar jadi 16x16 pixel agar Windows tidak rewel
        let trayIcon = nativeImage.createFromPath(iconPath);
        trayIcon = trayIcon.resize({ width: 16, height: 16 });
        
        tray = new Tray(trayIcon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Buka Multimedia Hub', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
            { type: 'separator' },
            { label: 'Keluar', click: () => { app.isQuiting = true; app.quit(); } }
        ]);
        
        tray.setToolTip('JTN Multimedia Hub');
        tray.setContextMenu(contextMenu);
        tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
        
    } catch (error) {
        console.log("Gagal membuat Tray Icon:", error);
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

// PENTING UNTUK WINDOWS: Menyatukan semua jendela ke dalam 1 icon Taskbar
if (process.platform === 'win32') {
    app.setAppUserModelId("id.web.hkbpjtn.multimediahub");
}

app.whenReady().then(async () => {
    app.userAgentFallback = app.userAgentFallback + ' JTN-Electron/1.0';
    
    // LOCK Mica dan preferensi warna ke Light Mode secara permanen
    nativeTheme.themeSource = 'light'; 

    // JALANKAN RADAR TEMA DISINI
    startOSThemeRadar();

    const isUpdating = await checkForUpdates();
    if (isUpdating) return; 

    createWindow();

    // --- 2. TANGKAP DEEP LINK SAAT APP PERTAMA KALI DIBUKA (WINDOWS) ---
    const deepLinkUrl = process.argv.find(arg => arg.startsWith('jtn://'));
    if (deepLinkUrl) {
        setTimeout(() => handleDeepLink(deepLinkUrl), 1500); 
    }

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
    // --- 3. TANGKAP DEEP LINK SAAT APP SUDAH BERJALAN ---
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            
            // Cari argumen yang berawalan jtn://
            const deepLinkUrl = commandLine.find(arg => arg.startsWith('jtn://'));
            if (deepLinkUrl) handleDeepLink(deepLinkUrl);
        }
    });
    
    // --- 4. TANGKAP DEEP LINK UNTUK MAC OS ---
    app.on('open-url', (event, url) => {
        event.preventDefault();
        if (mainWindow) {
            handleDeepLink(url);
        } else {
            app.whenReady().then(() => {
                setTimeout(() => handleDeepLink(url), 1500);
            });
        }
    });
}

// --- 5. FUNGSI EKSEKUSI PINDAH HALAMAN (DEEP LINK) ---
function handleDeepLink(url) {
    // Buang 'jtn://' dari url (Contoh: jtn://user/template -> user/template)
    let targetPath = url.replace('jtn://', '');
    if (targetPath.endsWith('/')) targetPath = targetPath.slice(0, -1);

    // Gabungkan dengan URL aslimu
    const finalUrl = `https://absen.hkbpjtn.web.id/multimedia/${targetPath}`;

    // Pindah halaman
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.loadURL(finalUrl);
    }
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
                        width: 450, 
                        height: 200, // <--- UBAH DARI 180 JADI 200 DI SINI
                        resizable: false, maximizable: false, minimizable: true,
                        title: "File Downloader - JTN Multimedia Hub",
                        backgroundMaterial: 'mica',
                        icon: path.join(__dirname, 'assets/picture/favicon.png'),
                        webPreferences: { preload: path.join(__dirname, 'preload_dl_ui.js'), contextIsolation: true, nodeIntegration: false }
                    });
                    
                    dlWin.removeMenu(); // Kunci ganda agar menu benar-benar musnah
                    dlWin.loadFile('download-ui.html');
                    activeDownloads.set(dlWin.id, item); 

                    dlWin.on('closed', () => {
                        if (item && item.getState() === 'progressing') item.cancel();
                        activeDownloads.delete(dlWin.id);
                    });
                }

                const currentBytes = item.getReceivedBytes(); 
                const totalBytes = item.getTotalBytes(); 
                const currentTime = Date.now();
                const timeDiff = (currentTime - lastTime) / 1000; 
                
                let speed = 0; 
                if (timeDiff > 0) speed = (currentBytes - lastBytes) / timeDiff;

                // 1. HITUNG ESTIMASI WAKTU (ETA)
                let eta = 0;
                if (speed > 0 && totalBytes > 0) {
                    eta = Math.round((totalBytes - currentBytes) / speed);
                }

                // 2. PROGRESS BAR DI TASKBAR (0.0 s/d 1.0)
                const progress = totalBytes > 0 ? (currentBytes / totalBytes) : -1;

                if (dlWin && !dlWin.isDestroyed()) {
                    dlWin.setProgressBar(progress); // Menampilkan progress di Taskbar
                    
                    dlWin.webContents.send('download-progress', { 
                        filename: item.getFilename(), 
                        received: currentBytes, 
                        total: totalBytes, 
                        speed: speed,
                        eta: eta // Mengirimkan data ETA ke UI
                    });
                }

                lastBytes = currentBytes; lastTime = currentTime;
            }
        });

        item.once('done', (event, state) => {
            if (uiCreated && dlWin && !dlWin.isDestroyed()) {
                // Bersihkan progress bar di taskbar
                dlWin.setProgressBar(-1);

                if (state === 'completed') {
                    // 3. PAKSA JENDELA MUNCUL (POPUP) SAAT SELESAI
                    if (dlWin.isMinimized()) dlWin.restore();
                    dlWin.show();
                    dlWin.focus();
                    dlWin.setAlwaysOnTop(true); // Pastikan benar-benar di depan
                    dlWin.setAlwaysOnTop(false); // Kembalikan normal setelah muncul
                    dlWin.flashFrame(true); // Membuat icon di taskbar berkedip

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
let originalMainBounds = null;   // Menyimpan koordinat asli sebelum pindah
let teleportedMainBounds = null; // Menyimpan koordinat di monitor ke-2
let didAutoMove = false;         // Penanda apakah kita barusan melakukan teleportasi

ipcMain.on('start-presentation', (event, monitorId) => {
    if (projectorWindow) return;

    const { screen } = require('electron');
    const displays = screen.getAllDisplays();
    let targetDisplay = null;

    // 1. Tentukan Monitor Target Proyektor
    if (monitorId && monitorId !== 'auto') {
        targetDisplay = displays.find(d => d.id.toString() === monitorId.toString());
    } 
    else if (currentAppConfigs.projMonitor && currentAppConfigs.projMonitor !== 'auto') {
        targetDisplay = displays.find(d => d.id.toString() === currentAppConfigs.projMonitor.toString());
    }

    if (!targetDisplay) {
        targetDisplay = displays.find(d => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
    }

    // === LOGIKA AUTO-MOVE (ANTI-BENTROK) ===
    if (mainWindow && !mainWindow.isDestroyed() && displays.length > 1) {
        const mainWindowBounds = mainWindow.getBounds();
        const currentMainDisplay = screen.getDisplayMatching(mainWindowBounds);

        if (currentMainDisplay.id === targetDisplay.id) {
            const altDisplay = displays.find(d => d.id !== targetDisplay.id);
            
            if (altDisplay) {
                // SIMPAN POSISI ASLI SEBELUM PINDAH!
                originalMainBounds = mainWindowBounds;
                didAutoMove = true;

                const newX = altDisplay.bounds.x + Math.round((altDisplay.bounds.width - mainWindowBounds.width) / 2);
                const newY = altDisplay.bounds.y + Math.round((altDisplay.bounds.height - mainWindowBounds.height) / 2);
                
                // Simpan koordinat tujuan untuk bahan perbandingan nanti
                teleportedMainBounds = {
                    x: newX,
                    y: newY,
                    width: mainWindowBounds.width,
                    height: mainWindowBounds.height
                };

                // Teleportasi!
                mainWindow.setBounds(teleportedMainBounds);
            }
        }
    }
    // =======================================

    // 2. Buat Jendela Proyektor
    projectorWindow = new BrowserWindow({
        x: targetDisplay.bounds.x,
        y: targetDisplay.bounds.y,
        width: 800,
        height: 600,
        frame: false,
        autoHideMenuBar: true,
        alwaysOnTop: false, 
        backgroundMaterial: 'mica', 
        backgroundColor: '#00000000', 
        show: false, 
        icon: path.join(__dirname, 'assets/picture/favicon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    projectorWindow.setBounds(targetDisplay.bounds);
    projectorWindow.setFullScreen(true);

    projectorWindow.loadFile('projector.html');

    projectorWindow.once('ready-to-show', () => {
        projectorWindow.showInactive(); 
        projectorWindow.webContents.send('apply-projector-config', {
            theme: currentAppConfigs.projTheme,
            font: currentAppConfigs.projFont,
            size: currentAppConfigs.projSize
        });
    });

    // === LOGIKA SAAT PROYEKTOR DITUTUP (PENGEMBALIAN POSISI) ===
    projectorWindow.on('closed', () => {
        projectorWindow = null;

        if (mainWindow && !mainWindow.isDestroyed()) {
            
            // Cek apakah tadi kita melakukan teleportasi
            if (didAutoMove && originalMainBounds && teleportedMainBounds) {
                const currentBounds = mainWindow.getBounds();
                const isMaximized = mainWindow.isMaximized();
                
                // Cek apakah window DIGESER atau DI-RESIZE oleh user selama di monitor 2
                const isMoved = currentBounds.x !== teleportedMainBounds.x || 
                                currentBounds.y !== teleportedMainBounds.y || 
                                currentBounds.width !== teleportedMainBounds.width || 
                                currentBounds.height !== teleportedMainBounds.height;

                // Jika TIDAK digeser dan TIDAK di-maximize, kembalikan ke habitat aslinya!
                if (!isMoved && !isMaximized) {
                    mainWindow.setBounds(originalMainBounds);
                }

                // Reset ingatan untuk sesi berikutnya
                didAutoMove = false;
                originalMainBounds = null;
                teleportedMainBounds = null;
            }

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