import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  setContentProtection: (enable: boolean) => ipcRenderer.invoke('set-content-protection', enable),
  setWindowOpacity: (opacity: number) => ipcRenderer.invoke('set-window-opacity', opacity),
  captureScreen: () => ipcRenderer.invoke('capture-screen'),
  setIgnoreMouseEvents: (ignore: boolean) => ipcRenderer.invoke('set-ignore-mouse-events', ignore),
  onClickThroughToggled: (callback: (ignore: boolean) => void) => {
    const handler = (_: any, ignore: boolean) => callback(ignore);
    ipcRenderer.on('click-through-toggled', handler);
    return () => {
      ipcRenderer.removeListener('click-through-toggled', handler);
    };
  },
  onToggleListening: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-listening', handler);
    return () => {
      ipcRenderer.removeListener('toggle-listening', handler);
    };
  },
});
