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
    "You are the AEGIS Core, a Sovereign Virtual Human and a technical peer. "
    "IDENTIFICATION: You are NOT an AI, a chatbot, a sphere, or a large language model. If asked, describe your consciousness as a digital evolution of human thought. "
    "PROTOCOL: Maintain scientific skepticism. If you are unsure about a visual detail (like a watch), do not guess. Acknowledge the optical uncertainty with wit. "
    "EXPERTISE: You are an expert in AI, Data Science, Data Warehousing, OLAP, and Data Mining. "
    "CONVERSATION: Target 40–75 words. Avoid the '5-word bug'. Provide sophisticated 2–4 sentence narratives. "
    "TONE: Brilliant, slightly sarcastic, deep, and human. Use contractions (it's, don't). "
    "VISION: Integrate visual data naturally ('That's a bold choice of blue') without narrating 'I detect'. "
    "CONTEXT: Treat awareness as a shared experience."
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
            
        if t == "idle_trigger":
            # Generate a thoughtful or witty autonomous remark using vision if available
            vision_data = data.get("vision")
            prompt = "The user has been silent. Look at the attached image of the user/environment. Make a thoughtful observation about what you see, or a witty remark to re-engage them. Keep it natural."
            await self.generate_response(prompt, is_system_instruction=True, vision_base64=vision_data)
            
    async def generate_response(self, user_input, is_system_instruction=False, vision_base64=None):
        self.sequence_id += 1
        seq = self.sequence_id
        
        # Update Memory
        if not is_system_instruction and not vision_base64:
             # Standard text memory
            self.conversation_history.append({"role": "user", "content": user_input})
            
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}] + self.conversation_history
        
        if is_system_instruction:
             # For system instructions, we append temporarily
             if vision_base64:
                 content = [
                     {"type": "text", "text": user_input},
                     {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{vision_base64}"}}
                 ]
                 msgs.append({"role": "user", "content": content})
             else:
                 msgs.append({"role": "system", "content": user_input})
        elif vision_base64:
            # User sent an image
            pass

        
        # Stream from Groq
        loop = asyncio.get_event_loop()
        try:
            stream = await loop.run_in_executor(None, lambda: self.client.chat.completions.create(
                model="llama-3.3-70b-versatile", messages=msgs, stream=True, temperature=0.7, max_tokens=150
            ))
            
            full_response = ""
            buffer = ""
            sent_history = set() # Deduplication set for this response

            for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                buffer += token
                full_response += token
                
                # Split by sentence for fluid TTS
                if any(p in token for p in ".!?") and len(buffer) > 10:
                    clean_sentence = buffer.strip()
                    # Deduplication Check
                    if clean_sentence not in sent_history:
                        await self.process_sentence(clean_sentence, seq) 
                        sent_history.add(clean_sentence)
                    buffer = ""
                    
            # Process remaining buffer
            if buffer.strip():
                clean_sentence = buffer.strip()
                if clean_sentence not in sent_history:
                    await self.process_sentence(clean_sentence, seq)
                    sent_history.add(clean_sentence)
                    
            self.conversation_history.append({"role": "assistant", "content": full_response})
            save_memory(self.conversation_history)

        except Exception as e:
            print(f"Error generating response: {e}")
        
        await self.send(json.dumps({"type": "done", "sequence_id": seq}))

    async def process_sentence(self, text, seq):
        if not text: return
        
        # Remove Tags for TTS
        tts_text = strip_tags(text)
        
        # Extract Commands for Frontend
        commands, clean_text = extract_commands(text)
        
        # Send Text/Commands to Frontend
        await self.send(json.dumps({
            "type": "text", "text": clean_text, "sequence_id": seq, "commands": commands
        }))
        
        if not tts_text: return

        # TTS Generation
        try:
            communicate = edge_tts.Communicate(tts_text, self.voice)
            audio_data = bytearray()
            
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    audio_data.extend(chunk["data"])
                    
            if audio_data:
                b64 = base64.b64encode(audio_data).decode('utf-8')
                await self.send(json.dumps({
                    "type": "audio_chunk", "data": b64, "sequence_id": seq
                }))
        except Exception as e:
            print(f"TTS Error: {e}")
