import { useState, useRef, useEffect } from 'react';

export function useAudioCapture() {
  const [isListening, setIsListening] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'prompt' | 'unknown'>('unknown');
  const [duration, setDuration] = useState(0);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Check microphone permissions on mount
  useEffect(() => {
    async function checkPermission() {
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
          setPermissionStatus(result.state);
          result.onchange = () => {
            setPermissionStatus(result.state);
          };
        } else {
          // Fallback if permissions query isn't supported
          setPermissionStatus('prompt');
        }
      } catch (e) {
        console.error('Error checking permission:', e);
        setPermissionStatus('prompt');
      }
    }
    checkPermission();
  }, []);

  // Update timer during recording
  useEffect(() => {
    if (isListening) {
      timerRef.current = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setDuration(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isListening]);

  const requestPermission = async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop track immediately, we just want to verify permission
      stream.getTracks().forEach((track) => track.stop());
      setPermissionStatus('granted');
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      setPermissionStatus('denied');
      return false;
    }
  };

  const startListening = async (captureMic: boolean = true, captureSystemAudio: boolean = false): Promise<boolean> => {
    audioChunksRef.current = [];
    try {
      let micStream: MediaStream | null = null;
      let displayStream: MediaStream | null = null;
      let finalStream: MediaStream | null = null;
      let audioCtx: AudioContext | null = null;

      // Keep tracks saved so we can stop them on stopListening
      const allTracks: MediaStreamTrack[] = [];

      // 1. Capture Microphone if enabled (Using clean default settings for maximum voice clarity)
      if (captureMic) {
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          micStream.getTracks().forEach(track => allTracks.push(track));
        } catch (micErr: any) {
          throw new Error(`Microphone capture failed: ${micErr.message || String(micErr)}`);
        }
      }

      // 2. Capture Interviewer / System Audio if enabled
      if (captureSystemAudio) {
        try {
          displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: true, // Use standard video property to avoid constraint validation errors
            audio: true
          });
          displayStream.getTracks().forEach(track => allTracks.push(track));
        } catch (displayErr: any) {
          throw new Error(`System audio capture failed: ${displayErr.message || String(displayErr)}`);
        }
      }

      // 3. Construct the mixed final stream
      if (micStream && displayStream) {
        const displayAudioTracks = displayStream.getAudioTracks();
        if (displayAudioTracks.length > 0) {
          audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          const dest = audioCtx.createMediaStreamDestination();

          const micSource = audioCtx.createMediaStreamSource(micStream);
          micSource.connect(dest);

          const systemSource = audioCtx.createMediaStreamSource(displayStream);
          systemSource.connect(dest);

          finalStream = dest.stream;
        } else {
          // If system audio shared is empty, fall back to mic only
          finalStream = micStream;
        }
      } else if (micStream) {
        finalStream = micStream;
      } else if (displayStream) {
        const displayAudioTracks = displayStream.getAudioTracks();
        if (displayAudioTracks.length > 0) {
          finalStream = displayStream;
        } else {
          throw new Error("System audio shared but no audio tracks found. Make sure to check the 'Share audio' box!");
        }
      } else {
        throw new Error("No audio source selected. Please enable My Mic or Interviewer audio.");
      }

      // Create a master media stream holder to close all tracks later
      const masterStream = new MediaStream();
      allTracks.forEach(track => masterStream.addTrack(track));
      streamRef.current = masterStream;

      // Detect supported mimeTypes
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/ogg';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = ''; // Let browser decide default
      }

      const mediaRecorder = mimeType 
        ? new MediaRecorder(finalStream, { mimeType }) 
        : new MediaRecorder(finalStream);
        
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(200); // chunk size in ms
      setIsListening(true);
      return true;
    } catch (err) {
      console.error('Failed to start recording:', err);
      return false;
    }
  };

  const stopListening = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        let mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        setIsListening(false);
        
        // Stop all tracks to release microphone and screen-sharing light/hardware resource
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }

        resolve(audioBlob);
      };

      mediaRecorderRef.current.stop();
    });
  };

  return {
    isListening,
    permissionStatus,
    duration,
    requestPermission,
    startListening,
    stopListening,
  };
}
