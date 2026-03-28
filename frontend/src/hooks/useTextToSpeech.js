import { useCallback, useEffect, useRef, useState } from "react";

const getSpeechSynthesis = () => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return null;
  }

  return window.speechSynthesis;
};

export const useTextToSpeech = () => {
  const synthRef = useRef(null);
  const activeUtteranceRef = useRef(null);
  const activeSettleRef = useRef(null);
  const isSpeakingRef = useRef(false);

  const [isSupported, setIsSupported] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const synth = getSpeechSynthesis();
    synthRef.current = synth;
    setIsSupported(Boolean(synth));

    return () => {
      if (synthRef.current) {
        synthRef.current.cancel();
      }
      isSpeakingRef.current = false;
    };
  }, []);

  const cancel = useCallback(() => {
    if (!synthRef.current) {
      return;
    }

    if (activeSettleRef.current) {
      activeSettleRef.current(false);
      activeSettleRef.current = null;
    }

    activeUtteranceRef.current = null;
    synthRef.current.cancel();
    isSpeakingRef.current = false;
    setIsSpeaking(false);
  }, []);

  const speak = useCallback(({ text, rate = 1, pitch = 1, lang = "en-US" }) => {
    if (!synthRef.current || !text?.trim()) {
      return Promise.resolve(false);
    }

    return new Promise((resolve, reject) => {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = rate;
        utterance.pitch = pitch;
        utterance.lang = lang;

        let settled = false;
        const settle = (ok, errorMessage = "") => {
          if (settled) {
            return;
          }

          settled = true;
          if (activeUtteranceRef.current === utterance) {
            activeUtteranceRef.current = null;
            activeSettleRef.current = null;
          }

          isSpeakingRef.current = false;
          setIsSpeaking(false);

          if (!ok && errorMessage) {
            setError(errorMessage);
            reject(new Error(errorMessage));
            return;
          }

          resolve(ok);
        };

        activeUtteranceRef.current = utterance;
        activeSettleRef.current = settle;

        utterance.onstart = () => {
          isSpeakingRef.current = true;
          setIsSpeaking(true);
          setError("");
        };

        utterance.onend = () => {
          settle(true);
        };

        utterance.onerror = (event) => {
          const nextError = event.error || "Speech synthesis failed";
          settle(false, nextError);
        };

        synthRef.current.cancel();
        synthRef.current.speak(utterance);
      } catch (speakError) {
        activeSettleRef.current = null;
        activeUtteranceRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        setError(speakError.message || "Speech synthesis failed");
        reject(speakError);
      }
    });
  }, []);

  return {
    isSupported,
    isSpeaking,
    isSpeakingRef,
    error,
    speak,
    cancel
  };
};
