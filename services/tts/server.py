import io
import numpy as np
import soundfile as sf
from fastapi import FastAPI, Response, Request
from TTS.api import TTS

app = FastAPI()

# Load XTTS v2 once at startup (uses GPU if available)
tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2", gpu=True)

DEFAULT_LANG = "en"
DEFAULT_SPEAKER = "Ana Florence"  # one of the common example speakers

@app.post("/tts_stream")
async def tts_stream(request: Request):
    # Mirror the header-style interface you used in your Worker proxy
    h = request.headers
    text = h.get("text")
    language = h.get("language", DEFAULT_LANG)
    speaker = h.get("speaker", DEFAULT_SPEAKER)

    if not text:
        return Response(content="Missing 'text' header", status_code=400)

    # Generate audio (wav) in memory
    wav = tts.tts(text=text, speaker=speaker, language=language)

    # Encode as WAV
    buf = io.BytesIO()
    sf.write(buf, np.array(wav, dtype=np.float32), samplerate=24000, format="WAV")
    data = buf.getvalue()

    return Response(content=data, media_type="audio/wav")
