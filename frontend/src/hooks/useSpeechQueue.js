import { useCallback, useEffect, useRef, useState } from "react";
import { toSpeakable } from "../lib/text";

const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

// Speaks text one sentence at a time, so Aura can start talking while the
// rest of the reply is still arriving.
export const useSpeechQueue = ({ voiceURI = "", rate = 1, lang = "en-US" } = {}) => {
  const [voices, setVoices] = useState([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");

  const queueRef = useRef([]);
  const playingRef = useRef(false);
  const finishedRef = useRef(true);
  const waitersRef = useRef([]);
  const generationRef = useRef(0);
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

  const pickVoice = useCallback(() => {
    const all = synth?.getVoices() || [];
    const { voiceURI: wanted, lang: wantedLang } = settingsRef.current;
    if (wanted) {
      const exact = all.find((v) => v.voiceURI === wanted);
      if (exact) return exact;
    }
    const base = wantedLang.split("-")[0];
    const sameLang = all.filter((v) => v.lang?.replace("_", "-").startsWith(base));
    // Prefer the more natural-sounding voices browsers ship.
    return (
      sameLang.find((v) => v.lang?.replace("_", "-") === wantedLang && /natural|neural|google|premium|enhanced/i.test(v.name)) ||
      sameLang.find((v) => v.lang?.replace("_", "-") === wantedLang) ||
      sameLang.find((v) => /natural|neural|google|premium|enhanced/i.test(v.name)) ||
      sameLang[0] ||
      null
    );
  }, []);

  const settleWaiters = useCallback((completed) => {
    const waiters = waitersRef.current;
    waitersRef.current = [];
    waiters.forEach((resolve) => resolve(completed));
  }, []);

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
    utterance.pitch = 1;
    utterance.onend = () => {
      if (generation === generationRef.current) playNext();
    };
    utterance.onerror = (event) => {
      if (generation !== generationRef.current) return;
      if (event.error !== "interrupted" && event.error !== "canceled") setError(event.error || "speech-failed");
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
    finishedRef.current = false;
    playingRef.current = false;
    synth?.cancel();
    setError("");
  }, []);

  const enqueue = useCallback(
    (text) => {
      const speakable = toSpeakable(text);
      if (!synth || !speakable) return;
      queueRef.current.push(speakable);
      if (!playingRef.current) playNext();
    },
    [playNext]
  );

  // Mark the reply as complete. Resolves true once everything has been spoken,
  // or false if speech was stopped first.
  const finish = useCallback(() => {
    finishedRef.current = true;
    if (!synth) return Promise.resolve(true);
    if (!playingRef.current && queueRef.current.length === 0) {
      setIsSpeaking(false);
      return Promise.resolve(true);
    }
    return new Promise((resolve) => waitersRef.current.push(resolve));
  }, []);

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
    finishedRef.current = true;
    playingRef.current = false;
    synth?.cancel();
    setIsSpeaking(false);
    settleWaiters(false);
  }, [settleWaiters]);

  return { isSupported: Boolean(synth), voices, isSpeaking, error, begin, enqueue, finish, speakAll, stop };
};
