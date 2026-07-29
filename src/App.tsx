import React, { useState, useEffect, useRef } from 'react';
import { 
  Mic, 
  MicOff, 
  Settings as SettingsIcon, 
  MessageSquare, 
  History, 
  Key, 
  Save, 
  AlertCircle,
  Copy, 
  Check, 
  Cpu,
  Sparkles,
  Menu,
  Volume2,
  Paperclip,
  X
} from 'lucide-react';
import { useSettings } from './hooks/useSettings';
import { useAudioCapture } from './hooks/useAudioCapture';
import { transcribeAudio, getAIResponseStream, parseDocumentFile, ChatMessage } from './services/apiService';

interface TranscriptItem {
  id: string;
  timestamp: string;
  text: string;
}

interface ChatResponseItem {
  id: string;
  timestamp: string;
  prompt: string;
  response: string;
  modelUsed: string;
  isStreaming: boolean;
}

export default function App() {
  const { settings, saveSettings, loading: settingsLoading } = useSettings();
  const { isListening, permissionStatus, duration, requestPermission, startListening, stopListening } = useAudioCapture();

  // Navigation state: 'interview' | 'history' | 'settings'
  const [activeTab, setActiveTab] = useState<'interview' | 'history' | 'settings'>('interview');
  
  // Settings Form State
  const [openaiKeyInput, setOpenaiKeyInput] = useState('');
  const [groqKeyInput, setGroqKeyInput] = useState('');
  const [provider, setProvider] = useState<'openai' | 'groq'>('openai');
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini');
  const [saveStatus, setSaveStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // Chat/Transcript state for session
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [chatResponses, setChatResponses] = useState<ChatResponseItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to start capturing interview audio');
  const [isProcessing, setIsProcessing] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [manualTextInput, setManualTextInput] = useState('');
  const [captureInterviewer, setCaptureInterviewer] = useState(false);
  const [stealthMode, setStealthMode] = useState(false);
  const [showOsCursor, setShowOsCursor] = useState(false);
  const [isClickThrough, setIsClickThrough] = useState(false);
  const [opacity, setOpacity] = useState(1.0);
  const [captureMic, setCaptureMic] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isMouseInWindow, setIsMouseInWindow] = useState(false);
  const [attachedFile, setAttachedFile] = useState<{ name: string; type: string; dataUrl?: string; textContent?: string } | null>(null);

  const endOfChatRef = useRef<HTMLDivElement>(null);
  const endOfTranscriptRef = useRef<HTMLDivElement>(null);

  // Sync settings when loaded
  useEffect(() => {
    if (!settingsLoading) {
      setOpenaiKeyInput(settings.openaiApiKey || (settings.provider === 'openai' ? settings.apiKey : ''));
      setGroqKeyInput(settings.groqApiKey || (settings.provider === 'groq' ? settings.apiKey : ''));
      setSelectedModel(settings.model);
      const activeProv = (settings.provider === 'groq' ? 'groq' : 'openai');
      setProvider(activeProv);
    }
  }, [settings, settingsLoading]);

  // Listen to global shortcut for Click-Through toggle
  useEffect(() => {
    if (window.electronAPI?.onClickThroughToggled) {
      const unsubscribe = window.electronAPI.onClickThroughToggled((ignore) => {
        setIsClickThrough(ignore);
      });
      return () => unsubscribe();
    }
  }, []);

  // Mouse movement tracking for simulated stealth cursor
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    
    const handleMouseEnter = () => setIsMouseInWindow(true);
    const handleMouseLeave = () => setIsMouseInWindow(false);

    window.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseenter', handleMouseEnter);
    document.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseenter', handleMouseEnter);
      document.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, []);

  // Scroll to bottom on new chat/transcripts
  useEffect(() => {
    endOfChatRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatResponses]);

  useEffect(() => {
    endOfTranscriptRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const handleFileAttach = async (file: File) => {
    setStatusMessage(`Uploading and processing file: ${file.name}...`);
    setIsProcessing(true);
    try {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setAttachedFile({
            name: file.name,
            type: 'image',
            dataUrl: reader.result as string,
          });
          setStatusMessage('Image attached successfully.');
          setIsProcessing(false);
        };
        reader.readAsDataURL(file);
      } else {
        // Document: send to parse endpoint
        const result = await parseDocumentFile(file);
        setAttachedFile({
          name: file.name,
          type: 'document',
          textContent: result.text,
        });
        setStatusMessage('Document parsed and attached successfully.');
        setIsProcessing(false);
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`Failed to attach file: ${err.message || String(err)}`);
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
          const file = item.getAsFile();
          if (file) {
            handleFileAttach(file);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', handleGlobalPaste);
    return () => {
      window.removeEventListener('paste', handleGlobalPaste);
    };
  }, []);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveStatus({ type: null, message: '' });
    
    const activeApiKey = provider === 'openai' ? openaiKeyInput : groqKeyInput;

    const result = await saveSettings({
      apiKey: activeApiKey,
      openaiApiKey: openaiKeyInput,
      groqApiKey: groqKeyInput,
      model: selectedModel,
      provider: provider,
    });

    if (result.success) {
      setSaveStatus({ type: 'success', message: 'Settings saved successfully!' });
      setTimeout(() => setSaveStatus({ type: null, message: '' }), 3000);
    } else {
      setSaveStatus({ type: 'error', message: result.error || 'Failed to save settings' });
    }
  };

  const handleStartCapture = async () => {
    if (!settings.apiKey) {
      setActiveTab('settings');
      setStatusMessage('Please configure your API Key first.');
      return;
    }

    if (!captureMic && !captureInterviewer) {
      setStatusMessage('Please enable at least one audio input (My Mic or Interviewer).');
      return;
    }

    if (captureMic && permissionStatus !== 'granted') {
      const granted = await requestPermission();
      if (!granted) {
        setStatusMessage('Microphone access is required to capture speech.');
        return;
      }
    }

    try {
      const started = await startListening(captureMic, captureInterviewer);
      if (started) {
        let msg = 'Listening... ';
        if (captureMic && captureInterviewer) msg += '(My Mic + Interviewer)';
        else if (captureMic) msg += '(My Mic Only)';
        else msg += '(Interviewer Only)';
        setStatusMessage(msg);
      } else {
        setStatusMessage('Failed to start recording.');
      }
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`Error: ${err.message || String(err)}`);
    }
  };

  const handleStopCapture = async () => {
    if (!isListening) return;

    setStatusMessage('Processing audio speech...');
    setIsProcessing(true);
    
    let chatId = '';
    try {
      const audioBlob = await stopListening();
      if (!audioBlob) {
        setStatusMessage('No audio data recorded.');
        setIsProcessing(false);
        return;
      }

      // 1. Transcribe audio using Whisper
      const text = await transcribeAudio(audioBlob, settings.apiKey, settings.provider);
      if (!text || text.trim() === '') {
        setStatusMessage('No speech detected in the audio.');
        setIsProcessing(false);
        return;
      }

      // Add to transcript history
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const newTranscript: TranscriptItem = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeStr,
        text: text.trim(),
      };
      setTranscripts(prev => [...prev, newTranscript]);
      setStatusMessage('Generating AI feedback response...');

      // 2. Prepare message history for LLM
      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `You are an Interview Copilot.
Provide the EXACT answer to the interview question in a clean, point-wise list.

Rules:
1. NO FILLER TEXT: Do NOT output any introductory text (e.g. "Here is the answer:") or concluding thoughts. Start immediately with the first bullet point.
2. POINT-BY-POINT: Output ONLY a clean list of bullet points (using '-' or '•').
3. SPACING: You MUST add double newlines (two line breaks) between every single bullet point.
4. EXACT AND CONCISE: Use minimal, high-impact words. Make every bullet point a direct speaking point that the candidate can read aloud to the interviewer.
5. NO HEAVY MARKDOWN: Do not use markdown headers (no '#', '##', '###').`
      };

      // Construct current context
      const chatContext: ChatMessage[] = [
        systemPrompt,
        ...transcripts.map(t => ({ role: 'user' as const, content: t.text })),
        { role: 'user', content: text.trim() }
      ];

      // Add a placeholder response item that is streaming
      chatId = Math.random().toString(36).substr(2, 9);
      const newChatResponse: ChatResponseItem = {
        id: chatId,
        timestamp: timeStr,
        prompt: text.trim(),
        response: '',
        modelUsed: settings.model,
        isStreaming: true,
      };
      
      setChatResponses(prev => [...prev, newChatResponse]);

      // 3. Stream AI answer
      await getAIResponseStream(
        chatContext,
        settings.model,
        settings.apiKey,
        settings.provider,
        (chunk) => {
          setChatResponses(prev => prev.map(chat => {
            if (chat.id === chatId) {
              return { ...chat, response: chat.response + chunk };
            }
            return chat;
          }));
        }
      );

      // Mark streaming as complete
      setChatResponses(prev => prev.map(chat => {
        if (chat.id === chatId) {
          return { ...chat, isStreaming: false };
        }
        return chat;
      }));

      setStatusMessage('Ready for next question');
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`Error: ${err.message || 'Something went wrong'}`);
      setChatResponses(prev => prev.map(chat => {
        if (chat.id === chatId) {
          return {
            ...chat,
            response: `⚠️ API Error: ${err.message || String(err)}`,
            isStreaming: false
          };
        }
        return chat;
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendManualText = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!manualTextInput.trim() && !attachedFile) || isProcessing) return;
    if (!settings.apiKey) {
      setActiveTab('settings');
      setStatusMessage('Please configure your API Key first.');
      return;
    }

    const queryText = manualTextInput.trim();
    setManualTextInput('');
    setStatusMessage('Generating AI response...');
    setIsProcessing(true);
    let chatId = '';
    try {
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      
      // Determine content payload
      let finalQuery = queryText;
      if (attachedFile?.type === 'document' && attachedFile.textContent) {
        finalQuery = `[Context Document: ${attachedFile.name}]\n${attachedFile.textContent}\n\n[Candidate Question]: ${queryText}`;
      }

      let userContent: any = finalQuery;
      if (attachedFile?.type === 'image' && attachedFile.dataUrl) {
        userContent = [
          {
            type: 'text',
            text: finalQuery || 'Analyze this image and answer the question in details.'
          },
          {
            type: 'image_url',
            image_url: {
              url: attachedFile.dataUrl
            }
          }
        ];
      }

      const promptLabel = attachedFile 
        ? `${queryText || 'Analyze Attached Image'} [File: ${attachedFile.name}]` 
        : queryText;

      const newTranscript: TranscriptItem = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: timeStr,
        text: promptLabel,
      };
      setTranscripts(prev => [...prev, newTranscript]);

      const systemPrompt: ChatMessage = {
        role: 'system',
        content: `You are an Interview Copilot.
Provide the EXACT answer to the interview question in a clean, point-wise list.

Rules:
1. NO FILLER TEXT: Do NOT output any introductory text (e.g. "Here is the answer:") or concluding thoughts. Start immediately with the first bullet point.
2. POINT-BY-POINT: Output ONLY a clean list of bullet points (using '-' or '•').
3. SPACING: You MUST add double newlines (two line breaks) between every single bullet point.
4. EXACT AND CONCISE: Use minimal, high-impact words. Make every bullet point a direct speaking point that the candidate can read aloud to the interviewer.
5. NO HEAVY MARKDOWN: Do not use markdown headers (no '#', '##', '###').`
      };

      // Construct current context
      const chatContext: ChatMessage[] = [
        systemPrompt,
        ...transcripts.map(t => ({ role: 'user' as const, content: t.text })),
        { role: 'user', content: userContent }
      ];

      chatId = Math.random().toString(36).substr(2, 9);
      const newChatResponse: ChatResponseItem = {
        id: chatId,
        timestamp: timeStr,
        prompt: promptLabel,
        response: '',
        modelUsed: settings.model,
        isStreaming: true,
      };
      
      setChatResponses(prev => [...prev, newChatResponse]);
      setAttachedFile(null); // Clear attachment

      await getAIResponseStream(
        chatContext,
        settings.model,
        settings.apiKey,
        settings.provider,
        (chunk) => {
          setChatResponses(prev => prev.map(chat => {
            if (chat.id === chatId) {
              return { ...chat, response: chat.response + chunk };
            }
            return chat;
          }));
        }
      );

      setChatResponses(prev => prev.map(chat => {
        if (chat.id === chatId) {
          return { ...chat, isStreaming: false };
        }
        return chat;
      }));

      setStatusMessage('Ready for next question');
    } catch (err: any) {
      console.error(err);
      setStatusMessage(`Error: ${err.message || 'Something went wrong'}`);
      setChatResponses(prev => prev.map(chat => {
        if (chat.id === chatId) {
          return {
            ...chat,
            response: `⚠️ API Error: ${err.message || String(err)}`,
            isStreaming: false
          };
        }
        return chat;
      }));
    } finally {
      setIsProcessing(false);
    }
  };



  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex h-screen w-screen bg-background text-textMain ${stealthMode && !showOsCursor ? 'hide-cursor' : ''}`}>
      
      {/* 1. SIDEBAR */}
      <aside className={`bg-sidebar border-r border-border flex flex-col justify-between select-none transition-all duration-300 ${
        isSidebarCollapsed ? 'w-20' : 'w-64'
      }`}>
        <div>
          {/* Logo & Toggle Header */}
          <div className={`p-6 border-b border-border flex items-center justify-between ${
            isSidebarCollapsed ? 'flex-col space-y-4 px-2' : ''
          }`}>
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-primary/10 rounded-lg border border-primary/30 shrink-0">
                <Sparkles className="h-6 w-6 text-primary" />
              </div>
              {!isSidebarCollapsed && (
                <div>
                  <h1 className="font-semibold text-lg tracking-tight bg-gradient-to-r from-white via-textMain to-primary bg-clip-text text-transparent">
                    Interview AI
                  </h1>
                  <p className="text-xs text-textMuted font-medium">Assistant Foundation</p>
                </div>
              )}
            </div>
            
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              type="button"
              className="p-1.5 hover:bg-surface rounded-lg text-textMuted hover:text-white transition-colors"
              title={isSidebarCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          {/* Navigation */}
          <nav className="p-4 space-y-2">
            <button
              onClick={() => setActiveTab('interview')}
              type="button"
              className={`w-full flex items-center rounded-xl transition-all duration-200 text-sm font-medium ${
                isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 border border-transparent'
              } ${
                activeTab === 'interview'
                  ? 'bg-primary/10 text-primary border border-primary/20 active-glow'
                  : 'text-textMuted hover:bg-surface/50 hover:text-textMain'
              }`}
              title="Interview Room"
            >
              <Mic className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && <span>Interview Room</span>}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              type="button"
              className={`w-full flex items-center rounded-xl transition-all duration-200 text-sm font-medium ${
                isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 border border-transparent'
              } ${
                activeTab === 'history'
                  ? 'bg-primary/10 text-primary border border-primary/20 active-glow'
                  : 'text-textMuted hover:bg-surface/50 hover:text-textMain'
              }`}
              title="Session History"
            >
              <History className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && <span>Session History</span>}
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              type="button"
              className={`w-full flex items-center rounded-xl transition-all duration-200 text-sm font-medium ${
                isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 border border-transparent'
              } ${
                activeTab === 'settings'
                  ? 'bg-primary/10 text-primary border border-primary/20 active-glow'
                  : 'text-textMuted hover:bg-surface/50 hover:text-textMain'
              }`}
              title="Settings"
            >
              <SettingsIcon className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && <span>Settings</span>}
            </button>
          </nav>

          {/* Divider */}
          <div className="border-t border-border/60 my-4 mx-4" />

          {/* Action / Control Buttons Section */}
          <div className="p-4 space-y-3">
            {!isSidebarCollapsed && (
              <span className="text-[10px] font-bold text-textMuted uppercase tracking-wider block mb-1">
                Audio Capture
              </span>
            )}
            
            {/* Start/Stop Listening button */}
            {isListening ? (
              <button
                onClick={handleStopCapture}
                type="button"
                className={`w-full flex items-center bg-red-600 hover:bg-red-500 text-white font-medium rounded-xl transition-all shadow-lg ${
                  isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 text-sm'
                }`}
                title="Stop Listening"
              >
                <MicOff className="h-4 w-4 shrink-0 text-white" />
                {!isSidebarCollapsed && <span>Stop Listening</span>}
              </button>
            ) : (
              <button
                onClick={handleStartCapture}
                disabled={isProcessing}
                type="button"
                className={`w-full flex items-center bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-medium rounded-xl transition-all shadow-lg ${
                  isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 text-sm'
                }`}
                title="Start Listening"
              >
                <Mic className="h-4 w-4 shrink-0 text-white" />
                {!isSidebarCollapsed && <span>Start Listening</span>}
              </button>
            )}

            {/* My Mic Toggle */}
            <button
              onClick={() => setCaptureMic(!captureMic)}
              disabled={isProcessing}
              type="button"
              className={`w-full flex items-center rounded-xl border transition-all ${
                isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 text-sm font-bold'
              } ${
                captureMic
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 active-glow'
                  : 'bg-surface border-border text-textMuted hover:text-white'
              }`}
              title="Toggle microphone audio capture for yourself"
            >
              {captureMic ? (
                <Mic className="h-4 w-4 shrink-0" />
              ) : (
                <MicOff className="h-4 w-4 shrink-0" />
              )}
              {!isSidebarCollapsed && <span>{captureMic ? 'My Mic: ON' : 'My Mic: MUTED'}</span>}
            </button>

            {/* Interviewer Toggle */}
            <button
              onClick={() => setCaptureInterviewer(!captureInterviewer)}
              disabled={isProcessing}
              type="button"
              className={`w-full flex items-center rounded-xl border transition-all ${
                isSidebarCollapsed ? 'justify-center p-3' : 'space-x-3 px-4 py-3 text-sm font-bold'
              } ${
                captureInterviewer
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 active-glow'
                  : 'bg-surface border-border text-textMuted hover:text-white'
              }`}
              title="Toggle system audio capture for interviewer"
            >
              <Volume2 className="h-4 w-4 shrink-0" />
              {!isSidebarCollapsed && <span>{captureInterviewer ? 'Interviewer: ON' : 'Interviewer: MUTED'}</span>}
            </button>

          </div>
        </div>

        {/* Footer info */}
        <div className="p-4 border-t border-border">
          <div className={`glass p-3 rounded-xl flex items-center ${
            isSidebarCollapsed ? 'justify-center' : 'space-x-3'
          } text-xs`}>
            <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${
              settings.apiKey ? 'bg-green-500' : 'bg-amber-500'
            }`} />
            {!isSidebarCollapsed && (
              <div className="truncate">
                <p className="font-semibold">{settings.apiKey ? 'API Configured' : 'No API Key'}</p>
                <p className="text-textMuted truncate">{settings.model}</p>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTAINER */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* Top Header / Status bar */}
        <header className="h-14 border-b border-border flex items-center justify-between px-6 bg-surface/30 select-none">
          <div className="flex items-center space-x-4 text-xs">
            <span className="text-textMuted">Status:</span>
            <span className="font-medium flex items-center space-x-1.5">
              {isListening && (
                <span className="flex h-2 w-2 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
              )}
              <span>{statusMessage}</span>
            </span>

            {isListening && (
              <span className="text-red-400 font-bold tracking-mono bg-red-500/10 px-2.5 py-0.5 rounded border border-red-500/20 flex items-center space-x-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                <span>{formatTimer(duration)}</span>
              </span>
            )}

            {isProcessing && (
              <span className="text-primary font-medium bg-primary/10 px-2 py-0.5 rounded border border-primary/20 flex items-center space-x-1">
                <svg className="animate-spin h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>Analyzing speech...</span>
              </span>
            )}
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Opacity slider */}
            <div className="flex items-center space-x-2">
              <span className="text-[10px] text-textMuted font-bold uppercase tracking-wider">Opacity:</span>
              <input
                type="range"
                min="0.15"
                max="1.0"
                step="0.05"
                value={opacity}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setOpacity(val);
                  if (window.electronAPI) {
                    window.electronAPI.setWindowOpacity(val);
                  }
                }}
                className="w-20 accent-primary h-1 rounded-lg bg-border appearance-none"
                title={`Adjust window opacity: ${Math.round(opacity * 100)}%`}
              />
              <span className="text-[10px] font-semibold text-textMuted w-7 text-right">{Math.round(opacity * 100)}%</span>
            </div>

            {/* Screen share protection toggle */}
            <button
              onClick={() => {
                const next = !stealthMode;
                setStealthMode(next);
                if (window.electronAPI) {
                  window.electronAPI.setContentProtection(next);
                }
              }}
              type="button"
              className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold tracking-wider uppercase transition-all flex items-center space-x-1.5 ${
                stealthMode
                  ? 'bg-red-500/10 border-red-500/30 text-red-400 active-glow'
                  : 'bg-surface border-border text-textMuted hover:text-white'
              }`}
              title="Stealth Mode: Prevents this app window from being seen in screen shares (e.g. Zoom, Google Meet)"
            >
              <span>{stealthMode ? '🔒 Screen Hidden' : '🔓 Share Visible'}</span>
            </button>

            {/* Click-Through Mode Toggle (Pass clicks/typing to window behind) */}
            <button
              onClick={() => {
                const next = !isClickThrough;
                setIsClickThrough(next);
                if (window.electronAPI && window.electronAPI.setIgnoreMouseEvents) {
                  window.electronAPI.setIgnoreMouseEvents(next);
                }
              }}
              type="button"
              className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold tracking-wider uppercase transition-all flex items-center space-x-1.5 ${
                isClickThrough
                  ? 'bg-purple-500/20 border-purple-500/40 text-purple-300 active-glow'
                  : 'bg-surface border-border text-textMuted hover:text-white'
              }`}
              title="Click-Through Mode (Alt+Shift+X): Allows mouse clicks & typing to pass directly into the browser/compiler behind the overlay!"
            >
              <span>{isClickThrough ? '🎯 Click-Through: ON (Alt+Shift+X)' : '🖱️ Click-Through: OFF'}</span>
            </button>

            {/* Dedicated Cursor Visibility Toggle in Stealth Mode */}
            {stealthMode && (
              <button
                onClick={() => setShowOsCursor(!showOsCursor)}
                type="button"
                className={`px-3 py-1.5 rounded-lg border text-[10px] font-bold tracking-wider uppercase transition-all flex items-center space-x-1.5 ${
                  showOsCursor
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-400 active-glow'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400 active-glow'
                }`}
                title={showOsCursor 
                  ? "OS Cursor Visible: Standard mouse cursor stays visible everywhere (prevents screen recording cursor flicker/pop)." 
                  : "Stealth Cursor (Hidden): OS cursor hides over app window and displays candidate-only simulated pointer."}
              >
                <span>{showOsCursor ? '🖱️ OS Cursor: Shown' : '👁️ OS Cursor: Hidden'}</span>
              </button>
            )}

            <div className="px-3 py-1 rounded-full bg-surface border border-border text-[11px] font-semibold text-textMuted flex items-center space-x-1.5">
              <Cpu className="h-3.5 w-3.5 text-primary" />
              <span>FastAPI Port 8000</span>
            </div>
          </div>
        </header>

        {/* Dynamic Pages */}
        <div className="flex-1 overflow-hidden">
          
          {/* TAB 1: INTERVIEW ROOM */}
          {activeTab === 'interview' && (
            <div className="h-full flex flex-col overflow-hidden">
              
              {/* Unified Chat Feed */}
              <div className="flex-1 overflow-y-auto bg-background/30 p-6 flex flex-col items-center">
                <div className="w-full max-w-3xl space-y-6 flex-1">
                  {chatResponses.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-textMuted p-12 mt-12">
                      <div className="p-4 rounded-full bg-surface border border-border mb-4 select-none">
                        <MessageSquare className="h-10 w-10 text-textMuted/60" />
                      </div>
                      <p className="font-semibold text-textMain text-base select-none">Start the Interview Session</p>
                      <p className="text-xs max-w-xs mt-1 leading-relaxed select-none">
                        Speak into the microphone or type below. Questions and AI-generated answers will appear here sequentially.
                      </p>
                    </div>
                  ) : (
                    chatResponses.map((c, idx) => (
                      <div key={c.id} className="space-y-4">
                        
                        {/* Question (Interviewer / Candidate spoken text) */}
                        <div className="flex flex-col items-end select-text">
                          <div className="max-w-[85%] bg-primary/10 border border-primary/20 rounded-2xl px-5 py-4 shadow-sm">
                            <div className="flex justify-between items-center mb-1 text-[10px] font-bold tracking-wider select-none text-primary">
                              <span>QUESTION #{idx + 1}</span>
                              <span className="opacity-70 ml-4">{c.timestamp}</span>
                            </div>
                            <p className="text-sm font-semibold text-blue-400 leading-relaxed">
                              {c.prompt}
                            </p>
                          </div>
                        </div>

                        {/* Answer (AI Assistant copilot suggestion) */}
                        <div className="flex flex-col items-start select-text">
                          <div className="w-full bg-chatbg border border-border/80 rounded-2xl px-5 py-5 shadow-lg relative group">
                            <div className="flex justify-between items-start mb-3 select-none">
                              <div className="flex items-center space-x-1.5 text-textMuted">
                                <Sparkles className="h-4 w-4 text-amber-400 animate-pulse" />
                                <span className="text-[10px] font-bold tracking-wider uppercase text-textMain">AI ASSISTANT</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface/50 border border-border/60 ml-2 font-medium">
                                  {c.modelUsed}
                                </span>
                              </div>
                              <div className="flex items-center space-x-3">
                                <span className="text-[10px] text-textMuted">{c.timestamp}</span>
                                <button
                                  onClick={() => copyToClipboard(c.response, c.id)}
                                  className="text-textMuted hover:text-textMain transition-colors"
                                  title="Copy response"
                                >
                                  {copiedId === c.id ? (
                                    <Check className="h-3.5 w-3.5 text-green-500" />
                                  ) : (
                                    <Copy className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              </div>
                            </div>
                            
                            <div className="text-sm text-textMain leading-relaxed font-light whitespace-pre-wrap">
                              {c.response}
                              {c.isStreaming && (
                                <span className="inline-block w-1.5 h-4 bg-primary ml-1 animate-pulse" />
                              )}
                            </div>
                          </div>
                        </div>

                      </div>
                    ))
                  )}
                  <div ref={endOfChatRef} />
                </div>
              </div>

              {/* Tiny Input Bar directly under the chat feed */}
              <div className="p-4 bg-sidebar/30 border-t border-border flex flex-col items-center w-full select-none">
                
                {/* File Attachment Preview */}
                {attachedFile && (
                  <div className="w-full max-w-2xl mb-3 flex items-center justify-between p-2.5 bg-surface border border-border rounded-xl">
                    <div className="flex items-center space-x-2.5 truncate">
                      {attachedFile.type === 'image' && attachedFile.dataUrl ? (
                        <img 
                          src={attachedFile.dataUrl} 
                          alt="preview" 
                          className="h-9 w-9 rounded-lg object-cover border border-border"
                        />
                      ) : (
                        <div className="p-2 bg-primary/10 rounded-lg border border-primary/20 text-primary">
                          <Paperclip className="h-4 w-4" />
                        </div>
                      )}
                      <div className="truncate">
                        <p className="text-xs font-semibold text-textMain truncate">{attachedFile.name}</p>
                        <p className="text-[10px] text-textMuted uppercase tracking-wider">
                          {attachedFile.type === 'image' ? 'Image Attached' : 'Document Context Attached'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setAttachedFile(null)}
                      type="button"
                      className="p-1 hover:bg-surface rounded text-textMuted hover:text-white transition-colors"
                      title="Remove attachment"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSendManualText} className="w-full max-w-2xl flex items-center bg-surface border border-border rounded-xl px-3 py-1.5 select-text">
                  {/* Secret hidden file picker input */}
                  <input
                    id="file-upload-input"
                    type="file"
                    accept="image/*,.pdf,.txt,.js,.py,.ts,.html,.css,.json,.csv,.md"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileAttach(file);
                    }}
                  />
                  
                  {/* Paperclip Button */}
                  <button
                    onClick={() => document.getElementById('file-upload-input')?.click()}
                    type="button"
                    className="p-2 text-textMuted hover:text-white hover:bg-surface/50 rounded-lg transition-colors select-none mr-1 shrink-0 animate-pulse"
                    title="Upload image or document (.pdf, .txt, .js, etc.)"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>

                  <input
                    type="text"
                    placeholder="Type question, paste screenshot (Ctrl+V), or upload files..."
                    value={manualTextInput}
                    onChange={(e) => setManualTextInput(e.target.value)}
                    disabled={isProcessing}
                    className="flex-1 bg-transparent border-none text-sm text-white px-2 py-1 focus:outline-none placeholder-textMuted/40"
                  />
                  <button
                    type="submit"
                    disabled={(!manualTextInput.trim() && !attachedFile) || isProcessing}
                    className="px-4 py-1.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:hover:bg-primary text-white text-xs font-semibold rounded-lg transition-all active:scale-95 flex items-center space-x-1 select-none shrink-0"
                  >
                    <span>Send</span>
                  </button>
                </form>
              </div>

            </div>
          )}

          {/* TAB 2: SESSION HISTORY */}
          {activeTab === 'history' && (
            <div className="h-full overflow-y-auto p-8 max-w-4xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-white mb-1">Session History</h2>
                <p className="text-sm text-textMuted">View full transcript and assistant log for the current active interview.</p>
              </div>

              {transcripts.length === 0 ? (
                <div className="glass p-12 text-center rounded-2xl border border-border flex flex-col items-center">
                  <History className="h-10 w-10 text-textMuted/60 mb-3" />
                  <h3 className="font-semibold text-textMain text-sm">No items in history yet</h3>
                  <p className="text-xs text-textMuted mt-1">History clears when you close or reload the application.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {transcripts.map((t, idx) => {
                    const aiMatch = chatResponses.find(c => c.prompt === t.text);
                    return (
                      <div key={t.id} className="glass rounded-2xl border border-border overflow-hidden">
                        {/* Header */}
                        <div className="p-4 bg-surface/40 border-b border-border flex justify-between items-center text-xs select-none">
                          <span className="font-bold text-primary">DIALOGUE #{idx + 1}</span>
                          <span className="text-textMuted">{t.timestamp}</span>
                        </div>
                        {/* Body */}
                        <div className="p-5 space-y-4">
                          <div className="space-y-1">
                            <span className="text-[10px] text-textMuted font-semibold tracking-wider uppercase">TRANSCRIPT:</span>
                            <p className="text-sm font-light text-textMain leading-relaxed">{t.text}</p>
                          </div>
                          {aiMatch && (
                            <div className="pt-4 border-t border-border/55 space-y-1">
                              <span className="text-[10px] text-primary font-semibold tracking-wider uppercase">AI RESPONSE:</span>
                              <p className="text-sm font-light text-textMain leading-relaxed whitespace-pre-wrap">{aiMatch.response}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SETTINGS */}
          {activeTab === 'settings' && (
            <div className="h-full overflow-y-auto p-8 max-w-2xl mx-auto space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight text-white mb-1">Configuration Settings</h2>
                <p className="text-sm text-textMuted">Configure credentials, keys, and preferred LLM engines.</p>
              </div>

              <form onSubmit={handleSaveSettings} className="glass rounded-2xl p-6 border border-border space-y-5">
                {/* API Provider Selector */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-textMuted flex items-center space-x-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>API Provider</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setProvider('openai');
                        setSelectedModel('gpt-4o-mini');
                      }}
                      className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                        provider === 'openai'
                          ? 'bg-primary/10 border-primary text-primary active-glow'
                          : 'bg-surface border-border text-textMuted hover:text-white'
                      }`}
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProvider('groq');
                        setSelectedModel('llama-3.3-70b-versatile');
                      }}
                      className={`py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                        provider === 'groq'
                          ? 'bg-primary/10 border-primary text-primary active-glow'
                          : 'bg-surface border-border text-textMuted hover:text-white'
                      }`}
                    >
                      Groq (Free)
                    </button>
                  </div>
                </div>

                {/* API Key */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-textMuted flex items-center space-x-1.5">
                    <Key className="h-3.5 w-3.5 text-primary" />
                    <span>{provider === 'openai' ? 'OpenAI' : 'Groq'} API Key</span>
                  </label>
                  <input
                    type="password"
                    placeholder={provider === 'openai' ? 'sk-proj-...' : 'gsk_...'}
                    value={provider === 'openai' ? openaiKeyInput : groqKeyInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (provider === 'openai') setOpenaiKeyInput(val);
                      else setGroqKeyInput(val);
                    }}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all text-white placeholder-textMuted/40"
                  />
                  <p className="text-[10px] text-textMuted leading-normal">
                    Your credentials are saved locally on your device and sent securely only to the local FastAPI server.
                  </p>
                </div>

                {/* AI Model selection */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-textMuted flex items-center space-x-1.5">
                    <Cpu className="h-3.5 w-3.5 text-primary" />
                    <span>Selected LLM Model</span>
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-primary transition-all text-white appearance-none"
                  >
                    {provider === 'openai' ? (
                      <>
                        <option value="gpt-4o-mini">gpt-4o-mini (Recommended - Fast & Cheap)</option>
                        <option value="gpt-4o">gpt-4o (High Accuracy)</option>
                        <option value="gpt-3.5-turbo">gpt-3.5-turbo (Legacy)</option>
                      </>
                    ) : (
                      <>
                        <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (Recommended - Smartest)</option>
                        <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (Fastest)</option>
                        <option value="llama3-8b-8192">llama3-8b-8192 (Fast)</option>
                        <option value="mixtral-8x7b-32768">mixtral-8x7b-32768 (High Capacity)</option>
                        <option value="gemma2-9b-it">gemma2-9b-it (Google Gemma 2)</option>
                      </>
                    )}
                  </select>
                </div>

                {/* Status Messages */}
                {saveStatus.type && (
                  <div className={`p-4 rounded-xl flex items-center space-x-2 text-xs border ${
                    saveStatus.type === 'success' 
                      ? 'bg-green-500/10 border-green-500/20 text-green-400' 
                      : 'bg-red-500/10 border-red-500/20 text-red-400'
                  }`}>
                    <AlertCircle className="h-4 w-4" />
                    <span>{saveStatus.message}</span>
                  </div>
                )}

                {/* Save Button */}
                <button
                  type="submit"
                  className="w-full py-3 bg-primary hover:bg-primary/95 text-white text-sm font-semibold rounded-xl flex items-center justify-center space-x-2 transition-all active:scale-95 shadow-lg shadow-primary/10"
                >
                  <Save className="h-4 w-4" />
                  <span>Save Configuration</span>
                </button>
              </form>
            </div>
          )}

        </div>

      </main>

      {/* Custom Simulated Mouse Cursor for Stealth Mode */}
      {stealthMode && !showOsCursor && isMouseInWindow && (
        <div 
          className="fixed pointer-events-none z-[9999] select-none"
          style={{ 
            left: `${mousePos.x}px`, 
            top: `${mousePos.y}px`,
            transform: 'translate(-2px, -2px)'
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.5 3V20.5L9.75 15.25H18.25L4.5 3Z" fill="white" stroke="#222" strokeWidth="2" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  );
}
