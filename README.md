# AEGIS Ultra-Lean Core

This repository contains the consolidated, high-performance core of the AEGIS system.

## Structure

- **frontend/**: React + Three.js (R3F) application.
    - Code is in `src/AegisCore.jsx`.
    - Assets in `public/`.
- **backend/**: Django + Channels (WebSocket) + Groq/EdgeTTS.
    - Core logic in `chatbot/server_core.py`.

## Installation

### Prerequisites
- Node.js & npm
- Python 3.10+
- Groq API Key (rename `.env.example` to `.env` and add your key)

### Frontend
```bash
cd frontend
npm install
npm start
```

### Backend
```bash
cd backend
# Create virtual env (optional but recommended)
python -m venv venv
# Windows: venv\Scripts\activate
# Linux/Mac: source venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
daphne -p 8000 speech_chatbot_backend.asgi:application
```
