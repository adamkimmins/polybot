// app/(tabs)/index.tsx  (or wherever your HomeScreen lives)

import { MaterialIcons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import { Buffer } from "buffer";
import { makeId } from "@/utils/uuid";
import { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  Image,
  Keyboard,
  Animated,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Pressable,
} from "react-native";

import {
  useAudioPlayer,
  setAudioModeAsync,
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  useAudioRecorderState,
} from "expo-audio";

import { useSettings } from "@/components/settings";
import { Stack, useRouter } from "expo-router";
import BouncingDots from "@/components/chat/BouncingDots";
import MiniWave from "@/components/chat/MiniWave";

// ✅ NEW: extracted UI components
import CenterMic from "@/components/chat/CenterMic";
import BottomBar from "@/components/chat/BottomBar";

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";
const SESSION_ID = process.env.EXPO_PUBLIC_SESSION_ID ?? "local-dev-session";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  teach?: string;
};

type EntryMode = "voice" | "text";
type HintMode = "off" | "hint" | "tutor";

// Mic UI phase is separate from “network loading”
// so you can show Loading/Ending even when not streaming.
type MicPhase = "idle" | "arming" | "ending";

export default function HomeScreen() {
  const [input, setInput] = useState("");
  const [talk, setTalk] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const { settings } = useSettings();
  const { learnLang, voiceId } = settings;
  const router = useRouter();

  // Talk streaming UI
  const [streamedTalk, setStreamedTalk] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [showTalk, setShowTalk] = useState(false);

  // Entry mode
  const [entryMode, setEntryMode] = useState<EntryMode>("voice");

  // Tutor/teach bar
  const [hintMode, setHintMode] = useState<HintMode>("tutor");

  // STT
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);
  const [isTranscribing, setIsTranscribing] = useState(false);

  // Mic visuals
  const [micPhase, setMicPhase] = useState<MicPhase>("idle");
  const centerAnim = useRef(new Animated.Value(1)).current; // 1 = voice visible, 0 = hidden

  // Slide input bar in/out
  const inputSlide = useRef(new Animated.Value(0)).current; // 0 hidden, 1 shown

  // Abort/stop refs
  const abortRef = useRef<AbortController | null>(null);

  // TTS
  const ttsPlayer = useAudioPlayer();
  const textQueueRef = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  const playQueueRef = useRef<{ uri: string; kind: "native" | "web" }[]>([]);
  const playingRef = useRef(false);
  const MAX_PREFETCH = 2;

  const runIdRef = useRef(0);
  const ttsAbortSetRef = useRef<Set<AbortController>>(new Set());
  const currentWebAudioRef = useRef<any>(null);

  const bumpRun = () => {
    runIdRef.current += 1;
    return runIdRef.current;
  };

  const abortAllTtsFetches = () => {
    for (const ac of ttsAbortSetRef.current) ac.abort();
    ttsAbortSetRef.current.clear();
  };

  const hardStopAudioNow = () => {
    textQueueRef.current = [];
    playQueueRef.current = [];
    inFlightRef.current = 0;
    playingRef.current = false;

    try {
      ttsPlayer.pause?.();
      ttsPlayer.seekTo?.(0);
    } catch {}

    try {
      if (currentWebAudioRef.current) {
        currentWebAudioRef.current.pause?.();
        currentWebAudioRef.current.src = "";
        currentWebAudioRef.current = null;
      }
    } catch {}
  };

  const stopStreaming = () => {
    bumpRun();

    abortRef.current?.abort();
    abortRef.current = null;

    abortAllTtsFetches();
    hardStopAudioNow();

    setIsStreaming(false);
    setLoading(false);
    setIsTranscribing(false);

    // ✅ NEW: make sure mic UI never gets stuck in a non-idle phase
    setMicPhase("idle");

    setTimeout(() => setShowTalk(false), 200);
  };

  // Warm up
  useEffect(() => {
    fetch(`${API_URL}/ping`).catch(() => {});
  }, []);

  // Mic permissions + audio mode
  useEffect(() => {
    (async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.warn("Microphone permission denied");
        return;
      }
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: true,
      });
    })().catch(() => {});
  }, []);

  // Keep TTS queue pumping when native playback ends
  useEffect(() => {
    const sub = ttsPlayer.addListener("playbackStatusUpdate", (status: any) => {
      const didJustFinish = status?.didJustFinish === true;
      const isLoaded = status?.isLoaded ?? true;
      const isPlaying = status?.isPlaying === true;

      const position = status?.positionMillis ?? status?.position ?? 0;
      const duration = status?.durationMillis ?? status?.duration ?? 0;

      const endedByPosition =
        isLoaded && !isPlaying && duration > 0 && position >= duration - 150;

      if (didJustFinish || endedByPosition) {
        playingRef.current = false;
        void pumpPlayback();
      }
    });

    return () => sub.remove?.();
  }, [ttsPlayer]);

  // Mode switches (voice <-> text)
  const goVoiceMode = () => {
    setEntryMode("voice");
    Animated.parallel([
      Animated.timing(inputSlide, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(centerAnim, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const goTextMode = async () => {
    stopStreaming();
    try {
      if (recorderState.isRecording) await audioRecorder.stop();
    } catch {}

    setMicPhase("idle");
    setEntryMode("text");

    Animated.parallel([
      Animated.timing(centerAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(inputSlide, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Start in voice mode, centered
  useEffect(() => {
    goVoiceMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- STT ----------
  const transcribeLastRecording = async (): Promise<string> => {
    const uri = audioRecorder.uri;
    if (!uri) return "";

    const form = new FormData();
    form.append("lang", learnLang);

    if (Platform.OS === "web") {
      const blob = await (await fetch(uri)).blob();
      form.append("audio", blob, "speech.webm");
    } else {
      form.append(
        "audio",
        {
          uri,
          name: "speech.m4a",
          type: "audio/m4a",
        } as any
      );
    }

    const res = await fetch(`${API_URL}/stt`, {
      method: "POST",
      body: form,
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("STT failed:", res.status, j);
      return "";
    }

    return String(j?.text ?? "").trim();
  };

  // ---------- TTS queue ----------
  const enqueueTtsChunk = (chunk: string) => {
    const cleaned = chunk.replace(/\s+/g, " ").trim();
    if (!cleaned) return;
    if (!/[A-Za-z0-9]/.test(cleaned)) return;

    textQueueRef.current.push(cleaned);
    void pumpPrefetch();
  };

  const pumpPrefetch = async () => {
    while (inFlightRef.current < MAX_PREFETCH && textQueueRef.current.length > 0) {
      const nextText = textQueueRef.current.shift()!;
      inFlightRef.current++;

      void synthesizeOne(nextText).finally(() => {
        inFlightRef.current--;
        void pumpPrefetch();
        void pumpPlayback();
      });
    }
  };

  const synthesizeOne = async (text: string) => {
    const myRun = runIdRef.current;

    const ac = new AbortController();
    ttsAbortSetRef.current.add(ac);

    try {
      const ttsResp = await fetch(`${API_URL}/tts_xtts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          text,
          language: learnLang,
          chunkSize: 20,
          voice: voiceId,
        }),
      });

      if (myRun !== runIdRef.current) return;

      if (!ttsResp.ok) {
        const err = await ttsResp.text().catch(() => "");
        console.error("XTTS failed:", ttsResp.status, err, "text=", text);
        return;
      }

      const ab = await ttsResp.arrayBuffer();
      if (myRun !== runIdRef.current) return;

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
          encoding: FileSystem.EncodingType.Base64,
        });

        if (myRun !== runIdRef.current) return;
        playQueueRef.current.push({ uri, kind: "native" });
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") console.error("XTTS synth error:", e);
    } finally {
      ttsAbortSetRef.current.delete(ac);
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
        currentWebAudioRef.current = audioEl;

        audioEl.onended = () => {
          URL.revokeObjectURL(next.uri);
          if (currentWebAudioRef.current === audioEl) currentWebAudioRef.current = null;
          playingRef.current = false;
          void pumpPlayback();
        };

        await audioEl.play();
      } else {
        ttsPlayer.replace({ uri: next.uri });
        ttsPlayer.seekTo(0);
        ttsPlayer.play();
      }
    } catch (e) {
      console.error("playback error:", e);
      playingRef.current = false;
      void pumpPlayback();
    }
  };

  // ---------- Sending ----------
  // Voice transcript -> TALK (stream) -> optional TEACH
  const sendTalkMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    setInput("");
    bumpRun();
    abortAllTtsFetches();
    hardStopAudioNow();

    setMessages((prev) => [...prev, { id: makeId(), role: "user", content: text }]);

    let fullText = "";
    let speechBuffer = "";

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
        body: JSON.stringify({ sessionId: SESSION_ID, userText: text, lang: learnLang }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Talk failed: ${res.status} ${errText}`);
      }

      const decoder = new TextDecoder();

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

              fullText += token;
              setStreamedTalk((prev) => prev + token);

              speechBuffer += token;

              while (true) {
                const match = speechBuffer.match(/^[\s\S]*?[.!?](?:\s+|$)|^[\s\S]*?\n/);
                if (!match) break;

                const chunk = match[0];
                speechBuffer = speechBuffer.slice(chunk.length);

                const cleaned = chunk.replace(/\s+/g, " ").trim();
                const words = cleaned ? cleaned.split(" ").length : 0;
                const hasLetters = /[A-Za-z]/.test(cleaned);

                const ok =
                  cleaned.length >= 8 ||
                  words >= 2 ||
                  (hasLetters && cleaned.length <= 6);

                if (ok) enqueueTtsChunk(cleaned);
              }
            } catch {
              // ignore bad frame
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
        const raw = await res.text();
        consumeSSEText(raw);
      }

      if (speechBuffer.trim().length > 0) {
        enqueueTtsChunk(speechBuffer);
        speechBuffer = "";
      }

      setIsStreaming(false);
      setTalk(fullText);
      const talkText = fullText;

      // Optional TEACH after TALK
      if (hintMode !== "off") {
        const teachResp = await fetch(`${API_URL}/teach`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userText: text,
            talkText,
            mode: hintMode === "hint" ? "translate" : "tutor",
          }),
        });

        const teachJson = await teachResp.json();

        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "assistant", content: talkText, teach: teachJson.teach },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { id: makeId(), role: "assistant", content: talkText },
        ]);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      console.error(e);
      setTalk("Network error");
    } finally {
      abortRef.current = null;
      setLoading(false);
      setIsStreaming(false);
    }
  };

  // Text-mode -> TEACH only (do NOT hit TALK)
  const sendTeachOnlyMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    setInput("");
    stopStreaming();
    bumpRun();

    setShowTalk(false);
    setTalk("");
    setStreamedTalk("");

    setMessages((prev) => [...prev, { id: makeId(), role: "user", content: text }]);
    setLoading(true);
    Keyboard.dismiss();

    try {
      const mode = hintMode === "hint" ? "translate" : "tutor"; // if "off", default to tutor in text-mode
      const res = await fetch(`${API_URL}/teach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userText: text,
          talkText: "",
          mode,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Teach failed: ${res.status} ${errText}`);
      }

      const teachJson = await res.json();
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "assistant", content: "", teach: teachJson.teach },
      ]);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        { id: makeId(), role: "assistant", content: "", teach: "Network error" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // cleaned indentation only (behavior unchanged)
  async function ensureRecordingReady() {
    // re-check permission (iOS can be weird if user changed it)
    const perm = await AudioModule.getRecordingPermissionsAsync();
    if (!perm.granted) {
      const req = await AudioModule.requestRecordingPermissionsAsync();
      if (!req.granted) throw new Error("Mic permission not granted");
    }

    // make sure audio subsystem is active, then allow recording
    await AudioModule.setIsAudioActiveAsync(true);
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
  }

  // ---------- Primary press behavior ----------
  const startRecording = async () => {
    stopStreaming();
    bumpRun();
    abortAllTtsFetches();
    hardStopAudioNow();

    Keyboard.dismiss();
    setMicPhase("arming");

    try {
      await ensureRecordingReady();

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (e) {
      console.error("Failed to start recording:", e);
      setMicPhase("idle");
      return;
    }

    // We show END based on recorderState.isRecording,
    // but dropping arming immediately makes UX feel snappy.
    setMicPhase("idle");
  };

  const stopAndSendRecording = async () => {
    setMicPhase("ending");
    setIsTranscribing(true);

    try {
      await audioRecorder.stop();
      const transcript = await transcribeLastRecording();
      if (transcript) await sendTalkMessage(transcript);
    } finally {
      setIsTranscribing(false);
      setMicPhase("idle");
    }
  };

  const onPrimaryPress = async () => {
    // If you’re streaming/loading a response, primary press is STOP.
    if (isStreaming || loading) {
      stopStreaming();
      return;
    }

    // Text mode:
    // - if typed text: TEACH only
    // - if empty: go voice mode (center mic)
    if (entryMode === "text") {
      if (input.trim().length > 0) {
        await sendTeachOnlyMessage();
      } else {
        goVoiceMode();
      }
      return;
    }

    // Voice mode:
    if (recorderState.isRecording) {
      await stopAndSendRecording();
      return;
    }

    await startRecording();
  };

  // ---------- Button visuals ----------
  const renderPrimaryButtonContent = (variant: "center" | "inline") => {
    const busyMic = micPhase !== "idle" || isTranscribing;
    const busyNet = loading || isStreaming;

    // Mic startup / stopping takes priority for labels in voice UX
    if (busyMic) {
      const label = "Ending";
      const effectiveLabel = micPhase === "arming" && !isTranscribing ? "Loading" : label;

      return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: "#dcf9ff", fontWeight: "900", fontSize: 12 }}>
            {effectiveLabel}
          </Text>
          <View style={{ marginLeft: 6 }}>
            <BouncingDots color="#dcf9ff" size={6} />
          </View>
        </View>
      );
    }

    // Network busy (LLM/TTS streaming)
    if (busyNet) {
      return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: "#dcf9ff", fontWeight: "900", fontSize: 12 }}>
            Loading
          </Text>
          <View style={{ marginLeft: 6 }}>
            <BouncingDots color="#dcf9ff" size={6} />
          </View>
        </View>
      );
    }

    // END only when actually recording
    if (recorderState.isRecording) {
      return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: "#dcf9ff", fontWeight: "900", fontSize: 12 }}>
            End
          </Text>
          <View style={{ marginLeft: 8 }}>
            <MiniWave color="#dcf9ff" />
          </View>
        </View>
      );
    }

    // Text mode: if typed text -> arrow
    if (entryMode === "text" && input.trim().length > 0) {
      return <MaterialIcons name="north" size={27} color="#dcf9ff" />;
    }

    // Default icon sizes
    const size =
      variant === "center"
        ? Platform.OS === "web"
          ? 65
          : 55
        : Platform.OS === "web"
        ? 32
        : 32;

    return <MaterialIcons name="graphic-eq" size={size} color="#dcf9ff" />;
  };

  const inputTx = inputSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 0],
  });

  const inputOpacity = inputSlide.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const centerOpacity = centerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const centerScale = centerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  const centerExpanded =
    loading ||
    isStreaming ||
    isTranscribing ||
    recorderState.isRecording ||
    micPhase !== "idle";

  const inlineExpanded = centerExpanded;

  return (
    <KeyboardAvoidingView
      style={[styles.container, Platform.OS === "web" && { paddingTop: 20, paddingBottom: 0 }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.topBar}>
        <Image
          source={require("@/assets/images/SmallPolybotLogoLIGHT.png")}
          style={[styles.logo, Platform.OS === "web" && styles.logoWeb]}
        />

        <Stack>
          <Stack.Screen
            name="settings"
            options={{ presentation: "modal", headerShown: true, title: "Settings" }}
          />
        </Stack>

        <Pressable style={styles.settingsButton} onPress={() => router.push("/settings")}>
          <MaterialIcons name="settings" size={32} color="#000000" />
        </Pressable>
      </View>

      {/* TALK output */}
      {/* {showTalk && (streamedTalk.length >= 0 || talk.length > 0) && ( */}
        <View style={[styles.talkContainer, Platform.OS === "web" && styles.talkContainerWeb, hintMode === "off" && styles.centerTalk]}>
          <Text style={styles.talkText}>{isStreaming ? streamedTalk : talk}</Text>
        </View>
      {/* )} */}

      {/* TEACH scroll */}
      <ScrollView
        style={[styles.teachScroll, Platform.OS === "web" && styles.teachScrollWeb, hintMode === "off" && styles.hide]}
        contentContainerStyle={styles.teachContent}
      >
        {messages.map((msg) => (
          <View key={msg.id} style={styles.messageBlock}>
            {msg.role === "user" && <Text style={styles.userText}>{msg.content}</Text>}
            {msg.role === "assistant" && msg.teach && (
              <Text style={styles.teachText}>{msg.teach}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      {/* ✅ Center mic extracted */}
      <CenterMic
        enabled={entryMode === "voice"}
        opacity={centerOpacity}
        scale={centerScale}
        expanded={centerExpanded}
        onPress={onPrimaryPress}
      >
        {renderPrimaryButtonContent("center")}
      </CenterMic>

      {/* ✅ Bottom bar extracted */}
      <BottomBar
        entryMode={entryMode}
        onToggleMode={() => (entryMode === "text" ? goVoiceMode() : goTextMode())}
        onGoVoiceMode={goVoiceMode}
        input={input}
        onChangeInput={setInput}
        inputTx={inputTx}
        inputOpacity={inputOpacity}
        onPrimaryPress={onPrimaryPress}
        inlineButtonExpanded={inlineExpanded}
        inlineButtonContent={renderPrimaryButtonContent("inline")}
        hintMode={hintMode}
        onHintModeChange={setHintMode}
      />
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
  logo: { width: 200, height: 80, left: "20%", top: 10, resizeMode: "contain" },
  logoWeb: { width: 110, height: 60, left: 0, top: 0, resizeMode: "contain" },
  settingsButton: { padding: 6 },

  talkContainer: {  marginTop: 80, marginBottom: 0, paddingBottom: 10, alignItems: "center" },
  talkContainerWeb: {
    position: "absolute",
    top: 66,
    width: "100%",
    marginBottom: 0,
    paddingBottom: 10,
    backgroundColor: "#f0f0f000",
    marginTop: 0,
    alignItems: "center",
    marginLeft: -20
  },
  talkText: {
    fontSize: 20,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: "90%",
  },
  centerTalk: {
    position: "relative",
    marginBottom: Platform.OS ==="web" ? 310 : 210,
    marginLeft: Platform.OS ==="web" ? 0 : undefined,
  },

  

  teachScroll: { flex: 1, width: "100%", marginBottom: -8, marginTop: 0,  },
  teachScrollWeb: {
    top: 50,
    marginTop: 33,
    marginBottom: 130,
  },
  teachContent: { padding: 20 },
  messageBlock: { marginBottom: 16 },

  userText: {
    fontSize: 15,
    color: "#111",
    alignSelf: "flex-end",
    maxWidth: "70%",
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#b8e9f7a6",
  },
  teachText: { fontSize: 15, color: "#444", textAlign: "left" },
  hide: {display:"none"}
});
