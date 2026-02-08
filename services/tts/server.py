import io
import os
import re
import numpy as np
import soundfile as sf
from fastapi import FastAPI, Response, Request
from TTS.api import TTS

app = FastAPI()

tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)

DEFAULT_LANG = "en"
DEFAULT_VOICE = "adam"  # voices/adam.wav
VOICES_DIR = os.path.join(os.path.dirname(__file__), "voices")


def normalize_for_xtts(text: str, lang: str) -> str:
    t = (text or "").strip()
    L = (lang or "").lower()

    if L.startswith("it"): # Italian has issue with period, can add any languages with similar issues.
        protected = {}

        def protect(m):
            key = f"__ABBR{len(protected)}__"
            protected[key] = m.group(0)
            return key

        # Optional: protect common abbreviations so we don't kill their dot
        t = re.sub(r"\b(?:Sig|Dott|Dr|Prof|Ing|Avv)\.", protect, t)

        # 3.14 -> 3,14
        t = re.sub(r"(\d)\.(\d)", r"\1,\2", t)

        # Sentence-final "." -> newline pause (prevents "punto")
        t = re.sub(r"\.(\s+|$)", r"\n\1", t)

        # Avoid literal reads like "due punti"
        t = t.replace(":", " ")
        t = t.replace(";", " ")
        t = t.replace("•", " ")
        t = t.replace("…", "\n")

        # Light cleanup
        t = re.sub(r"[\"“”‘’]", "", t)

        # Restore abbreviations
        for k, v in protected.items():
            t = t.replace(k, v)

        # Normalize whitespace but keep newlines as pauses
        t = re.sub(r"[ \t]+", " ", t)
        t = re.sub(r"\n{3,}", "\n\n", t).strip()

        return t

    # default non-IT cleanup
    t = re.sub(r"\s+", " ", t).strip()
    return t


@app.post("/tts_stream")
async def tts_stream(request: Request):
    h = request.headers
    text = h.get("text")
    language = h.get("language", DEFAULT_LANG)

    voice = h.get("voice", DEFAULT_VOICE)
    speaker = h.get("speaker")  # optional built-in

    if not text:
        return Response(content="Missing 'text' header", status_code=400)

    # normalize text BEFORE TTS to avoid "punto"
    text = normalize_for_xtts(text, language)

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

    try:
        if voice and os.path.exists(speaker_wav_path):
            try:
                wav = tts.tts(text=text, speaker_wav=speaker_wav_path, language=language)
                mode = "speaker_wav"
            except TypeError:
                wav = tts.tts(text=text, speaker_wav=[speaker_wav_path], language=language)
                mode = "speaker_wav_list"
        else:
            fallback = speaker or "Ana Florence"
            wav = tts.tts(text=text, speaker=fallback, language=language)
            mode = f"built_in:{fallback}"

        buf = io.BytesIO()


        wav = np.array(wav, dtype=np.float32)

        # ---- Loudness / level fix (simple peak normalize + limiter) ----
        peak = float(np.max(np.abs(wav))) + 1e-9

        # Target -1 dBFS peak ≈ 0.891
        target_peak = 10 ** (-1.0 / 20.0)

        gain = target_peak / peak

        # Cap gain so we don't blow up quiet/noisy outputs
        gain = min(gain, 8.0)  # up to about +18 dB

        wav = wav * gain

        # Hard limiter safety
        wav = np.clip(wav, -0.98, 0.98)
        # ---------------------------------------------------------------



        sf.write(
            buf,
            np.array(wav, dtype=np.float32),
            samplerate=24000,
            format="WAV",
            subtype="PCM_16",
        )
        data = buf.getvalue()

        return Response(
            content=data,
            media_type="audio/wav",
            headers={
                "X-Voice-Mode": mode,
                "X-Voice-Path": speaker_wav_path,
                "X-Voice-Name": voice,
                "X-Normalized": "1",
            },
        )

    except Exception as e:
        return Response(
            content=f"TTS error: {e}",
            status_code=500,
            headers={"X-Voice-Mode": "exception"},
        )
