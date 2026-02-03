import React, { createContext, useContext, useMemo, useState } from "react";

export type LearnLang = "en" | "it";
export type VoiceId = "adam"; // add more later

export type AppSettings = {
  learnLang: LearnLang;
  voiceId: VoiceId;
};

const DEFAULT_SETTINGS: AppSettings = {
  learnLang: "it",
  voiceId: "adam"
};

const SettingsContext = createContext<{
  settings: AppSettings;
  setSettings: (next: AppSettings) => void;
} | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  const value = useMemo(() => ({ settings, setSettings }), [settings]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}
