export interface ElectronAPI {
  getSettings: () => Promise<any>;
  saveSettings: (settings: any) => Promise<{ success: boolean; error?: string }>;
  setContentProtection: (enable: boolean) => Promise<{ success: boolean; error?: string }>;
  setWindowOpacity: (opacity: number) => Promise<{ success: boolean; error?: string }>;
  captureScreen: () => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  setIgnoreMouseEvents: (ignore: boolean) => Promise<{ success: boolean; error?: string }>;
  onClickThroughToggled: (callback: (ignore: boolean) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
