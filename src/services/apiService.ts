const BACKEND_URL = 'http://127.0.0.1:8000';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | any;
}

export async function transcribeAudio(audioBlob: Blob, apiKey: string, provider: 'openai' | 'groq' | 'gemini'): Promise<string> {
  const formData = new FormData();
  
  // Try to extract extension from mimeType
  let extension = 'webm';
  if (audioBlob.type.includes('wav')) {
    extension = 'wav';
  } else if (audioBlob.type.includes('ogg')) {
    extension = 'ogg';
  }
  
  formData.append('file', audioBlob, `audio.${extension}`);

  const response = await fetch(`${BACKEND_URL}/api/transcribe`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Provider': provider,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to transcribe audio');
  }

  const data = await response.json();
  return data.text;
}

export async function getAIResponseStream(
  messages: ChatMessage[],
  model: string,
  apiKey: string,
  provider: 'openai' | 'groq' | 'gemini',
  onChunk: (chunk: string) => void
): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/api/respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-API-Provider': provider,
    },
    body: JSON.stringify({
      messages,
      model,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Failed to get AI response');
  }

  const reader = response.body?.getReader();
  const decoder = new TextDecoder('utf-8');
  if (!reader) {
    throw new Error('Response body is not readable');
  }

  let fullResponse = '';
  let done = false;
  let buffer = '';

  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (value) {
      buffer += decoder.decode(value, { stream: !done });
      // Normalize CRLF to LF to handle Windows and Unix line endings consistently
      const normalized = buffer.replace(/\r\n/g, '\n');
      const parts = normalized.split('\n\n');
      buffer = parts.pop() || '';
      
      for (const part of parts) {
        const lines = part.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataText = line.slice(6).trim();
            if (dataText) {
              let payload: any;
              try {
                payload = JSON.parse(dataText);
              } catch (err) {
                console.error('Failed to parse stream JSON chunk:', err);
                continue;
              }

              if (payload.error) {
                throw new Error(payload.error);
              }
              if (payload.content) {
                fullResponse += payload.content;
                onChunk(payload.content);
              }
            }
          }
        }
      }
    }
  }

  return fullResponse;
}

export async function parseDocumentFile(file: File): Promise<{ text: string; filename: string }> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BACKEND_URL}/api/parse-document`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to parse document');
  }

  return response.json();
}
