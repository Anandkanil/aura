import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const getSpeechRecognition = () => {
  if (typeof window === "undefined") {
    return null;
  }

  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
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
  const restartTimerRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const timedOutBySilenceRef = useRef(false);
  const pendingStopResolverRef = useRef(null);
  const transcriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const finalSegmentsRef = useRef([]);
  const isMobileRef = useRef(detectMobileDevice());
  const lastFinalIndexRef = useRef(-1);
  const finalTextDebounceRef = useRef(null);

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const resetSilenceTimer = useCallback(() => {
    clearSilenceTimer();

    silenceTimerRef.current = setTimeout(() => {
      if (!recognitionRef.current || !isListeningRef.current) {
        return;
      }

      timedOutBySilenceRef.current = true;
      shouldKeepListeningRef.current = false;
      recognitionRef.current.stop();
    }, 5000);
  }, [clearSilenceTimer]);

  useEffect(() => {
    transcriptRef.current = transcript;
  }, [transcript]);

  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  const finalText = useMemo(() => {
    return `${transcript} ${interimTranscript}`.trim();
  }, [transcript, interimTranscript]);

  useEffect(() => {
    const SpeechRecognition = getSpeechRecognition();

    if (!SpeechRecognition) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    // On mobile: disable continuous mode for stability, reduce interim results
    recognition.continuous = isMobileRef.current ? false : continuous;
    recognition.interimResults = isMobileRef.current ? false : interimResults;

    recognition.onstart = () => {
      timedOutBySilenceRef.current = false;
      isStartingRef.current = false;
      isListeningRef.current = true;
      setIsListening(true);
      setError("");
      resetSilenceTimer();
      lastFinalIndexRef.current = -1;
    };

    recognition.onresult = (event) => {
      resetSilenceTimer();

      let interimChunk = "";
      let hasNewFinalText = false;

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const chunk = event.results[i][0].transcript.trim();

        if (!chunk) continue;

        if (event.results[i].isFinal) {
          // Only process final results we haven't seen before
          if (i > lastFinalIndexRef.current) {
            finalSegmentsRef.current[i] = chunk;
            lastFinalIndexRef.current = i;
            hasNewFinalText = true;
          }
        } else {
          // On mobile, skip interim results
          if (!isMobileRef.current) {
            interimChunk = `${interimChunk} ${chunk}`.trim();
          }
        }
      }

      // Rebuild final text from stored segments (avoids duplicates)
      const finalText = finalSegmentsRef.current
        .filter(Boolean)
        .join(" ")
        .trim();
      
      setTranscript(finalText);

      // Only update interim if not on mobile
      if (!isMobileRef.current) {
        setInterimTranscript(interimChunk);
      }
    };

    recognition.onerror = (event) => {
      clearSilenceTimer();
      
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
        if (restartTimerRef.current) {
          clearTimeout(restartTimerRef.current);
          restartTimerRef.current = null;
        }
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      clearSilenceTimer();
      isStartingRef.current = false;
      setInterimTranscript("");

      if (timedOutBySilenceRef.current) {
        setError("No speech detected for 5 seconds. Listening stopped.");
        timedOutBySilenceRef.current = false;
      }

      if (pendingStopResolverRef.current) {
        const resolveStop = pendingStopResolverRef.current;
        pendingStopResolverRef.current = null;
        // Return clean, trimmed transcript
        const cleanTranscript = `${transcriptRef.current} ${interimTranscriptRef.current}`
          .trim()
          .replace(/\s+/g, " ");
        resolveStop(cleanTranscript);
      }

      if (shouldKeepListeningRef.current) {
        setIsListening(true);
        restartTimerRef.current = setTimeout(() => {
          if (!recognitionRef.current || isStartingRef.current || isListeningRef.current) {
            return;
          }

          try {
            isStartingRef.current = true;
            recognitionRef.current.start();
          } catch (restartError) {
            isStartingRef.current = false;
            setError(restartError.message || "Could not restart listening");
          }
        }, 150);
        return;
      }

      isListeningRef.current = false;
      setIsListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      shouldKeepListeningRef.current = false;
      isListeningRef.current = false;
      isStartingRef.current = false;
      timedOutBySilenceRef.current = false;
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
      if (finalTextDebounceRef.current) {
        clearTimeout(finalTextDebounceRef.current);
        finalTextDebounceRef.current = null;
      }
      clearSilenceTimer();
      pendingStopResolverRef.current = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, [lang, continuous, interimResults, clearSilenceTimer, resetSilenceTimer]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || isListeningRef.current || isStartingRef.current) {
      return;
    }

    try {
      shouldKeepListeningRef.current = true;
      isStartingRef.current = true;
      recognitionRef.current.start();
    } catch (startError) {
      shouldKeepListeningRef.current = false;
      isStartingRef.current = false;
      setError(startError.message || "Could not start listening");
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    timedOutBySilenceRef.current = false;
    clearSilenceTimer();

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    if (!recognitionRef.current) {
      setIsListening(false);
      return;
    }

    if (isListeningRef.current || isStartingRef.current) {
      recognitionRef.current.stop();
    } else {
      setIsListening(false);
    }
  }, []);

  const stopListeningAndGetTranscript = useCallback(() => {
    return new Promise((resolve) => {
      const snapshot = `${transcriptRef.current} ${interimTranscriptRef.current}`.trim();

      if (!recognitionRef.current || (!isListeningRef.current && !isStartingRef.current)) {
        shouldKeepListeningRef.current = false;
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
    finalSegmentsRef.current = [];
    lastFinalIndexRef.current = -1;
  }, []);

  const getTranscript = useCallback(() => {
    return `${transcriptRef.current} ${interimTranscriptRef.current}`.trim();
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
