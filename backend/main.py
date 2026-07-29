import sys
import os
import json
import tempfile
import io

# Fix sys.stdout / sys.stderr for PyInstaller --noconsole mode
if getattr(sys, 'frozen', False):
    if sys.stdout is None:
        sys.stdout = io.StringIO()
    if sys.stderr is None:
        sys.stderr = io.StringIO()
from typing import List, Optional, Any, Union
from fastapi import FastAPI, UploadFile, File, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import OpenAI
from pypdf import PdfReader

app = FastAPI(title="Interview Assistant AI Backend")

# Enable CORS for frontend communications
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Message(BaseModel):
    role: str
    content: Any

class RespondRequest(BaseModel):
    messages: List[Message]
    model: str = "gpt-4o-mini"
    stream: bool = True

def get_openai_client(
    authorization: Optional[str] = Header(None),
    x_api_provider: Optional[str] = Header("openai")
) -> OpenAI:
    """
    Extracts the API key from the Authorization header and configures OpenAI client
    pointing to either OpenAI or Groq.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Please configure your API Key."
        )
    api_key = authorization.split(" ")[1].strip()
    if not api_key:
        raise HTTPException(
            status_code=401,
            detail="API Key is empty."
        )
    
    if x_api_provider == "groq":
        return OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
    elif x_api_provider == "gemini":
        return OpenAI(api_key=api_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
    return OpenAI(api_key=api_key)

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "message": "Backend is running"}

@app.post("/api/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    x_api_provider: Optional[str] = Header("openai"),
    authorization: Optional[str] = Header(None)
):
    """
    Transcribes incoming audio file using either OpenAI Whisper, Groq Whisper, or Gemini Multimodal API.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header. Please configure your API Key."
        )
    api_key = authorization.split(" ")[1].strip()

    filename = file.filename or "audio.wav"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".wav", ".mp3", ".webm", ".m4a", ".ogg", ".mp4", ".mpeg"]:
        ext = ".wav"

    try:
        content = await file.read()
        
        if x_api_provider == "gemini":
            import httpx
            import base64
            
            # Detect mime type based on extension
            mime_type = "audio/webm"
            if ext == ".wav":
                mime_type = "audio/wav"
            elif ext == ".mp3":
                mime_type = "audio/mp3"
            elif ext == ".ogg":
                mime_type = "audio/ogg"

            audio_base64 = base64.b64encode(content).decode("utf-8")
            
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
            payload = {
                "contents": [{
                    "parts": [
                        {"text": "Transcribe this audio recording verbatim. Do not add any extra explanations or preamble."},
                        {"inlineData": {"mimeType": mime_type, "data": audio_base64}}
                    ]
                }]
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, timeout=60.0)
                if resp.status_code != 200:
                    raise Exception(f"Gemini API returned status {resp.status_code}: {resp.text}")
                result = resp.json()
                text = result["candidates"][0]["content"]["parts"][0]["text"]
                return {"text": text}
        
        else:
            # Fall back to OpenAI / Groq via the standard client
            from openai import OpenAI
            if x_api_provider == "groq":
                client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
                model = "whisper-large-v3"
            else:
                client = OpenAI(api_key=api_key)
                model = "whisper-1"

            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
                temp_file.write(content)
                temp_path = temp_file.name

            try:
                with open(temp_path, "rb") as audio_file:
                    transcript_response = client.audio.transcriptions.create(
                        model=model,
                        file=audio_file,
                        language="en",
                        prompt="This is a professional software engineering interview."
                    )
                return {"text": transcript_response.text}
            finally:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
                    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

@app.post("/api/respond")
async def get_ai_response(
    request: RespondRequest,
    client: OpenAI = Depends(get_openai_client)
):
    """
    Generates AI response using OpenAI LLM (e.g. GPT-4o-mini). Supports SSE streaming.
    """
    try:
        # Convert request messages to format required by OpenAI SDK
        messages_input = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        if request.stream:
            def event_generator():
                try:
                    response_stream = client.chat.completions.create(
                        model=request.model,
                        messages=messages_input,
                        stream=True
                    )
                    for chunk in response_stream:
                        if chunk.choices and chunk.choices[0].delta.content:
                            content = chunk.choices[0].delta.content
                            # JSON-encode to preserve newlines and avoid SSE split issues
                            data_payload = json.dumps({"content": content})
                            yield f"data: {data_payload}\n\n"
                except Exception as stream_err:
                    err_payload = json.dumps({"error": str(stream_err)})
                    yield f"data: {err_payload}\n\n"

            return StreamingResponse(event_generator(), media_type="text/event-stream")
        else:
            response = client.chat.completions.create(
                model=request.model,
                messages=messages_input,
                stream=False
            )
            return {"response": response.choices[0].message.content}
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")

@app.post("/api/parse-document")
async def parse_document(file: UploadFile = File(...)):
    """
    Parses PDF or TXT files and returns the extracted plain text.
    """
    filename = file.filename or ""
    content = await file.read()
    
    text = ""
    if filename.lower().endswith(".pdf"):
        try:
            pdf_file = io.BytesIO(content)
            reader = PdfReader(pdf_file)
            for page in reader.pages:
                text_content = page.extract_text()
                if text_content:
                    text += text_content + "\n"
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {str(e)}")
    else:
        # Default to raw text decode (TXT, source files, etc.)
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            try:
                text = content.decode("latin-1")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to decode text file: {str(e)}")
                
    return {"text": text.strip(), "filename": filename}

if __name__ == "__main__":
    import uvicorn
    if getattr(sys, 'frozen', False):
        uvicorn.run(app, host="127.0.0.1", port=8000, log_config=None)
    else:
        uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
