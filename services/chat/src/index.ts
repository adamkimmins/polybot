import type { Env } from "./env";

// MUST be exported from entrypoint
export { SessionDO } from "./session-do";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/ping") {
      return json({ status: "ok", service: "polybot" });
    }

    if (url.pathname === "/talk" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const { userText, sessionId } = body ?? {};
      if (!userText || !sessionId) {
        return json({ error: "userText and sessionId are required" }, 400);
      }

      const id = env.SESSION_DO.idFromName(sessionId);
      const session = env.SESSION_DO.get(id);

      void session.fetch("https://do/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "user", content: userText })
      });

      const aiStream = await env.AI.run("@cf/mistral/mistral-7b-instruct-v0.1", {
        messages: [
          {
            role: "system",
            content:
              "You are Polybot, a conversational AI. Respond naturally. Do not explain. Keep responses very short if you can, shorter is better."
          },
          { role: "user", content: userText }
        ],
        stream: true
      });

      let fullText = "";

      const stream = new ReadableStream({
        async start(controller) {
          const reader = aiStream.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();

          let sseBuffer = "";

          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;

              sseBuffer += decoder.decode(value, { stream: true });

              const events = sseBuffer.split("\n\n");
              sseBuffer = events.pop() ?? "";

              for (const evt of events) {
                const lines = evt.split("\n");
                const dataLine = lines.find(l => l.startsWith("data:"));
                if (!dataLine) continue;

                const data = dataLine.slice(5).trim();
                if (!data || data === "[DONE]") continue;

                let token = "";
                try {
                  const parsed = JSON.parse(data);
                  token = parsed.response ?? "";
                } catch {
                  continue;
                }

                if (!token) continue;

                fullText += token;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ response: token })}\n\n`)
                );
              }
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();

            void session.fetch("https://do/add", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "assistant", content: fullText })
            });
          } catch (err) {
            controller.error(err);
          }
        }
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders(),
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        }
      });
    }

    if (url.pathname === "/tts" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: "Invalid JSON", details: String(e) }, 400);
      }

      const { text } = body ?? {};
      if (!text) return json({ error: "text is required" }, 400);

      try {
        const audio = await env.AI.run("@cf/deepgram/aura-2-en", {
          text,
          speaker: "luna",
          encoding: "mp3"
        });

        return new Response(audio as any, {
          headers: {
            ...corsHeaders(),
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store"
          }
        });
      } catch (e: any) {
        console.error("TTS error:", e);
        return json(
          {
            error: "TTS failed",
            details: String(e?.message ?? e),
            name: e?.name,
            cause: e?.cause ? String(e.cause) : undefined
          },
          500
        );
      }
    }

    //new xtts version
    if (url.pathname === "/tts_xtts" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: "Invalid JSON", details: String(e) }, 400);
      }

      const { text, language = "en", chunkSize = 20 } = body ?? {};
      if (!text) return json({ error: "text is required" }, 400);

      // Local dev: XTTS server via python -m xtts.server
      // from .dev.vars
      const XTTS_URL = env.XTTS_URL ?? "http://localhost:8000";


      const upstream = await fetch(`${XTTS_URL}/tts_stream`, {
        method: "POST",
        headers: {
          // the xtts streaming server expects these headers in common setups
          text: String(text),
          language: String(language),
          add_wav_header: "True",
          stream_chunk_size: String(chunkSize),
        },
      });

      if (!upstream.ok || !upstream.body) {
        const err = await upstream.text().catch(() => "");
        return json({ error: "XTTS upstream failed", status: upstream.status, details: err }, 502);
      }

      // Stream passthrough (wav)
      return new Response(upstream.body, {
        headers: {
          ...corsHeaders(),
          "Content-Type": upstream.headers.get("content-type") ?? "audio/wav",
          "Cache-Control": "no-store",
        },
      });
    }
    //end xtts

    if (url.pathname === "/teach" && req.method === "POST") {
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }

      const { userText, talkText } = body ?? {};
      if (!userText || !talkText) {
        return json({ error: "userText and talkText are required" }, 400);
      }

      const teachRes = await env.AI.run("@cf/meta/llama-3-8b-instruct", {
        messages: [
          {
            role: "system",
            content: "You are a language tutor. Explain grammar and meaning clearly in simple English."
          },
          {
            role: "user",
            content: `User said:\n"${userText}"\n\nPolybot replied:\n"${talkText}"\n\nExplain briefly. Keep it as short as possible, do not over-explain.`
          }
        ]
      });

      return json({ teach: teachRes.response });
    }

    return json({ error: "Not found" }, 404);
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json"
    }
  });
}
