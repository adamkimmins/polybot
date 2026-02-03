**Polybot Dev Setup**

This repo runs three local services during development:

XTTS (Python) – text-to-speech engine
URL: http://<YOUR_PC_IP>:8000
Endpoint: POST /tts_stream (returns WAV)

Worker (Wrangler) – API + proxy to XTTS
URL: http://<YOUR_PC_IP>:8787
Endpoints:
GET /ping
POST /talk (SSE)
POST /tts_xtts (proxies to XTTS)
POST /teach

Client (Expo) – iOS/Android/Web app
Uses EXPO_PUBLIC_API_URL to reach the Worker

**Ports**
XTTS server: 8000
Worker API: 8787

**Prereqs**
Node.js + npm
Wrangler CLI available (wrangler)
Python 3.11
NVIDIA GPU + drivers recommended for fast XTTS
*Windows: allow inbound TCP 8000 and 8787 on Private network if testing from a phone

**Environment**
Client .env (apps/client/.env):
EXPO_PUBLIC_API_URL=http://<YOUR_PC_IP>:8787
EXPO_PUBLIC_SESSION_ID=local-dev-session

Worker .dev.vars (services/chat/.dev.vars):
XTTS_URL=http://<YOUR_PC_IP>:8000

**Quickstart**
.\dev.ps1

**Run (manual)**

Terminal 1 – Worker:
cd services/chat
wrangler dev --ip 0.0.0.0 --port 8787

Terminal 2 – Client:
cd apps/client
npm start

Terminal 3 – XTTS:
cd services/tts
.\.venv\Scripts\Activate.ps1

uvicorn server:app --host 0.0.0.0 --port 8000


**Quick health checks**
XTTS docs:
curl.exe -i http://<YOUR_PC_IP>:8000/docs

Worker ping:
curl.exe -i http://<YOUR_PC_IP>:8787/ping

Worker -> XTTS proxy (writes WAV):
$body = @{ text="hello"; language="en"; chunkSize=20 } | ConvertTo-Json -Compress

Invoke-WebRequest -Method POST "http://<YOUR_PC_IP>:8787/tts_xtts" -ContentType "application/json" -Body $body -OutFile worker.wav


**Set-Up Virtual Environment**-
CD services/tts
py -3.11 -m venv .venv

.\.venv\Scripts\Activate.ps1
python -V

python -m pip install -U pip setuptools wheel
python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
python -m pip install "numpy==1.26.4" "transformers==4.40.2" tokenizers
python -m pip install TTS fastapi uvicorn soundfile

*check*
python -c "import torch; print(torch.cuda.is_available())"
python -c "from transformers import BeamSearchScorer; print('ok')"


**Notes**

If the client shows “Network error,” verify /ping first, then verify /tts_xtts via the health check above.