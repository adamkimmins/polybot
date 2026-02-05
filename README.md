# Polybot — Real-Time Polyglot Conversation + Tutor (STT → LLM → TTS)

Polybot is a conversational language-learning app that supports natural voice conversations with an optional built-in tutor. It combines streaming speech-to-text (STT), a low-latency LLM “Talk” mode, an optional “Teach” mode for explanations, and a streamed text-to-speech (TTS) pipeline using XTTS v2.

This monorepo includes:
- An Expo client (iOS + Web) with streaming UI and TTS queueing
- A Cloudflare Worker API (SSE chat streaming, STT via Whisper, Teach mode)
- A Python FastAPI XTTS v2 inference server (WAV streaming)

---

## Why this project exists

Most “language chat” apps feel turn-based and slow: record → wait → read → press play. Polybot is designed around a more natural flow:
- You speak
- STT transcribes
- The LLM streams a response (SSE tokens)
- The client converts completed sentences into TTS chunks
- Audio is prefetched and played as soon as it’s ready

The result is a conversation experience that feels closer to a live exchange, while still supporting “tutor-style” explanations when you want them.

---

## Key features

- **Talk mode (streaming)**: LLM responses stream to the client via **SSE** and update the UI token-by-token.
- **Teach mode (optional)**: After Talk completes, Polybot can generate a concise tutor explanation (grammar + meaning).
- **Speech-to-text (STT)**: Whisper Large v3 Turbo via Workers AI (`/stt`) with language hints for better accuracy.
- **XTTS v2 TTS (streamed)**: Cloudflare Worker proxies requests to a local FastAPI XTTS server (`/tts_xtts` → `/tts_stream`).
- **Client-side TTS queueing + prefetch**: Completed sentence chunks are queued, prefetched, and played with limited concurrency to reduce perceived latency.
- **Session memory (Durable Object)**: Conversation history is persisted per `sessionId` (Worker uses a DO to store messages).

---

## Architecture

High-level flow:

1) Client records audio
2) Client POSTs audio to `/stt` (multipart/form-data)
3) Client POSTs text to `/talk` (SSE)
4) Client receives tokens, builds sentences, and enqueues TTS chunks
5) Client POSTs sentence chunks to `/tts_xtts` (Worker proxy)
6) Worker forwards to XTTS FastAPI `/tts_stream` (WAV)
7) Client plays audio while continuing to stream tokens
8) Optional: Client POSTs to `/teach` to generate a brief tutor explanation

Expo Client (iOS/Web)
├─ POST /stt (audio) ──────────────▶ Cloudflare Worker (STT via Workers AI)
├─ POST /talk (SSE stream) ─────────▶ Cloudflare Worker (LLM streaming + DO memory)
├─ POST /tts_xtts (sentence chunks) ─▶ Cloudflare Worker (proxy)
│ └───────────────▶ XTTS FastAPI (PyTorch) /tts_stream
└─ POST /teach (optional) ───────────▶ Cloudflare Worker (Tutor response)



---

## Repository layout

```txt
apps/
  client/                 # Expo app (iOS + Web)
    app/(tabs)/...        # Router tabs (Talk / Learn)
    app/settings.tsx      # Settings modal
services/
  chat/                   # Cloudflare Worker API
    src/
      index.ts            # /talk (SSE), /stt (Whisper), /teach, /tts_xtts proxy
      session-do.ts       # Durable Object session store
      prompts/            # System prompts (en/it)
    wrangler.jsonc        # Worker config
    .dev.vars             # Local env
  tts/                    # FastAPI XTTS v2 server
    server.py             # /tts_stream (WAV)
    voices/               # Voice reference WAVs
docs/
  DEV.md                  # Dev setup and health checks
dev.ps1                   # Starts XTTS + Worker + Client

---

## Tech stack

Client:
- React Native + Expo (iOS + Web)
- Streaming UI via Fetch + SSE parsing
- Audio record/playback via `expo-audio`
- Local caching via `expo-file-system` (native) + `Blob` URLs (web)

API:
- Cloudflare Workers (Wrangler dev)
- Workers AI for LLM + Whisper STT
- SSE streaming responses (`text/event-stream`)
- Durable Object for session message persistence

TTS:
- FastAPI + Coqui TTS (XTTS v2)
- GPU support via PyTorch (recommended)
- Returns WAV for low-friction streaming/playback

---

## API

### `GET /ping`
Health check.

Response:
```json
{ "status": "ok", "service": "polybot" }

POST /stt (multipart/form-data)

Speech-to-text transcription via Whisper.

Form fields:

audio: File (webm on web, m4a on native)

