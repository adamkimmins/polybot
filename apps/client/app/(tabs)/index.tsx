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


  const ttsQueueRef = useRef<string[]>([]);
  const ttsPlayingRef = useRef(false);

  useEffect(() => {
    // When native playback ends, trigger next queued chunk
    const sub = ttsPlayer.addListener("playbackStatusUpdate", (status: any) => {
      if (status?.didJustFinish) {
        ttsPlayingRef.current = false;
        void pumpTtsQueue();
      }
    });

    return () => sub.remove?.();
  }, [ttsPlayer]);

const enqueueTts = (chunk: string) => {
  const cleaned = chunk
    .replace(/\s+/g, " ")
    .trim();

  // Reject empty or punctuation-only chunks
  if (!cleaned) return;
  if (!/[A-Za-z0-9]/.test(cleaned)) return;

  ttsQueueRef.current.push(cleaned);
  void pumpTtsQueue();
};


  const pumpTtsQueue = async () => {
    if (ttsPlayingRef.current) return;
    const next = ttsQueueRef.current.shift();
    if (!next) return;

    ttsPlayingRef.current = true;

    try {
      // Your XTTS proxy endpoint
      const ttsResp = await fetch(`${API_URL}/tts_xtts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: next, language: "en", chunkSize: 20 })
      });

      if (!ttsResp.ok) {
        console.error("XTTS failed:", await ttsResp.text());
        ttsPlayingRef.current = false;
        return;
      }

      const ab = await ttsResp.arrayBuffer();
      const contentType = ttsResp.headers.get("content-type") ?? "";
      const isWav = contentType.includes("wav");
      const ext = isWav ? "wav" : "mp3";
      const mime = isWav ? "audio/wav" : "audio/mpeg";

      if (Platform.OS === "web") {
        const blob = new Blob([ab], { type: mime });
        const url = URL.createObjectURL(blob);
        const audioEl = new Audio(url);
        audioEl.onended = () => {
          URL.revokeObjectURL(url);
          ttsPlayingRef.current = false;
          void pumpTtsQueue();
        };
        await audioEl.play();
      } else {
        const base64 = Buffer.from(new Uint8Array(ab)).toString("base64");
        const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}.${ext}`;

        await FileSystem.writeAsStringAsync(uri, base64, {
          encoding: FileSystem.EncodingType.Base64
        });

        ttsPlayer.replace({ uri });
        ttsPlayer.seekTo(0);
        ttsPlayer.play();
        // Next chunk will be triggered by playbackStatusUpdate.didJustFinish
      }
    } catch (e) {
      console.error("pumpTtsQueue error:", e);
      ttsPlayingRef.current = false;
    }
  };



  const stopStreaming = () => {
    abortRef.current?.abort();
    abortRef.current = null;

    setIsStreaming(false);
    setLoading(false);
    setTimeout(() => setShowTalk(false), 800);

    ttsQueueRef.current = [];
    ttsPlayingRef.current = false;
    ttsPlayer.pause?.();

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

                // avoid tiny junk chunks
                if (chunk.trim().length >= 8) {
                  enqueueTts(chunk);
                }
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
  enqueueTts(speechBuffer);
  speechBuffer = "";
}


      setIsStreaming(false);
      setTalk(fullText);
      const talkText = fullText;

      // TTS
      // try {
      //   const ttsResp = await fetch(`${API_URL}/tts`, {
      //     method: "POST",
      //     headers: { "Content-Type": "application/json" },
      //     body: JSON.stringify({ text: talkText })
      //   });

      //   if (!ttsResp.ok) {
      //     console.error("TTS failed:", await ttsResp.text());
      //   } else {
      //     const ab = await ttsResp.arrayBuffer();

      //     if (Platform.OS === "web") {
      //       const blob = new Blob([ab], { type: "audio/mpeg" });
      //       const url = URL.createObjectURL(blob);
      //       const audioEl = new Audio(url);
      //       audioEl.onended = () => URL.revokeObjectURL(url);
      //       await audioEl.play();
      //     } else {
      //       const base64 = Buffer.from(new Uint8Array(ab)).toString("base64");
      //       const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}.mp3`;

      //       await FileSystem.writeAsStringAsync(uri, base64, {
      //         encoding: FileSystem.EncodingType.Base64
      //       });

      //       ttsPlayer.replace({ uri });
      //       ttsPlayer.seekTo(0);
      //       ttsPlayer.play();
      //     }
      //   }
      // } catch (e) {
      //   console.error("TTS client error:", e);
      // }

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
