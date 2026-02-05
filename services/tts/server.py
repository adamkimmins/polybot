import io
import os
import numpy as np
import soundfile as sf
from fastapi import FastAPI, Response, Request
from TTS.api import TTS

app = FastAPI()

tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)

DEFAULT_LANG = "en"
DEFAULT_VOICE = "adam"  # voices/adam.wav
VOICES_DIR = os.path.join(os.path.dirname(__file__), "voices")


@app.post("/tts_stream")
async def tts_stream(request: Request):
    h = request.headers
    text = h.get("text")
    language = h.get("language", DEFAULT_LANG)

    # Prefer "voice" for custom voice cloning. (speaker is built-in voices)
    voice = h.get("voice", DEFAULT_VOICE)
    speaker = h.get("speaker")  # optional built-in

    if not text:
        return Response(content="Missing 'text' header", status_code=400)

    # speaker_wav_path = os.path.join(VOICES_DIR, f"{voice}.wav")
        # Choose best matching reference wav:
    # priority: voice_{lang}.wav -> voice.wav
    candidates = [
        os.path.join(VOICES_DIR, f"{voice}_{language}.wav"),
        os.path.join(VOICES_DIR, f"{voice}.wav"),
    ]

    speaker_wav_path = next((p for p in candidates if os.path.exists(p)), None)

    if not speaker_wav_path:
        return Response(
            content=f"Voice file not found. Tried: {candidates}",
            status_code=400,
        )


    # If a custom voice is requested, REQUIRE the file to exist.
    # This prevents silent fallback to Ana.
    if voice and not os.path.exists(speaker_wav_path):
        return Response(
            content=f"Voice file not found: {speaker_wav_path}",
            status_code=400,
            headers={
                "X-Voice-Mode": "missing-file",
                "X-Voice-Path": speaker_wav_path,
            },
        )

    try:
        # Try voice-clone path first if voice file exists
        if voice and os.path.exists(speaker_wav_path):
            try:
                # Most common signature
                wav = tts.tts(text=text, speaker_wav=speaker_wav_path, language=language)
                mode = "speaker_wav"
            except TypeError:
                # Some builds want a list
                wav = tts.tts(text=text, speaker_wav=[speaker_wav_path], language=language)
                mode = "speaker_wav_list"
        else:
            # Built-in speaker fallback
            fallback = speaker or "Ana Florence"
            wav = tts.tts(text=text, speaker=fallback, language=language)
            mode = f"built_in:{fallback}"

        buf = io.BytesIO()
        sf.write(buf, np.array(wav, dtype=np.float32), samplerate=24000, format="WAV", subtype="PCM_16")
        data = buf.getvalue()

        return Response(
            content=data,
            media_type="audio/wav",
            headers={
                "X-Voice-Mode": mode,
                "X-Voice-Path": speaker_wav_path,
                "X-Voice-Name": voice,
            },
        )

    except Exception as e:
        return Response(
            content=f"TTS error: {e}",
            status_code=500,
            headers={"X-Voice-Mode": "exception"},
        )
