import { useEffect, useRef, useState } from "react";

const read = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};

const readArray = (key) => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// State that's remembered in this browser. Saving is debounced so streaming
// replies don't write to storage on every word.
const usePersist = (key, value) => {
  const timer = useRef(null);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage full or blocked (private mode): keep working in memory.
      }
    }, 300);
    return () => window.clearTimeout(timer.current);
  }, [key, value]);
};

export const DEFAULT_SETTINGS = {
  lang: "en-US",
  voiceURI: "",
  rate: 1,
  style: "short",
  handsFree: true,
  autoListen: true
};

export const useSettings = () => {
  const [settings, setSettings] = useState(() => read("aura-settings", DEFAULT_SETTINGS));
  usePersist("aura-settings", settings);
  const update = (patch) => setSettings((current) => ({ ...current, ...patch }));
  return [settings, update];
};

const MAX_CONVERSATIONS = 50;

export const useConversations = () => {
  const [conversations, setConversations] = useState(() => readArray("aura-conversations"));
  usePersist("aura-conversations", conversations.slice(0, MAX_CONVERSATIONS));
  return [conversations, setConversations];
};
