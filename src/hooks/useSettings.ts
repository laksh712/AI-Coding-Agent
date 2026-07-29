import { useState, useEffect } from 'react';

export interface Settings {
  apiKey: string;
  openaiApiKey?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
  model: string;
  provider: 'openai' | 'groq' | 'gemini';
}

const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  openaiApiKey: '',
  groqApiKey: '',
  geminiApiKey: '',
  model: 'gpt-4o-mini',
  provider: 'openai',
};

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        if (window.electronAPI) {
          const saved = await window.electronAPI.getSettings();
          setSettings({
            apiKey: saved.apiKey || '',
            openaiApiKey: saved.openaiApiKey || (saved.provider === 'openai' ? saved.apiKey : ''),
            groqApiKey: saved.groqApiKey || (saved.provider === 'groq' ? saved.apiKey : ''),
            geminiApiKey: saved.geminiApiKey || (saved.provider === 'gemini' ? saved.apiKey : ''),
            model: saved.model || 'gpt-4o-mini',
            provider: saved.provider || 'openai',
          });
        } else {
          // Fallback to localStorage in browser environment
          const saved = localStorage.getItem('interview_assistant_settings');
          if (saved) {
            const parsed = JSON.parse(saved);
            setSettings({
              apiKey: parsed.apiKey || '',
              openaiApiKey: parsed.openaiApiKey || (parsed.provider === 'openai' ? parsed.apiKey : ''),
              groqApiKey: parsed.groqApiKey || (parsed.provider === 'groq' ? parsed.apiKey : ''),
              geminiApiKey: parsed.geminiApiKey || (parsed.provider === 'gemini' ? parsed.apiKey : ''),
              model: parsed.model || 'gpt-4o-mini',
              provider: parsed.provider || 'openai',
            });
          }
        }
      } catch (err) {
        console.error('Failed to load settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const saveSettings = async (newSettings: Settings) => {
    try {
      setSettings(newSettings);
      if (window.electronAPI) {
        await window.electronAPI.saveSettings(newSettings);
      } else {
        localStorage.setItem('interview_assistant_settings', JSON.stringify(newSettings));
      }
      return { success: true };
    } catch (err) {
      console.error('Failed to save settings:', err);
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  return { settings, saveSettings, loading };
}
