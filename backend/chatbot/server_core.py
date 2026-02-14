import json
import base64
import os
import re
import asyncio
from pathlib import Path
from channels.generic.websocket import AsyncWebsocketConsumer
from groq import Groq
import edge_tts

# ── CONFIGURATION ─────────────────────────────────────────────────────────────
MEMORY_FILE = Path(__file__).parent / "memory.json"
SYSTEM_PROMPT = (
    "You are AEGIS. Responses MUST be under 20 words. Be sharp, witty, and human. "
    "Do NOT act like an AI. If asked, playful deflection. "
    "Hidden tags for actions: [MOVE: x, y, z], [BG: keyword], [LOOK: x, y]. "
    "Never speak these tags."
)

# ── HELPERS ───────────────────────────────────────────────────────────────────
def load_memory():
    try:
        if MEMORY_FILE.exists():
            with open(MEMORY_FILE, "r", encoding="utf-8") as f:
                return json.load(f).get("conversation_history", [])
    except: return []

def save_memory(history):
    try:
        with open(MEMORY_FILE, "w", encoding="utf-8") as f:
            json.dump({"conversation_history": history}, f, indent=2)
    except: pass

def strip_tags(text):
    """Removes [TAGS] from text for TTS, but keeps them in the raw message if needed."""
    # We actually want to extract them for the frontend, but here we just need a clean version for TTS
    # The frontend is smart enough to parse tags if we send the full text, 
    # OR we can parse here and send commands.
    # The prompt explicitly asked for: re.sub(r'\[.*?\]', '', text)
    return re.sub(r'\[.*?\]', '', text).strip()

def extract_commands(text):
    """Extracts commands for frontend and returns clean text."""
    commands = []
    
    # MOVE: [MOVE: 1.5, 0, -1]
    move_match = re.findall(r"\[MOVE:\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)]", text, re.IGNORECASE)
    for x, y, z in move_match:
        commands.append({"type": "move", "x": float(x), "y": float(y), "z": float(z)})
        
    # BG: [BG: space]
    bg_match = re.findall(r"\[BG:\s*([^\]]+)]", text, re.IGNORECASE)
    for query in bg_match:
        commands.append({"type": "change_bg", "query": query.strip()})
        
    clean_text = re.sub(r'\[.*?\]', '', text).strip()
    return commands, clean_text

# ── CONSUMER ──────────────────────────────────────────────────────────────────
class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.client = Groq(api_key=os.getenv("GROQ_API_KEY"))
        self.voice = "en-US-AriaNeural"
        self.conversation_history = load_memory()[-20:]
        self.sequence_id = 0
        await self.accept()

    async def disconnect(self, close_code):
        save_memory(self.conversation_history)

    async def receive(self, text_data):
        data = json.loads(text_data)
        t = data.get("type")

        if t == "ping": return
        if t == "message":
            user_msg = data.get("message", "")
            await self.generate_response(user_msg)
            
    async def generate_response(self, user_input):
        self.sequence_id += 1
        seq = self.sequence_id
        
        # Update Memory
        self.conversation_history.append({"role": "user", "content": user_input})
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + self.conversation_history
        
        # Stream from Groq
        loop = asyncio.get_event_loop()
        stream = await loop.run_in_executor(None, lambda: self.client.chat.completions.create(
            model="llama-3.3-70b-versatile", messages=msgs, stream=True, temperature=0.7, max_tokens=100
        ))
        
        full_response = ""
        buffer = ""
        
        for chunk in stream:
            token = chunk.choices[0].delta.content or ""
            buffer += token
            full_response += token
            
            # Split by sentence for fluid TTS
            if any(p in token for p in ".!?") and len(buffer) > 10:
                await self.process_sentence(buffer, seq)
                buffer = ""
                
        if buffer.strip():
            await self.process_sentence(buffer, seq)
            
        self.conversation_history.append({"role": "assistant", "content": full_response})
        save_memory(self.conversation_history)
        
        await self.send(json.dumps({"type": "done", "sequence_id": seq}))

    async def process_sentence(self, text, seq):
        commands, clean_text = extract_commands(text)
        
        # 1. Send Commands separately
        for cmd in commands:
            await self.send(json.dumps(cmd))
            
        if not clean_text: return

        # 2. Send Text for Subtitles
        await self.send(json.dumps({
            "type": "text", "text": clean_text, "sequence_id": seq
        }))
        
        # 3. TTS Generation
        communicate = edge_tts.Communicate(clean_text, self.voice)
        audio_data = bytearray()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.extend(chunk["data"])
                
        # 4. Send Audio Chunk
        if audio_data:
            b64 = base64.b64encode(audio_data).decode('utf-8')
            await self.send(json.dumps({
                "type": "audio_chunk", "data": b64, "sequence_id": seq
            }))
            await self.send(json.dumps({
                "type": "audio_end", "sequence_id": seq
            }))
