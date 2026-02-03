import { MaterialIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";
import { useAudioPlayer, setAudioModeAsync } from "expo-audio";
import { makeId } from "@/utils/uuid";
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  Keyboard,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Pressable
} from "react-native";
import { hide } from "expo-router/build/utils/splash";

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

  //tutor/teach bar
  type hintMode = "off" | "hint" | "tutor";
  const [hintMode, sethintMode] = useState<hintMode>("tutor");


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
      // The field names vary a bit across expo versions, so check a few patterns
      const didJustFinish = status?.didJustFinish === true;

      const isLoaded = status?.isLoaded ?? true; // some builds omit it
      const isPlaying = status?.isPlaying === true;

      const position = status?.positionMillis ?? status?.position ?? 0;
      const duration = status?.durationMillis ?? status?.duration ?? 0;

      const endedByPosition =
        isLoaded &&
        !isPlaying &&
        duration > 0 &&
        position >= duration - 150; // small tolerance

      if (didJustFinish || endedByPosition) {
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
      body: JSON.stringify({ text, language: "en", chunkSize: 20, voice: "adam"})
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
    Keyboard.dismiss();


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
      if (hintMode !== "off") {
        const teachResp = await fetch(`${API_URL}/teach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userText: text,
            talkText,
            mode: hintMode === "hint" ? "translate" : "tutor"
          })
        });

        const teachJson = await teachResp.json();

        setMessages(prev => [
          ...prev,
          { id: makeId(), role: "assistant", content: talkText, teach: teachJson.teach }
        ]);
      } else {
        setMessages(prev => [
          ...prev,
          { id: makeId(), role: "assistant", content: talkText }
        ]);
      }

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
      style={[styles.container, Platform.OS === "web" && { paddingTop: 20, paddingBottom: 0 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>

        {/* Name */}
        {/* <Text style={styles.logo}>Polybot</Text> */}
   
           <Image
                  source={require('@/assets/images/SmallPolybotLogoLIGHT.png')}
                  style={[styles.logo, Platform.OS === "web" && styles.logoWeb]}
          />

        {/* settings button */}
        <Pressable style={styles.settingsButton}>
          <MaterialIcons name="settings" size={32} color="#000000" />
        </Pressable>
      </View>

      {showTalk && (streamedTalk.length > 0 || talk.length > 0) && (
        <View style={[styles.talkContainer, Platform.OS === "web" && styles.talkContainerWeb, hintMode === "off" && styles.bigTalkContainer]}>
          <Text style={styles.talkText}>{isStreaming ? streamedTalk : talk}</Text>
        </View>
      )}
      {showTalk && (streamedTalk.length > 0 || talk.length > 0) && (
        <View style={[styles.hide, Platform.OS === "web" && hintMode !== "off" && styles.showTutor]}>
          <Text style={styles.tutorText}>{ hintMode === "hint" ? "Hint" : "Tutor"}</Text>
        </View>
      )}
      

      <ScrollView style={[styles.teachScroll, Platform.OS === "web" && styles.teachScrollWeb, hintMode === "off" && styles.hide]} contentContainerStyle={styles.teachContent}>
        {messages.map(msg => (
          <View key={msg.id} style={styles.messageBlock}>
            {msg.role === "user" && <Text style={styles.userText}>{msg.content}</Text>}
            {msg.role === "assistant" && msg.teach && (
              <Text style={styles.teachText}>{msg.teach}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.inputWrapper, Platform.OS === "web" && styles.inputWrapperWeb]}>
        
        <View style={[styles.helpBar, Platform.OS === "web" && styles.helpBarWeb]}>
        <View style={[styles.segment, Platform.OS === "web" && styles.segmentWeb]}>
          <Pressable
            onPress={() => sethintMode("off")}
            style={[
              styles.segmentBtn,
              styles.segmentLeft,
              hintMode === "off" && styles.segmentBtnActive
            ]}
          >
            <Text style={[styles.segmentText, hintMode === "off" && styles.segmentTextActive]}>
              Off
            </Text>
          </Pressable>

          <Pressable
            onPress={() => sethintMode("hint")}
            style={[
              styles.segmentBtn,
              styles.segmentMiddle,
              hintMode === "hint" && styles.segmentBtnActive, Platform.OS === "web" && styles.segmentMiddleWeb
            ]}
          >
            <Text style={[styles.segmentText, hintMode === "hint" && styles.segmentTextActive]}>
              Hint
            </Text>
          </Pressable>

          <Pressable
            onPress={() => sethintMode("tutor")}
            style={[
              styles.segmentBtn,
              styles.segmentRight,
              hintMode === "tutor" && styles.segmentBtnActive
            ]}
          >
            <Text style={[styles.segmentText, hintMode === "tutor" && styles.segmentTextActive]}>
              Tutor
            </Text>
          </Pressable>
        </View>
      </View>
        
        <TextInput
          style={[styles.input, Platform.OS === "web" && styles.inputWeb]}
          placeholder="Ask something..."
          value={input}
          onChangeText={setInput}
          multiline
        />

        

        <Pressable
          style={[styles.sendButton, Platform.OS === "web" && styles.sendButtonWeb]}
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
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingTop: 80,
    paddingBottom: 20,
  },
  bigTalkContainer: {
    left: 0,
    right: 0,
    bottom: "30%",
    marginVertical: 0,
    paddingBottom: 50,
    paddingTop: 50,
    borderBottomWidth: 0
  },
  topBar: {
    position: "absolute",
    top: 12,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
    
  },
  logo: { width: 200, height: 80, left:"20%", top: 10, resizeMode: "contain" },
  logoWeb: { width: 110, height: 60, left:0, top: 0, resizeMode: "contain" },
  settingsButton: { padding: 6 },

  helpBar: {
    width: "70%",
    alignSelf: "center",
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 6,
  },
  helpTitle: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
  },
  segment: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden"
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center"
  },
  segmentLeft: {},
  segmentMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1
  },
  segmentRight: {},
  segmentBtnActive: {
    backgroundColor: "#001d34"
  },
  segmentText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#001d34"
  },
  segmentTextActive: {
    color: "#dcf9ff"
  },

  talkContainer: { marginTop: 48, marginBottom: 10, alignItems: "center",},
  talkText: {
    fontSize: 20,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: "90%"
  },

  teachScroll: { flex: 1, width: "100%" },
  teachContent: { paddingHorizontal: 20 },
  messageBlock: { marginBottom: 16},

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
    
    marginBottom: 10,
    marginTop: 0,
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
  },

  hide: {
    display: "none",  
  },
  showTutor: {
    display: "flex",
    position: "absolute",
    top: 103,
    alignItems: "center",
    marginVertical: 0,
    borderTopWidth: 1,
    width: "8%",
  },
  tutorText: {
    fontSize: 14,
    color: "#dcf9ff",
    backgroundColor: "#001d34",
    paddingHorizontal: 4,
    paddingBottom: 4,
    borderBottomEndRadius: 6,
    borderBottomStartRadius: 6,
  },

  talkContainerWeb: { 
        position: "fixed",
    top: 66,
    width: "100%",
    marginBottom: 0, 
    paddingBottom: 10,
    backgroundColor: "#f0f0f000",
    borderBottomWidth: 1,
    borderBottomColor: "#ccc",
    marginTop: 0, 
    alignItems: "center" 
  },
  teachScrollWeb:{
    top: 50,
    marginTop: 33,
    marginBottom: 47,
  },
  inputWrapperWeb:{
    position: "relative",
    marginBottom: 0,
    paddingTop: 37,
    paddingBottom: 40,
  },
    inputWeb:{
    position: "fixed",
    width: "75%",
    alignSelf: "center",
    marginLeft: 15,
    marginRight: 10,
    bottom: 55,
    borderWidth: 1,
    borderRadius: 40,
    paddingBottom: 0,
  },
  sendButtonWeb: {
    position: "fixed",
    height: 65,
    width: 65,
    right: "3%",
    bottom: 55,
    borderRadius: 40,
  },
  helpBarWeb: {
    position: "fixed",
    bottom: 49, //55 above floor, -6 margin
    left: 5,
    width: "12%",
    paddingBottom: -6,
  },
   segmentWeb: {
    height: 65,
    flexDirection: "column",
   },
  segmentMiddleWeb: {
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderRightWidth: 0
  }
});