lang: Optional language hint (e.g., "it", "en")

Response:

{ "text": "transcribed text...", "lang": "it" }

POST /talk (SSE)

Streams an assistant reply token-by-token.

Body:

{
  "sessionId": "local-dev-session",
  "userText": "Ciao! Come stai?",
  "lang": "it"
}


SSE data frames:

data: {"response":"Ciao"}
data: {"response":"! "}
data: {"response":"Sto "}
...
data: [DONE]

POST /teach

Generates a concise tutor explanation (grammar/meaning) based on the user message and the final talk reply.

Body:

{
  "userText": "Ciao! Come stai?",
  "talkText": "Ciao! Sto bene, grazie. E tu?"
}


Response:

{ "teach": "Short explanation..." }

POST /tts_xtts

Worker proxy to XTTS FastAPI /tts_stream. Used for sentence-level TTS chunking.

Body:

{
  "text": "Sto bene, grazie.",
  "language": "it",
  "chunkSize": 20,
  "voice": "adam"
}


Response:

WAV audio stream (audio/wav)

Development setup (local)

Polybot runs three services during development:

XTTS FastAPI server (Python)

Cloudflare Worker API (Wrangler)

Expo client (iOS/Web)

Ports:

XTTS server: 8000

Worker API: 8787

Prereqs

Node.js + npm

Wrangler CLI (wrangler)

Python 3.11

Recommended: NVIDIA GPU + drivers (faster XTTS)

Windows note:

allow inbound TCP 8000 and 8787 on Private network if testing from a phone

Environment variables
Client: apps/client/.env
EXPO_PUBLIC_API_URL=http://<YOUR_PC_IP>:8787
EXPO_PUBLIC_SESSION_ID=local-dev-session

Worker: services/chat/.dev.vars
XTTS_URL=http://<YOUR_PC_IP>:8000
TALK_MODEL=@cf/mistral/mistral-7b-instruct-v0.1
DEFAULT_TTS_LANG=it
DEFAULT_VOICE=adam
STT_MODEL=@cf/openai/whisper-large-v3-turbo
DEFAULT_STT_LANG=it

Quickstart

From the repo root:

.\dev.ps1


This script starts:

XTTS server (uvicorn server:app --host 0.0.0.0 --port 8000)

Worker (wrangler dev --ip 0.0.0.0 --port 8787)

Expo client (npm start)

Manual run

Terminal 1 — Worker:

cd services/chat
wrangler dev --ip 0.0.0.0 --port 8787


Terminal 2 — Client:

cd apps/client
npm start


Terminal 3 — XTTS:

cd services/tts
.\.venv\Scripts\Activate.ps1
uvicorn server:app --host 0.0.0.0 --port 8000

Health checks & debugging

XTTS docs:

curl -i http://<YOUR_PC_IP>:8000/docs


Worker ping:

curl -i http://<YOUR_PC_IP>:8787/ping


Worker → XTTS proxy (writes WAV):

$body = @{ text="hello"; language="en"; chunkSize=20 } | ConvertTo-Json -Compress
Invoke-WebRequest -Method POST "http://<YOUR_PC_IP>:8787/tts_xtts" -ContentType "application/json" -Body $body -OutFile worker.wav


If the client shows “Network error”:

Verify /ping

Verify /tts_xtts with the proxy test above

Ensure your EXPO_PUBLIC_API_URL matches your LAN IP + port

Confirm firewall rules for 8000 and 8787

Notes on latency and streaming

Polybot reduces perceived latency via two tactics:

SSE streaming for Talk

Tokens update the UI immediately

The client buffers tokens into sentence chunks

Client-side TTS queue + prefetch

Completed sentences are queued

Up to MAX_PREFETCH TTS generations run ahead

Audio plays as soon as the first WAV is ready, while future chunks generate in parallel

This makes the experience feel closer to a continuous conversation even though STT and TTS are still processed server-side.

Roadmap (next improvements)

True streaming STT (partial transcripts) to reduce “record → stop” friction

Duplex / interruption handling (barge-in) for more natural back-and-forth

Better segmentation (prosody-aware chunking, punctuation heuristics)

Improve session memory prompts (context window + summarization)

Add additional languages, voices, and voice profiles

Production deploy strategy for XTTS (containerized inference + autoscaling)

Disclaimer

This project is an active build and includes experimentation around streaming + latency. The design goal is to evolve toward a production-grade conversational loop with clean boundaries between:

UI/UX (client)

orchestration and session state (worker + DO)

heavy inference (XTTS server)

Author

Adam Kimmins
GitHub: https://github.com/adamkimmins