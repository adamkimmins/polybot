# Polybot: Real-Time Polyglot Conversation

Polybot is a conversational language-learning app that supports natural voice conversations with an optional built-in tutor. It combines streaming speech-to-text (STT), a low-latency LLM “Talk” mode, an optional “Teach” mode for explanations, and a streamed text-to-speech (TTS) pipeline using XTTS v2.

This includes:
- An Expo client (iOS + Web) with streaming UI and TTS queueing
- A Cloudflare Worker API (SSE chat streaming, STT via Whisper, Teach mode)
- A Python FastAPI XTTS v2 inference server (WAV streaming)

---

<img width="500" height="300" alt="Screenshot 2026-02-05 054221" src="https://github.com/user-attachments/assets/0852e730-dae1-4541-aa40-025ee457738e" />
<img width="500" height="300" alt="Screenshot 2026-02-05 061229" src="https://github.com/user-attachments/assets/f404e8b1-9730-4ab6-bc9f-a80a6ac9a8dc" />

<img width="218" height="600" alt="Screenshot 2026-02-05 060001" src="https://github.com/user-attachments/assets/786ffa19-9f74-4071-8345-a574a02616d6" />
<img width="218" height="600" alt="Screenshot 2026-02-05 060001" src="https://github.com/user-attachments/assets/2d09cf52-dd0c-45a5-a07a-908cc735c484" />
<img width="560" height="700" alt="Screenshot 2026-02-05 060001" src="https://github.com/user-attachments/assets/5d5a832f-9d1a-449b-8d42-3e6b1e626bb1" />

# XTTS Audio Sample
https://github.com/user-attachments/assets/68625683-e941-4fb3-b093-f93d4ee9920a

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

High-level:

1) Client records audio
2) Client POSTs audio to `/stt` (multipart/form-data)
3) Client POSTs text to `/talk` (SSE)
4) Client receives tokens, builds sentences, and enqueues TTS chunks
5) Client POSTs sentence chunks to `/tts_xtts` (Worker proxy)
6) Worker forwards to XTTS FastAPI `/tts_stream` (WAV)
7) Client plays audio while continuing to stream tokens
-Optional: Client POSTs to `/teach` to generate a brief tutor explanation

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
```
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

{ "status": "ok", "service": "polybot" }

### POST /stt (multipart/form-data)

Speech-to-text transcription via Whisper.

Response:

{ "text": "transcribed text...", "lang": "it" }

### POST /talk (SSE)

Streams an assistant reply token-by-token.

SSE data frames:

data: {"response":"Ciao"}
data: {"response":"! "}
data: {"response":"Sto "}
...
data: [DONE]

### POST /teach

Generates a concise tutor explanation (grammar/meaning) based on the user message and the final talk reply.

Response:

{ "teach": "Short explanation..." }

### POST /tts_xtts

Worker proxy to XTTS FastAPI /tts_stream. Used for sentence-level TTS chunking.

Response:

WAV audio stream (audio/wav)


## Development setup (local)

Polybot runs three services during development:

  - XTTS FastAPI server (Python)
  - Cloudflare Worker API (Wrangler)
  - Expo client (iOS/Web)

### Ports:

  - XTTS server: 8000
  - Worker API: 8787

### Prereqs

  - Node.js + npm
  - Wrangler CLI (wrangler)
  - Python 3.11

--Recommended: NVIDIA GPU + drivers (faster XTTS), CF TTS is available for those without a Nvidia GPU

---
### Quickstart

After setting up your .Env and .dev.vars based off the provided .examples,

You can then run:

.\dev.ps1


This script starts:

  - XTTS server (uvicorn server:app --host 0.0.0.0 --port 8000)
  - Worker (wrangler dev --ip 0.0.0.0 --port 8787)
  - Expo client (npm start)

### Documentation
docs/DEV.md provides setup instructions

### Roadmap (next improvements)

  - True streaming STT (partial transcripts, not chunks) to reduce “record → stop” friction
  - Duplex / interruption handling (barge-in) for more natural back-and-forth, including active listening
  - Better segmentation (prosody-aware chunking, punctuation heuristics)
  - Improve session memory prompts (context window + summarization)
  - Add additional languages, voices, and voice profiles
  - Production deploy strategy for XTTS (containerized inference + autoscaling)

#### Disclaimer

This project is an active build and includes experimentation around streaming + latency. The design goal is to evolve toward a production-grade conversational loop with clean boundaries.

There is no public hosted instance at this time, but anyone is free to host the repo on their computer.

#### Author

Adam Kimmins
https://github.com/adamkimmins
