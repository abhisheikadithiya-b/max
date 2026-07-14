import os
import sys
import time
import requests
from typing import List, Dict, Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# Setup directories
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(PROJECT_DIR, "static")

# Initialize FastAPI App
app = FastAPI(
    title="Max AI Assistant Backend",
    description="Online-only serverless backend for Vercel deployment"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryPayload(BaseModel):
    prompt: str
    force_mode: str = "auto"
    force_lang: str = "auto"
    history: List[Dict[str, str]] = []

@app.get("/api/ping")
def ping_status():
    """Returns simplified online-only statuses to satisfy the frontend check."""
    return {
        "status": "online",
        "bin_exists": False,
        "model_exists": False,
        "local_assets": False,
        "local_server_active": False,
        "vosk_loaded": False,
        "timestamp": time.time()
    }

@app.post("/api/query")
def handle_query(payload: QueryPayload, authorization: Optional[str] = Header(None)):
    """Routes prompt processing directly to the online Gemini API."""
    prompt = payload.prompt
    force_lang = payload.force_lang
    
    # Detect language (Tamil vs English)
    is_tamil = any('\u0b80' <= char <= '\u0bff' for char in prompt) or force_lang == "ta"
    
    # Extract API key from authorization header or environment
    api_key = None
    if authorization and authorization.startswith("Bearer "):
        api_key = authorization.split(" ")[1]
    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Gemini API Key is missing. Please enter it in the settings drawer."
        )

    try:
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        # Build chat context instructions
        sys_instruct = "You are Max, a friendly responsive assistant. Keep your responses short (under 2 sentences) and suitable for speech conversion. "
        if is_tamil:
            sys_instruct += "Reply in Tamil."
        else:
            sys_instruct += "Reply in English."
            
        full_prompt = f"{sys_instruct}\nUser: {prompt}"
        response = model.generate_content(full_prompt)
        
        return {
            "response": response.text,
            "mode": "online",
            "latency_ms": 100
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {e}")

@app.get("/api/online-tts")
def online_tts(text: str, lang: str = "en"):
    """Proxies request to Google Translate TTS API for speech audio streaming."""
    try:
        tts_url = f"https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q={requests.utils.quote(text)}&tl={lang}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36"
        }
        res = requests.get(tts_url, headers=headers, stream=True)
        return StreamingResponse(res.iter_content(chunk_size=1024), media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Online TTS proxy failed: {e}")

# Mount static files at /static
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
def get_index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))
