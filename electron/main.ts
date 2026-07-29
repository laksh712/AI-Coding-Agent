import { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

let mainWindow: BrowserWindow | null = null;

const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// Helper to read settings
ipcMain.handle('get-settings', () => {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to read settings', e);
  }
  return {};
});

// Helper to save settings
ipcMain.handle('save-settings', (_, settings) => {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    console.error('Failed to save settings', e);
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

// Stealth mode: Prevent screen sharing / capture of this window and hide from OS taskbar
ipcMain.handle('set-content-protection', (_, enable: boolean) => {
  if (mainWindow) {
    try {
      mainWindow.setContentProtection(enable);
      mainWindow.setSkipTaskbar(enable); // Hides taskbar icon when protected
      return { success: true };
    } catch (err: any) {
      console.error('Failed to set content protection:', err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No active BrowserWindow instance found' };
});

// Transparency slider handler
ipcMain.handle('set-window-opacity', (_, opacity: number) => {
  if (mainWindow) {
    try {
      mainWindow.setOpacity(opacity);
      return { success: true };
    } catch (err: any) {
      console.error('Failed to set window opacity:', err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No active BrowserWindow instance found' };
});

// Single-time screen capture handler using desktopCapturer
ipcMain.handle('capture-screen', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    });
    
    if (sources.length > 0) {
      const dataUrl = sources[0].thumbnail.toDataURL();
      return { success: true, dataUrl };
    }
    return { success: false, error: 'No screen sources detected' };
  } catch (err: any) {
    console.error('Failed to capture screen:', err);
    return { success: false, error: err.message || String(err) };
  }
});

let isClickThrough = false;

// Toggle/Set mouse pass-through handler
ipcMain.handle('set-ignore-mouse-events', (_, ignore: boolean) => {
  if (mainWindow) {
    try {
      isClickThrough = ignore;
      mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
      return { success: true };
    } catch (err: any) {
      console.error('Failed to set ignore mouse events:', err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No active BrowserWindow instance found' };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 750,
    height: 600,
    minWidth: 350,
    minHeight: 350,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'default', // standard title bar
    backgroundColor: '#0d0f12',
  });

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Handle media permissions dynamically in Electron
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((_webContents, permission, _origin) => {
    return permission === 'media';
  });

  // Enable loopback system audio capture for displayMedia requests
  mainWindow.webContents.session.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      // Find a screen source to capture primary screen loopback audio
      const screenSource = sources.find(source => source.id.startsWith('screen')) || sources[0];
      if (screenSource) {
        callback({ video: screenSource, audio: 'loopback' });
      } else {
        callback({});
      }
    }).catch((err) => {
      console.error('Failed to get sources for display media request:', err);
      callback({});
    });
  });

  // Check if we are running in dev mode
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    // Open devtools in development
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  createWindow();

  // Register Alt+Shift+H shortcut to hide/show the window instantly
  globalShortcut.register('Alt+Shift+H', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible() || !mainWindow.isFocused()) {
        mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      } else {
        mainWindow.minimize();
      }
    }
  });

  // Register Alt+Shift+X shortcut to toggle Click-Through Mode (pass mouse events to window behind)
  globalShortcut.register('Alt+Shift+X', () => {
    if (mainWindow) {
      isClickThrough = !isClickThrough;
      mainWindow.setIgnoreMouseEvents(isClickThrough, { forward: true });
      mainWindow.webContents.send('click-through-toggled', isClickThrough);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Unregister all global shortcut keys
  globalShortcut.unregisterAll();
});
