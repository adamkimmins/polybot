// hooks/duplexAudio.ts
import { Platform, NativeModules } from "react-native";
import InCallManager from "react-native-incall-manager";

function isLinked(): boolean {
  return !!NativeModules.InCallManager;
}

export function enableDuplexAudioRoute() {
  if (Platform.OS !== "ios") return;

  if (!isLinked()) {
    console.warn("[duplexAudio] InCallManager native module missing. Are you on Expo Go / old dev build?");
    return;
  }

  try {
    InCallManager.start({ media: "audio" });
    InCallManager.setForceSpeakerphoneOn(true);
  } catch (e) {
    console.warn("[duplexAudio] enable failed:", e);
  }
}

export function disableDuplexAudioRoute() {
  if (Platform.OS !== "ios") return;
  if (!isLinked()) return;

  try {
    InCallManager.setForceSpeakerphoneOn(false);
    InCallManager.stop();
  } catch (e) {
    console.warn("[duplexAudio] disable failed:", e);
  }
}
