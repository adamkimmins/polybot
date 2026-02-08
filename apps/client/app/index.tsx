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
import { CenterMic } from "@/components/chat/CenterMic";
import { BottomBar } from "@/components/chat/BottomBar";
import { Stack, useRouter } from "expo-router";
import BouncingDots from "@/components/chat/BouncingDots";
import MiniWave from "@/components/chat/MiniWave";

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
      // When arming (not transcribing), show Loading instead of Ending
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

    // END only when actually recording (this fixes your main bug)
    if (recorderState.isRecording) {
      return (
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text style={{ color: "#dcf9ff", fontWeight: "900", fontSize: 12 }}>
            END
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
          ? 56
          : 44
        : Platform.OS === "web"
        ? 30
        : 22;

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
      {showTalk && (streamedTalk.length > 0 || talk.length > 0) && (
        <View style={[styles.talkContainer, Platform.OS === "web" && styles.talkContainerWeb]}>
          <Text style={styles.talkText}>{isStreaming ? streamedTalk : talk}</Text>
        </View>
      )}

      {/* TEACH scroll */}
      <ScrollView
        style={[styles.teachScroll, Platform.OS === "web" && styles.teachScrollWeb]}
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

      {/* Center voice button (voice mode only) */}
      <Animated.View
        pointerEvents={entryMode === "voice" ? "auto" : "none"}
        style={[
          styles.centerMicWrap,
          {
            opacity: centerOpacity,
            transform: [{ scale: centerScale }],
          },
        ]}
      >
        <Pressable
          style={[
            styles.centerMicButton,
            // Expand when showing text labels (Loading/Ending/END)
            (loading || isStreaming || isTranscribing || recorderState.isRecording) && styles.centerMicButtonWide,
          ]}
          onPress={onPrimaryPress}
        >
          {renderPrimaryButtonContent("center")}
        </Pressable>
      </Animated.View>

      {/* Bottom bar: Tt | Input+Send | Help */}
      <View style={[styles.bottomBar, Platform.OS === "web" && styles.bottomBarWeb]}>
        {/* Tt toggle LEFT */}
        <Pressable
          onPress={() => (entryMode === "text" ? goVoiceMode() : goTextMode())}
          style={styles.modeBtn}
        >
          <Text style={{ color: "#dcf9ff", fontWeight: "900" }}>Tt</Text>
        </Pressable>

        {/* Input bar CENTER (text mode only) */}
        <Animated.View
          style={{
            flex: 1,
            marginHorizontal: 12,
            transform: [{ translateX: inputTx }],
            opacity: inputOpacity,
          }}
          pointerEvents={entryMode === "text" ? "auto" : "none"}
        >
          <View style={styles.textBar}>
            <TextInput
              style={[styles.input, Platform.OS === "web" && styles.inputWeb]}
              placeholder="Ask Anything"
              placeholderTextColor={"#8e8e8e"}
              value={input}
              onChangeText={setInput}
              multiline
            />

            {/* Send button inside the input bar */}
            <Pressable
              style={[
                styles.inlineSendButton,
                (loading || isStreaming || isTranscribing || recorderState.isRecording) && styles.inlineSendButtonWide,
              ]}
              onPress={onPrimaryPress}
            >
              {renderPrimaryButtonContent("inline")}
            </Pressable>
          </View>
        </Animated.View>

        {/* Help bar RIGHT */}
        <View style={styles.helpBarWrap}>
          <View style={styles.segment}>
            <Pressable
              onPress={() => setHintMode("off")}
              style={[styles.segmentBtn, hintMode === "off" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, hintMode === "off" && styles.segmentTextActive]}>
                Off
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHintMode("hint")}
              style={[styles.segmentBtn, styles.segmentMiddle, hintMode === "hint" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, hintMode === "hint" && styles.segmentTextActive]}>
                Hint
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setHintMode("tutor")}
              style={[styles.segmentBtn, hintMode === "tutor" && styles.segmentBtnActive]}
            >
              <Text style={[styles.segmentText, hintMode === "tutor" && styles.segmentTextActive]}>
                Tutor
              </Text>
            </Pressable>
          </View>
        </View>
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

  talkContainer: { marginTop: 48, marginBottom: 10, alignItems: "center" },
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
    alignItems: "center",
  },
  talkText: {
    fontSize: 20,
    fontWeight: "500",
    textAlign: "center",
    maxWidth: "90%",
  },

  teachScroll: { flex: 1, width: "100%" },
  teachScrollWeb: {
    top: 50,
    marginTop: 33,
    marginBottom: 80,
  },
  teachContent: { paddingHorizontal: 20 },
  messageBlock: { marginBottom: 16 },

  userText: {
    fontSize: 15,
    color: "#111",
    alignSelf: "flex-end",
    maxWidth: "70%",
    padding: 15,
    borderRadius: 12,
    backgroundColor: "#6198ba3c",
  },
  teachText: { fontSize: 15, color: "#444", textAlign: "left" },

  // Center mic
  centerMicWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "58%",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 50,
  },
  centerMicButton: {
    width: Platform.OS === "web" ? 100 : 80,
    height: Platform.OS === "web" ? 100 : 80,
    borderRadius: Platform.OS === "web" ? 70 : 60,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  centerMicButtonWide: {
    width: 170,
    borderRadius: 40,
    paddingHorizontal: 14,
  },

  // Bottom bar layout
  bottomBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 6,
  },
  bottomBarWeb: {
    position: "fixed",
    left: 20,
    right: 20,
    bottom: 12,
  },

  modeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },

  // Text bar
  textBar: {
    position: "relative",
    justifyContent: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#8e8e8e",
    borderRadius: 40,
    paddingVertical: 14,
    paddingLeft: 18,
    paddingRight: 78, // room for inline send
    fontSize: 16,
    minHeight: 48,
  },
  inputWeb: {
    paddingVertical: 16,
  },
  inlineSendButton: {
    position: "absolute",
    right: 8,
    top: 6,
    bottom: 6,
    width: 44,
    borderRadius: 24,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  inlineSendButtonWide: {
    width: 96,
    borderRadius: 40,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },

  // Help bar (right)
  helpBarWrap: {
    width: Platform.OS === "web" ? 120 : 140,
  },
  segment: {
    flexDirection: Platform.OS === "web" ? "column" : "row",
    borderWidth: 1,
    borderColor: "#8e8e8e",
    borderRadius: 12,
    overflow: "hidden",
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentMiddle: Platform.OS === "web"
    ? { borderTopWidth: 1, borderBottomWidth: 1 }
    : { borderLeftWidth: 1, borderRightWidth: 1 },
  segmentBtnActive: { backgroundColor: "#000" },
  segmentText: { fontSize: 12, fontWeight: "600", color: "#000" },
  segmentTextActive: { color: "#dcf9ff" },
});
