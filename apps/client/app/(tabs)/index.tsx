import { MaterialIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { makeId } from "@/utils/uuid";
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Pressable
} from "react-native";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
const SESSION_ID = process.env.EXPO_PUBLIC_SESSION_ID ?? "local-dev-session";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  teach?: string;
};

type SendPhase = "idle" | "ready" | "sending";

export default function HomeScreen() {
  const [input, setInput] = useState("");
  const [talk, setTalk] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const [streamedTalk, setStreamedTalk] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTalk, setShowTalk] = useState(false);

  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const abortRef = useRef<AbortController | null>(null);

  const ttsPlayer = useAudioPlayer();

  // TTS queueing system
  const textQueueRef = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  const playQueueRef = useRef<{ uri: string; kind: "native" | "web" }[]>([]);
  const playingRef = useRef(false);

  const MAX_PREFETCH = 2; // number of audio generations allowed ahead


  // warm up ping
  useEffect(() => {
    fetch(`${API_URL}/ping`).catch(() => { });
  }, []);

  // audio mode setup
  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => { });
  }, []);

  useEffect(() => {
    if (isStreaming || loading) setSendPhase("sending");
    else if (input.trim().length > 0) setSendPhase("ready");
    else setSendPhase("idle");
  }, [input, loading, isStreaming]);

  useEffect(() => {
    const sub = ttsPlayer.addListener("playbackStatusUpdate", (status: any) => {
      if (status?.didJustFinish) {
        playingRef.current = false;
        void pumpPlayback();
      }
    });
    return () => sub.remove?.();
  }, [ttsPlayer]);


  const enqueueTtsChunk = (chunk: string) => {
    const cleaned = chunk.replace(/\s+/g, " ").trim();
    if (!cleaned) return;

    // Reject punctuation-only
    if (!/[A-Za-z]/.test(cleaned) && !/[0-9]/.test(cleaned)) return;

    textQueueRef.current.push(cleaned);
    void pumpPrefetch();
  };


  const pumpPrefetch = async () => {
    // already prefetching enough
    while (inFlightRef.current < MAX_PREFETCH && textQueueRef.current.length > 0) {
      const nextText = textQueueRef.current.shift()!;
      inFlightRef.current++;

      // fire and forget – completion will push into playQueue
      void synthesizeOne(nextText).finally(() => {
        inFlightRef.current--;
        void pumpPrefetch();     // keep filling prefetch slots
        void pumpPlayback();     // try play if ready
      });
    }
  };

  const synthesizeOne = async (text: string) => {
    const ttsResp = await fetch(`${API_URL}/tts_xtts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language: "en", chunkSize: 20 })
    });

    if (!ttsResp.ok) {
      const err = await ttsResp.text().catch(() => "");
      console.error("XTTS failed:", ttsResp.status, err, "text=", text);
      return;
    }

    const ab = await ttsResp.arrayBuffer();
    const ct = ttsResp.headers.get("content-type") ?? "";
    const isWav = ct.includes("wav");
    const ext = isWav ? "wav" : "mp3";
    const mime = isWav ? "audio/wav" : "audio/mpeg";

    if (Platform.OS === "web") {
      const blob = new Blob([ab], { type: mime });
      const url = URL.createObjectURL(blob);
      playQueueRef.current.push({ uri: url, kind: "web" });
    } else {
      const base64 = Buffer.from(new Uint8Array(ab)).toString("base64");
      const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}.${ext}`;

      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64
      });

      playQueueRef.current.push({ uri, kind: "native" });
    }
  };

  const pumpPlayback = async () => {
    if (playingRef.current) return;
    const next = playQueueRef.current.shift();
    if (!next) return;

    playingRef.current = true;

    try {
      if (next.kind === "web") {
        const audioEl = new Audio(next.uri);
        audioEl.onended = () => {
          URL.revokeObjectURL(next.uri);
          playingRef.current = false;
          void pumpPlayback();
        };
        await audioEl.play();
      } else {
        // native
        ttsPlayer.replace({ uri: next.uri });
        ttsPlayer.seekTo(0);
        ttsPlayer.play();

        // when didJustFinish -> playingRef.current = false; pumpPlayback();
      }
    } catch (e) {
      console.error("playback error:", e);
      playingRef.current = false;
      void pumpPlayback();
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;

    textQueueRef.current = [];
    playQueueRef.current = [];
    inFlightRef.current = 0;
    playingRef.current = false;

    ttsPlayer.pause?.();

    setIsStreaming(false);
    setLoading(false);
    setTimeout(() => setShowTalk(false), 800);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setMessages(prev => [...prev, { id: makeId(), role: "user", content: text }]);

    let fullText = "";
    let speechBuffer = "";

    setInput("");
    setLoading(true);
    setTalk("");
    setStreamedTalk("");
    setShowTalk(true);

    try {
      abortRef.current = new AbortController();

      const res = await fetch(`${API_URL}/talk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: SESSION_ID, userText: text }),
        signal: abortRef.current.signal
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Talk failed: ${res.status} ${errText}`);
      }

      const decoder = new TextDecoder();
      // let fullText = "";

      const consumeSSEText = (raw: string) => {
        const events = raw.split(/\r?\n\r?\n/);

        for (const evt of events) {
          const lines = evt.split(/\r?\n/);

          for (const line of lines) {
            if (!line.startsWith("data:")) continue;

            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload);
              const token: string | undefined = parsed?.response;
              if (!token) continue;

              // Existing behavior
              fullText += token;
              setStreamedTalk(prev => prev + token);

              // NEW: sentence-chunk TTS
              speechBuffer += token;

              // Pull out complete sentences/newlines from speechBuffer
              while (true) {
                // sentence ends with . ! ? or newline
                const match = speechBuffer.match(
                  /^[\s\S]*?[.!?](?:\s+|$)|^[\s\S]*?\n/
                );
                if (!match) break;

                const chunk = match[0];
                speechBuffer = speechBuffer.slice(chunk.length);

                const cleaned = chunk.replace(/\s+/g, " ").trim();
                const words = cleaned ? cleaned.split(" ").length : 0;

                // Speak if it's not junk AND it's either:
                // - at least 2 words, OR
                // - at least 8 chars, OR
                // - it's a very short first greeting (<= 6 chars but has letters)[trying to avoid stream intialization junk]
                const hasLetters = /[A-Za-z]/.test(cleaned);
                const ok =
                  cleaned.length >= 8 ||
                  words >= 2 ||
                  (hasLetters && cleaned.length <= 6);

                if (ok) enqueueTtsChunk(cleaned);
              }
            } catch {
              // ignore
            }
          }
        }
      };


      setIsStreaming(true);

      const canStream =
        !!(res as any).body && typeof (res as any).body.getReader === "function";

      if (canStream) {
        const reader = (res as any).body.getReader();
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\r?\n\r?\n/);
          buffer = parts.pop() ?? "";

          for (const part of parts) consumeSSEText(part + "\n\n");
        }

        if (buffer) consumeSSEText(buffer);
      } else {
        // iOS/Expo fallback (no streaming)
        const raw = await res.text();
        consumeSSEText(raw);
      }

      // Flush any leftover partial text at the end
      if (speechBuffer.trim().length > 0) {
        enqueueTtsChunk(speechBuffer);
        speechBuffer = "";
      }


      setIsStreaming(false);
      setTalk(fullText);
      const talkText = fullText;

      // Teach
      const teachResp = await fetch(`${API_URL}/teach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userText: text, talkText })
      });
      const teachJson = await teachResp.json();

      setMessages(prev => [
        ...prev,
        { id: makeId(), role: "assistant", content: talkText, teach: teachJson.teach }
      ]);
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // user pressed stop; don't show network error
        return;
      }
      console.error(e);
      setTalk("Network error");
    } finally {
      abortRef.current = null;
      setLoading(false);
      setIsStreaming(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>
        <Text style={styles.logo}>Polybot</Text>
        <Pressable style={styles.settingsButton}>
          <MaterialIcons name="settings" size={32} color="#000000" />
        </Pressable>
      </View>

      {showTalk && (streamedTalk.length > 0 || talk.length > 0) && (
        <View style={styles.talkContainer}>
          <Text style={styles.talkText}>{isStreaming ? streamedTalk : talk}</Text>
        </View>
      )}

      <ScrollView style={styles.teachScroll} contentContainerStyle={styles.teachContent}>
        {messages.map(msg => (
          <View key={msg.id} style={styles.messageBlock}>
            {msg.role === "user" && <Text style={styles.userText}>{msg.content}</Text>}
            {msg.role === "assistant" && msg.teach && (
              <Text style={styles.teachText}>{msg.teach}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          placeholder="Ask something..."
          value={input}
          onChangeText={setInput}
          multiline
        />

        <Pressable
          style={styles.sendButton}
          onPress={sendPhase === "sending" ? stopStreaming : sendMessage}
          disabled={sendPhase === "idle"}
        >
          {sendPhase === "idle" && (
            <MaterialIcons name="graphic-eq" size={34} color="#dcf9ff" />
          )}
          {sendPhase === "ready" && <MaterialIcons name="north" size={27} color="#dcf9ff" />}
          {sendPhase === "sending" && <MaterialIcons name="stop" size={28} color="#dcf9ff" />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 20
  },
  topBar: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10
  },
  logo: { fontSize: 22, fontWeight: "600" },
  settingsButton: { padding: 6 },

  talkContainer: { marginVertical: 24, alignItems: "center" },
  talkText: {
    fontSize: 20,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: "90%"
  },

  teachScroll: { flex: 1, width: "100%", marginBottom: 16 },
  teachContent: { paddingHorizontal: 20 },
  messageBlock: { marginBottom: 16 },

  userText: {
    fontSize: 15,
    color: "#111",
    alignSelf: "flex-end",
    maxWidth: "70%",
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#6198ba3c"
  },
  teachText: { fontSize: 15, color: "#444", textAlign: "left" },

  inputWrapper: {
    position: "relative",
    marginBottom: 12,
    marginTop: 12,
    marginLeft: 20,
    marginRight: 20
  },
  input: {
    borderWidth: 1,
    borderRadius: 40,
    padding: 20,
    fontSize: 16
  },
  sendButton: {
    position: "absolute",
    right: 12,
    bottom: 12,
    width: 40,
    height: 40,
    borderRadius: 24,
    backgroundColor: "#001d34",
    justifyContent: "center",
    alignItems: "center"
  }
});
