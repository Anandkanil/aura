import { Loader2, Mic, Square, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendChat } from "./api/chatClient";
import { useSpeechToText } from "./hooks/useSpeechToText";
import { useTextToSpeech } from "./hooks/useTextToSpeech";
import { AgentAudioVisualizerAura } from "./components/agent-audio-visualizer-aura";

const App = () => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState("idle");
  const [activeView, setActiveView] = useState("assistant");
  const [userText, setUserText] = useState("");
  const [assistantReply, setAssistantReply] = useState("");
  const [apiError, setApiError] = useState("");
  const [textFallback, setTextFallback] = useState("");
  const [toasts, setToasts] = useState([]);

  const isSendingRef = useRef(false);
  const requestAbortRef = useRef(null);
  const splashTimeoutRef = useRef(null);
  const toastIdRef = useRef(0);
  const toastTimeoutsRef = useRef(new Map());
  const lastToastMessageRef = useRef({ speech: "", api: "", tts: "" });

  const {
    isSupported,
    isListening,
    transcript,
    interimTranscript,
    fullTranscript,
    error: speechError,
    startListening,
    stopListening,
    resetTranscript,
    stopListeningAndGetTranscript
  } = useSpeechToText({ lang: "en-US", continuous: true, interimResults: true });

  const {
    isSupported: isTtsSupported,
    isSpeaking,
    error: ttsError,
    speak,
    cancel
  } = useTextToSpeech();

  useEffect(() => {
    const timer = setInterval(() => {
      setLoadProgress((previous) => {
        if (previous >= 100) {
          clearInterval(timer);
          splashTimeoutRef.current = setTimeout(() => {
            setIsLoaded(true);
          }, 500);
          return 100;
        }

        const increment = Math.random() * 15;
        return Math.min(previous + increment, 100);
      });
    }, 150);

    return () => {
      clearInterval(timer);
      if (splashTimeoutRef.current) {
        clearTimeout(splashTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;

    const updateCursorGlow = (event) => {
      root.style.setProperty("--cursor-x", `${event.clientX}px`);
      root.style.setProperty("--cursor-y", `${event.clientY}px`);
    };

    const showCursorGlow = () => {
      root.style.setProperty("--cursor-opacity", "1");
    };

    const hideCursorGlow = () => {
      root.style.setProperty("--cursor-opacity", "0");
    };

    window.addEventListener("pointermove", updateCursorGlow, { passive: true });
    window.addEventListener("pointerenter", showCursorGlow);
    window.addEventListener("pointerleave", hideCursorGlow);

    return () => {
      window.removeEventListener("pointermove", updateCursorGlow);
      window.removeEventListener("pointerenter", showCursorGlow);
      window.removeEventListener("pointerleave", hideCursorGlow);
    };
  }, []);

  useEffect(() => {
    if (isListening && status === "idle") {
      setStatus("listening");
    }
  }, [isListening, status]);

  useEffect(() => {
    return () => {
      toastTimeoutsRef.current.forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      toastTimeoutsRef.current.clear();
    };
  }, []);

  const dismissToast = useCallback((toastId) => {
    const timeoutId = toastTimeoutsRef.current.get(toastId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(toastId);
    }

    setToasts((previous) => previous.filter((toast) => toast.id !== toastId));
  }, []);

  const showToast = useCallback((title, message) => {
    toastIdRef.current += 1;
    const id = toastIdRef.current;

    setToasts((previous) => {
      const next = [...previous, { id, title, message }];
      return next.slice(-3);
    });

    const timeoutId = setTimeout(() => {
      dismissToast(id);
    }, 5000);

    toastTimeoutsRef.current.set(id, timeoutId);
  }, [dismissToast]);

  const canSubmitText = useMemo(() => {
    return (fullTranscript.trim().length > 0 || textFallback.trim().length > 0) && !isSendingRef.current;
  }, [fullTranscript, textFallback]);

  const transcriptWords = useMemo(() => {
    const source = transcript.trim() || userText.trim();
    return source ? source.split(/\s+/) : [];
  }, [transcript, userText]);

  const interimWords = useMemo(() => {
    const source = interimTranscript.trim();
    return source ? source.split(/\s+/) : [];
  }, [interimTranscript]);

  const stopEverything = () => {
    if (requestAbortRef.current) {
      requestAbortRef.current.abort();
      requestAbortRef.current = null;
    }

    stopListening();
    cancel();
    setApiError("");
    setStatus("idle");
  };

  const sendTurn = async (messageText) => {
    const message = messageText.trim();
    if (!message || isSendingRef.current) {
      if (!message) {
        setStatus("idle");
      }
      return;
    }

    setUserText(message);
    isSendingRef.current = true;
    setStatus("thinking");
    setApiError("");

    const abortController = new AbortController();
    requestAbortRef.current = abortController;

    try {
      const data = await sendChat({
        sessionId: sessionId || undefined,
        message,
        signal: abortController.signal
      });

      setSessionId(data.sessionId);
      setAssistantReply(data.reply);

      if (isTtsSupported) {
        setStatus("speaking");
        const completed = await speak({ text: data.reply, lang: "en-US", rate: 1, pitch: 1.04 });
        if (!completed) {
          setStatus("idle");
          setTextFallback("");
          return;
        }
      }

      if (speechError !== "network" && isSupported) {
        resetTranscript();
        startListening();
        setStatus("listening");
      } else {
        setStatus("idle");
      }

      setTextFallback("");
    } catch (error) {
      if (error.name === "AbortError") {
        setStatus("idle");
        return;
      }

      setStatus("error");
      setApiError(error.message || "Failed to contact backend");
    } finally {
      if (requestAbortRef.current === abortController) {
        requestAbortRef.current = null;
      }
      isSendingRef.current = false;
    }
  };

  const handleSendTranscript = async () => {
    const spokenText = await stopListeningAndGetTranscript();
    await sendTurn(spokenText);
  };

  const handleManualSend = async () => {
    const typedText = textFallback.trim();

    if (typedText) {
      await stopListeningAndGetTranscript();
      await sendTurn(typedText);
      return;
    }

    await handleSendTranscript();
  };

  const toggleConversation = async () => {
    if (status === "idle" || status === "error") {
      resetTranscript();
      setApiError("");
      setStatus("listening");
      startListening();
      return;
    }

    if (status === "listening") {
      await handleSendTranscript();
      return;
    }

    if (status === "thinking" || status === "speaking") {
      stopEverything();
      return;
    }

    stopEverything();
  };

  const showStopState = status === "listening" || status === "thinking" || status === "speaking";
  const mainButtonLabel = status === "listening" ? "Stop and Send" : "Stop Aura";

  const friendlySpeechError = useMemo(() => {
    if (!speechError) {
      return "";
    }

    const lowered = speechError.toLowerCase();

    if (lowered.includes("not-allowed") || lowered.includes("service-not-allowed")) {
      return "Microphone access is blocked. Please allow microphone permission and try again.";
    }

    if (lowered.includes("audio-capture")) {
      return "I cannot hear your microphone right now. Check your audio device and browser permissions.";
    }

    if (lowered.includes("network")) {
      return "Voice recognition lost network connection. Check your internet and try again.";
    }

    if (lowered.includes("5 seconds")) {
      return "I didn’t catch anything. Tap to try again.";
    }

    return "Voice input ran into an issue. Please try again or use the manual prompt.";
  }, [speechError]);

  const friendlyApiError = useMemo(() => {
    if (!apiError) {
      return "";
    }

    const lowered = apiError.toLowerCase();

    if (lowered.includes("rate limit") || lowered.includes("429")) {
      return "Aura is receiving too many requests right now. Please wait a few seconds and try again.";
    }

    if (lowered.includes("model is loading") || lowered.includes("503")) {
      return "Aura is warming up the model. Please retry in a moment.";
    }

    if (lowered.includes("authentication") || lowered.includes("api key") || lowered.includes("401") || lowered.includes("403")) {
      return "Aura could not authenticate with the AI service. Please check backend API key settings.";
    }

    if (lowered.includes("failed to contact backend") || lowered.includes("fetch") || lowered.includes("network")) {
      return "Cannot reach the Aura backend right now. Make sure the backend server is running.";
    }

    return "Something went wrong while getting Aura's response. Please try again.";
  }, [apiError]);

  const friendlyTtsError = useMemo(() => {
    if (!ttsError) {
      return "";
    }

    const lowered = ttsError.toLowerCase();

    if (lowered.includes("not-allowed") || lowered.includes("not supported")) {
      return "Voice playback is unavailable in this browser. Aura can still reply in text.";
    }

    return "Aura could not read the response out loud. You can still continue with text and voice input.";
  }, [ttsError]);

  useEffect(() => {
    if (!friendlySpeechError || lastToastMessageRef.current.speech === friendlySpeechError) {
      return;
    }

    lastToastMessageRef.current.speech = friendlySpeechError;
    showToast("Voice Input", friendlySpeechError);
  }, [friendlySpeechError, showToast]);

  useEffect(() => {
    if (!friendlyApiError || lastToastMessageRef.current.api === friendlyApiError) {
      return;
    }

    lastToastMessageRef.current.api = friendlyApiError;
    showToast("Assistant Reply", friendlyApiError);
  }, [friendlyApiError, showToast]);

  useEffect(() => {
    if (!friendlyTtsError || lastToastMessageRef.current.tts === friendlyTtsError) {
      return;
    }

    lastToastMessageRef.current.tts = friendlyTtsError;
    showToast("Voice Output", friendlyTtsError);
  }, [friendlyTtsError, showToast]);

  const audioVisualizerState = useMemo(() => {
    if (status === "speaking") {
      return "speaking";
    }

    if (status === "thinking") {
      return "thinking";
    }

    if (status === "listening") {
      return "listening";
    }

    if (status === "error") {
      return "connecting";
    }

    return "initializing";
  }, [status]);

  if (!isLoaded) {
    return (
      <div className="splash-screen" role="status" aria-live="polite" aria-label="Loading Aura">
        <div className="splash-brand-wrap">
          <div className="splash-glow" aria-hidden="true" />
          <div className="splash-brand">
            <div className="splash-icon">
              <Mic size={20} />
            </div>
            <span className="splash-title">Aura AI</span>
          </div>
        </div>

        <div className="splash-progress-track" aria-hidden="true">
          <div className="splash-progress-fill" style={{ width: `${loadProgress}%` }} />
        </div>

        <div className="splash-caption">Initializing Engine v2.5</div>
      </div>
    );
  }

  return (
    <main className="aura-root">
      <div className="grid-overlay" aria-hidden="true" />

      <header className="top-nav">
        <div className="engine-badge">
          <span className="pulse-dot" />
          Aura Agent
        </div>
        <div className="top-links">
          <button
            type="button"
            className={`top-link-button ${activeView === "assistant" ? "active" : ""}`}
            onClick={() => setActiveView("assistant")}
          >
            Aura Home
          </button>
          <button
            type="button"
            className={`top-link-button ${activeView === "docs" ? "active" : ""}`}
            onClick={() => setActiveView("docs")}
          >
            Read Docs
          </button>
          <a href="#">GitHub</a>
        </div>
      </header>

      {activeView === "assistant" ? (
      <section className="hero-zone">
        <h1>
          Aura
          <br />
        </h1>

        <div className="conversation-box">
          {status === "listening" && <p className="listening-indicator">&quot;Listening...&quot;</p>}
          {(transcriptWords.length > 0 || interimWords.length > 0) && (
            <div className="transcript-stack">
              <p className="user-line transcript-animated">
                <span>You:</span>{" "}
                {transcriptWords.map((word, index) => (
                  <span key={`final-word-${index}`} className="transcript-word" style={{ animationDelay: `${index * 22}ms` }}>
                    {word}
                  </span>
                ))}
                {interimWords.length > 0 && (
                  <span className="interim-chunk">
                    {interimWords.map((word, index) => (
                      <span key={`interim-word-${index}`} className="transcript-word interim-word" style={{ animationDelay: `${index * 32}ms` }}>
                        {word}
                      </span>
                    ))}
                  </span>
                )}
              </p>
              <p className="transcript-caption">{isListening ? "Live transcription" : "Captured transcript"}</p>
            </div>
          )}
          {assistantReply && <p className="assistant-line">{assistantReply}</p>}
          {status === "thinking" && <Loader2 className="thinking-spinner" size={30} />}
          {!userText && !assistantReply && status === "idle" && <p className="placeholder">Say hi to Aura whenever you are ready.</p>}
        </div>

        <section className="visualizer" aria-hidden="true">
          <AgentAudioVisualizerAura
            size="lg"
            state={audioVisualizerState}
            color="#42f5e6"
            colorShift={0.1}
            themeMode="dark"
          />
        </section>

        <div className="action-row">
          <button className={`main-button ${showStopState ? "listening" : ""}`} onClick={toggleConversation} disabled={!isSupported && status === "idle"}>
            {showStopState ? (
              <>
                <Square size={14} fill="currentColor" /> {mainButtonLabel}
              </>
            ) : (
              <>
                <Mic size={14} /> Talk with Aura
              </>
            )}
            <span className="divider" />
            <Terminal size={14} />
          </button>
        </div>

        <div className="fallback-box">
          <label htmlFor="fallback-input">Manual Prompt</label>
          <textarea
            id="fallback-input"
            value={textFallback}
            onChange={(event) => setTextFallback(event.target.value)}
            placeholder="If voice input is unstable, type to Aura here in your own words."
            rows={3}
          />
          <button className="send-button" onClick={handleManualSend} disabled={!canSubmitText}>
            Send
          </button>
        </div>

      </section>
      ) : (
      <section className="docs-zone">
        <h1>Read Aura Docs</h1>
        <p className="docs-subtitle">Everything you need to use Aura smoothly.</p>

        <div className="docs-grid">
          <article className="docs-card">
            <h2>Quick Start</h2>
            <p>Press <strong>Talk with Aura</strong> and start speaking naturally. Aura captures your voice and sends your turn automatically.</p>
            <p>When Aura replies, it reads the response out loud and returns to listening mode.</p>
          </article>

          <article className="docs-card">
            <h2>Controls</h2>
            <p><strong>Talk with Aura:</strong> Start listening.</p>
            <p><strong>Stop and Send:</strong> Stops recording and sends transcript immediately.</p>
            <p><strong>Manual Prompt:</strong> Type and send text when voice input is unstable.</p>
          </article>

          <article className="docs-card">
            <h2>Status Meanings</h2>
            <p><strong>Listening:</strong> Aura is capturing your voice.</p>
            <p><strong>Thinking:</strong> Aura is generating a response.</p>
            <p><strong>Speaking:</strong> Aura is reading the response aloud.</p>
            <p><strong>Error:</strong> A request or voice step failed.</p>
          </article>

          <article className="docs-card">
            <h2>Troubleshooting</h2>
            <p>Allow microphone permissions in your browser.</p>
            <p>Make sure the backend server is running before sending prompts.</p>
            <p>If voice playback is unavailable, continue via text in Manual Prompt.</p>
          </article>
        </div>
      </section>
      )}

      <section className="toast-stack" aria-live="polite" aria-atomic="true">
        {toasts.map((toast) => (
          <article key={toast.id} className="toast-card" role="status">
            <div className="toast-head">
              <strong>{toast.title}</strong>
              <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification">
                Close
              </button>
            </div>
            <p>{toast.message}</p>
          </article>
        ))}
      </section>

      <footer className="status-footer">
        <div>Status: {status}</div>
        <div>Session: {sessionId || "new session"}</div>
        <div>{isSpeaking ? "Speaking" : "Silent"}</div>
      </footer>
    </main>
  );
};

export default App;
