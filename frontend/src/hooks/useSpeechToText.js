import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const SILENCE_TIMEOUT_MS = 3000;
const RESTART_DELAY_MS = 140;
const STOP_RESOLVE_DEBOUNCE_MS = 180;
const RESTART_WINDOW_MS = 10000;
const MAX_RESTARTS_IN_WINDOW = 12;

const getSpeechRecognition = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

const normalizeText = (text) => text.trim().replace(/\s+/g, " ");

const mergeTranscript = (existingText, incomingText) => {
  const existing = normalizeText(existingText || "");
  const incoming = normalizeText(incomingText || "");

  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  const existingWords = existing.split(" ");
  const incomingWords = incoming.split(" ");
  const maxOverlap = Math.min(8, existingWords.length, incomingWords.length);

  let overlap = 0;
  for (let size = maxOverlap; size > 0; size -= 1) {
    const existingSuffix = existingWords.slice(existingWords.length - size).join(" ").toLowerCase();
    const incomingPrefix = incomingWords.slice(0, size).join(" ").toLowerCase();

    if (existingSuffix === incomingPrefix) {
      overlap = size;
      break;
    }
  }

  if (overlap === incomingWords.length) {
    return existing;
  }

  return [...existingWords, ...incomingWords.slice(overlap)].join(" ");
};

const cleanTranscript = (text) => {
  const normalized = normalizeText(text || "");
  if (!normalized) {
    return "";
  }

  const words = normalized.split(" ");
  const deduplicated = [];
  let lastWord = "";
  let repeatCount = 0;

  for (const word of words) {
    if (word.toLowerCase() === lastWord.toLowerCase()) {
      repeatCount += 1;
      if (repeatCount > 2) {
        continue;
      }
    } else {
      lastWord = word;
      repeatCount = 0;
    }

    deduplicated.push(word);
  }

  return deduplicated.join(" ");
};

/**
 * Detect if user is on a mobile device
 * @returns {boolean} true if on mobile device
 */
const detectMobileDevice = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/.test(userAgent);
  const isTouchDevice = () => {
    return (
      (typeof window !== "undefined" &&
        ("ontouchstart" in window ||
          (window.DocumentTouch &&
            typeof window.DocumentTouch === "function"))) ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0
    );
  };

  return isMobileUA || isTouchDevice();
};

