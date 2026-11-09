import { useCallback, useEffect, useRef, useState } from "react";
import { toSpeakable } from "../lib/text";

const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

const normalizeLang = (value) => String(value || "").replace("_", "-");
const isNatural = (voice) => /natural|neural|google|premium|enhanced|online/i.test(voice.name);

// Does this browser have a voice for the language?
export const browserVoicesFor = (voices, lang) => {
  const base = normalizeLang(lang).split("-")[0];
  return voices.filter((voice) => normalizeLang(voice.lang).split("-")[0] === base);
};

// Speaks Aura's replies. Uses the browser's own voices, sentence by sentence,
// so Aura starts talking while the reply is still arriving. When the browser
// has no voice for the chosen language (or the cloud voice is chosen), the
// whole reply is spoken by Aura's server voice instead.
export const useSpeechQueue = ({ voiceURI = "", rate = 1, lang = "en-US" } = {}) => {
  const [voices, setVoices] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");

  const queueRef = useRef([]);
  const playingRef = useRef(false);
  const finishedRef = useRef(true);
  const waitersRef = useRef([]);
  const generationRef = useRef(0);
  const cloudTextRef = useRef("");
  const cloudRef = useRef({ abort: null, audio: null, url: "" });
  const settingsRef = useRef({ voiceURI, rate, lang });
  settingsRef.current = { voiceURI, rate, lang };

  useEffect(() => {
    if (!synth) return undefined;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => {
      synth.removeEventListener?.("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  const usesCloud = useCallback(() => {
    const { voiceURI: wanted, lang: wantedLang } = settingsRef.current;
    if (wanted === "cloud" || !synth) return true;
    return browserVoicesFor(synth.getVoices(), wantedLang).length === 0;
  }, []);

  const pickVoice = useCallback(() => {
    const { voiceURI: wanted, lang: wantedLang } = settingsRef.current;
    const all = synth?.getVoices() || [];
    if (wanted && wanted !== "cloud") {
      const exact = all.find((voice) => voice.voiceURI === wanted);
      if (exact) return exact;
    }
    const matching = browserVoicesFor(all, wantedLang);
    const exactLang = matching.filter((voice) => normalizeLang(voice.lang) === wantedLang);
    return exactLang.find(isNatural) || exactLang[0] || matching.find(isNatural) || matching[0] || null;
  }, []);

  const settleWaiters = useCallback((completed) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve(completed));
  }, []);

  const clearCloudAudio = useCallback(() => {
    const cloud = cloudRef.current;
    cloud.abort?.abort();
    if (cloud.audio) {
      cloud.audio.onended = null;
      cloud.audio.onerror = null;
      cloud.audio.pause();
    }
    if (cloud.url) URL.revokeObjectURL(cloud.url);
    cloudRef.current = { abort: null, audio: null, url: "" };
  }, []);

  const playCloud = useCallback(
    async (text) => {
      const generation = generationRef.current;
      const abort = new AbortController();
      cloudRef.current.abort = abort;
      setIsSpeaking(true);
      try {
        const response = await fetch("/api/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang: settingsRef.current.lang }),
          signal: abort.signal
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Aura's voice isn't available right now.");
        }
        const blob = await response.blob();
        if (generation !== generationRef.current) return;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.playbackRate = settingsRef.current.rate;
        cloudRef.current = { abort: null, audio, url };
        await new Promise((resolve) => {
          audio.onended = resolve;
          audio.onerror = () => {
            setError("Aura couldn't play its voice in this browser.");
            resolve();
          };
          audio.play().catch(() => {
            setError("Your browser blocked Aura's voice. Tap the speaker icon on a reply to hear it.");
            resolve();
          });
        });
      } catch (err) {
        if (err.name !== "AbortError") setError(err.message);
      }
      if (generation !== generationRef.current) return;
      clearCloudAudio();
      setIsSpeaking(false);
      settleWaiters(true);
    },
    [clearCloudAudio, settleWaiters]
  );

  const playNext = useCallback(() => {
    if (!synth) return;
    const next = queueRef.current.shift();
    if (!next) {
      playingRef.current = false;
      if (finishedRef.current) {
        setIsSpeaking(false);
        settleWaiters(true);
      }
      return;
    }

    const generation = generationRef.current;
    const utterance = new SpeechSynthesisUtterance(next);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || settingsRef.current.lang;
    utterance.rate = settingsRef.current.rate;
    utterance.onend = () => {
      if (generation === generationRef.current) playNext();
    };
    utterance.onerror = (event) => {
      if (generation !== generationRef.current) return;
      if (event.error !== "interrupted" && event.error !== "canceled") {
        setError("Aura couldn't read the reply aloud in this browser. You can still read it on screen.");
      }
      playNext();
    };
    playingRef.current = true;
    setIsSpeaking(true);
    synth.speak(utterance);
  }, [pickVoice, settleWaiters]);

  // Start a new spoken reply (stops anything already speaking).
  const begin = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    cloudTextRef.current = "";
    finishedRef.current = false;
    playingRef.current = false;
    synth?.cancel();
    clearCloudAudio();
    setError("");
  }, [clearCloudAudio]);

  const enqueue = useCallback(
    (text) => {
      const speakable = toSpeakable(text);
      if (!speakable) return;
      if (usesCloud()) {
        cloudTextRef.current = `${cloudTextRef.current} ${speakable}`.trim();
        return;
      }
      queueRef.current.push(speakable);
      if (!playingRef.current) playNext();
    },
    [playNext, usesCloud]
  );

  // Mark the reply as complete. Resolves true once everything has been spoken,
  // or false if speech was stopped first.
  const finish = useCallback(() => {
    finishedRef.current = true;
    const promise = new Promise((resolve) => waitersRef.current.push(resolve));
    if (cloudTextRef.current) {
      const text = cloudTextRef.current;
      cloudTextRef.current = "";
      void playCloud(text);
    } else if (!playingRef.current && queueRef.current.length === 0) {
      setIsSpeaking(false);
      settleWaiters(true);
    }
    return promise;
  }, [playCloud, settleWaiters]);

  const speakAll = useCallback(
    (text) => {
      begin();
      enqueue(text);
      return finish();
    },
    [begin, enqueue, finish]
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    queueRef.current = [];
    cloudTextRef.current = "";
    finishedRef.current = true;
    playingRef.current = false;
    synth?.cancel();
    clearCloudAudio();
    setIsSpeaking(false);
    settleWaiters(false);
  }, [clearCloudAudio, settleWaiters]);

  return { isSupported: true, voices, isSpeaking, error, begin, enqueue, finish, speakAll, stop };
};