export const useSpeechToText = ({ lang = "en-US", continuous = true, interimResults = true } = {}) => {
  const recognitionRef = useRef(null);
  const isListeningRef = useRef(false);
  const shouldKeepListeningRef = useRef(false);
  const isStartingRef = useRef(false);
  const manualStopRef = useRef(false);
  const restartTimerRef = useRef(null);
  const resolveTimerRef = useRef(null);
  const lastSpeechTimeRef = useRef(0);
  const restartWindowStartRef = useRef(0);
  const restartAttemptsRef = useRef(0);
  const pendingStopResolverRef = useRef(null);
  const transcriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const isMobileRef = useRef(detectMobileDevice());

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  const clearRestartTimer = useCallback(() => {
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
  }, []);

  const clearResolveTimer = useCallback(() => {
    if (resolveTimerRef.current) {
      clearTimeout(resolveTimerRef.current);
      resolveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  const finalText = useMemo(() => {
    return transcript;
  }, [transcript]);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    // Mobile browsers are more stable with non-continuous sessions that we manually restart.
    recognition.continuous = isMobileRef.current ? false : continuous;
    // Final-only transcript handling keeps backend input clean and predictable.
    recognition.interimResults = false;

    recognition.onstart = () => {
      console.log("[speech] recognition started");
      isStartingRef.current = false;
      isListeningRef.current = true;
      setIsListening(true);
      setError("");

      if (!lastSpeechTimeRef.current) {
        lastSpeechTimeRef.current = Date.now();
      }
    };

    recognition.onresult = (event) => {
      let nextTranscript = transcriptRef.current;
      let hasFinalResult = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (!event.results[i].isFinal) {
          continue;
        }

        const chunk = normalizeText(event.results[i][0].transcript || "");
        if (!chunk) {
          continue;
        }

        hasFinalResult = true;
        nextTranscript = mergeTranscript(nextTranscript, chunk);
        lastSpeechTimeRef.current = Date.now();
      }

      if (hasFinalResult) {
        const clean = cleanTranscript(nextTranscript);
        transcriptRef.current = clean;
        setTranscript(clean);
        setInterimTranscript("");
        interimTranscriptRef.current = "";
        console.log("[speech] final segment captured");
      }
    };

    recognition.onerror = (event) => {
      console.log("[speech] recognition error", event.error);

      let friendlyError = event.error || "Speech recognition error";

      // Provide mobile-specific error messages
      if (isMobileRef.current) {
        if (event.error === "network") {
          friendlyError = "Network error. Check your internet connection.";
        } else if (event.error === "audio-capture") {
          friendlyError = "Cannot access microphone. Check device permissions.";
        } else if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          friendlyError = "Microphone permission denied.";
        } else if (event.error === "no-speech") {
          friendlyError = "No speech detected. Please try again.";
        }
      }

      setError(friendlyError);

      const fatalErrors = new Set([
        "not-allowed",
        "service-not-allowed",
        "network",
        "audio-capture",
        "aborted"
      ]);

      if (fatalErrors.has(event.error)) {
        shouldKeepListeningRef.current = false;
        isListeningRef.current = false;
        isStartingRef.current = false;
        clearRestartTimer();
        clearResolveTimer();
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      console.log("[speech] recognition ended");

      isStartingRef.current = false;
      isListeningRef.current = false;
      setIsListening(false);
      setInterimTranscript("");
      interimTranscriptRef.current = "";

      if (pendingStopResolverRef.current) {
        const resolveStop = pendingStopResolverRef.current;
        pendingStopResolverRef.current = null;

        clearResolveTimer();
        resolveTimerRef.current = setTimeout(() => {
          const clean = cleanTranscript(transcriptRef.current);
          console.log("[speech] manual stop resolved");
          resolveStop(clean);
        }, STOP_RESOLVE_DEBOUNCE_MS);
      }

      if (shouldKeepListeningRef.current) {
        const silenceMs = Date.now() - lastSpeechTimeRef.current;

        if (silenceMs > SILENCE_TIMEOUT_MS) {
          shouldKeepListeningRef.current = false;
          setError("No speech detected for more than 3 seconds. Listening stopped.");
          console.log("[speech] silence timeout reached, stopping");
          return;
        }

        const now = Date.now();
        if (!restartWindowStartRef.current || now - restartWindowStartRef.current > RESTART_WINDOW_MS) {
          restartWindowStartRef.current = now;
          restartAttemptsRef.current = 0;
        }

        restartAttemptsRef.current += 1;
        if (restartAttemptsRef.current > MAX_RESTARTS_IN_WINDOW) {
          shouldKeepListeningRef.current = false;
          setError("Speech recognition is unstable right now. Please tap to retry.");
          console.log("[speech] restart guard tripped, stopping");
          return;
        }

        clearRestartTimer();
        restartTimerRef.current = setTimeout(() => {
          if (
            !recognitionRef.current ||
            isStartingRef.current ||
            isListeningRef.current ||
            !shouldKeepListeningRef.current
          ) {
            return;
          }

          try {
            isStartingRef.current = true;
            console.log("[speech] restarting recognition after short pause");
            recognitionRef.current.start();
          } catch (restartError) {
            isStartingRef.current = false;
            setError(restartError.message || "Could not restart listening");
          }
        }, RESTART_DELAY_MS);
        return;
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldKeepListeningRef.current = false;
      isListeningRef.current = false;
      isStartingRef.current = false;
      manualStopRef.current = false;
      clearRestartTimer();
      clearResolveTimer();
      pendingStopResolverRef.current = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [lang, continuous, interimResults, clearRestartTimer, clearResolveTimer]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListeningRef.current || isStartingRef.current) {
      return;
    }

    try {
      console.log("[speech] manual start requested");
      clearRestartTimer();
      clearResolveTimer();
      shouldKeepListeningRef.current = true;
      manualStopRef.current = false;
      restartWindowStartRef.current = Date.now();
      restartAttemptsRef.current = 0;
      lastSpeechTimeRef.current = Date.now();
      isStartingRef.current = true;
      recognitionRef.current.start();
    } catch (startError) {
      shouldKeepListeningRef.current = false;
      isStartingRef.current = false;
      setError(startError.message || "Could not start listening");
    }
  }, [clearRestartTimer, clearResolveTimer]);

  const stopListening = useCallback(() => {
    console.log("[speech] manual stop requested");
    shouldKeepListeningRef.current = false;
    manualStopRef.current = true;
    clearRestartTimer();

    if (!recognitionRef.current) {
      isListeningRef.current = false;
      isStartingRef.current = false;
      setIsListening(false);
      return;
    }

    if (isListeningRef.current || isStartingRef.current) {
      recognitionRef.current.stop();
    } else {
      setIsListening(false);
    }
  }, [clearRestartTimer]);

  const stopListeningAndGetTranscript = useCallback(() => {
    return new Promise((resolve) => {
      const snapshot = cleanTranscript(transcriptRef.current);

      if (!recognitionRef.current || (!isListeningRef.current && !isStartingRef.current)) {
        shouldKeepListeningRef.current = false;
        manualStopRef.current = true;
        setIsListening(false);
        resolve(snapshot);
        return;
      }

      pendingStopResolverRef.current = resolve;
      stopListening();
    });
  }, [stopListening]);

  const toggleListening = useCallback(() => {
    if (isListeningRef.current) {
      stopListening();
    } else {
      startListening();
    }
  }, [startListening, stopListening]);

  const resetTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    transcriptRef.current = "";
    interimTranscriptRef.current = "";
    lastSpeechTimeRef.current = Date.now();
  }, []);

  const getTranscript = useCallback(() => {
    return cleanTranscript(transcriptRef.current);
  }, []);

  return {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    fullTranscript: finalText,
    error,
    startListening,
    stopListening,
    toggleListening,
    resetTranscript,
    getTranscript,
    stopListeningAndGetTranscript
  };
};
