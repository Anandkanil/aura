import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Check, CircleHelp, Copy, Download, Menu, Mic, Settings2, Square, Volume2, X } from "lucide-react";
import { AgentAudioVisualizerAura } from "./components/agent-audio-visualizer-aura";
import { Markdown } from "./components/Markdown";
import { Sidebar } from "./components/Sidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { HelpDialog } from "./components/HelpDialog";
import { useSpeechToText } from "./hooks/useSpeechToText";
import { useSpeechQueue } from "./hooks/useSpeechQueue";
import { useConversations, useSettings } from "./hooks/useStoredState";
import { streamChat } from "./lib/chatStream";
import { createSentenceSplitter, makeTitle, newId } from "./lib/text";

const PAUSE_TO_SEND_MS = 1300;
const isTouch = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

const STATUS = {
  idle: { label: "Ready", tone: "idle" },
  listening: { label: "Listening", tone: "listen" },
  thinking: { label: "Thinking", tone: "think" },
  replying: { label: "Replying", tone: "speak" },
  speaking: { label: "Speaking", tone: "speak" }
};

// Orb colour follows what Aura is doing.
const ORB = {
  idle: { state: "idle", color: "#8F86FF", shift: 0.3 },
  listening: { state: "listening", color: "#5EF2D6", shift: 0.15 },
  thinking: { state: "thinking", color: "#9B7BFF", shift: 0.25 },
  replying: { state: "speaking", color: "#7FD8FF", shift: 0.45 },
  speaking: { state: "speaking", color: "#7FD8FF", shift: 0.45 }
};

const SUGGESTIONS = [
  "Help me plan a calm, productive morning",
  "Explain how solar panels work, simply",
  "Give me three dinner ideas with paneer",
  "Quiz me on world capitals"
];

const speechErrorMessage = (code) => {
  if (!code || code === "aborted") return null;
  if (code === "not-allowed" || code === "service-not-allowed") {
    return { tone: "error", text: "Microphone access is blocked. Allow the microphone for this site in your browser, then tap the mic again." };
  }
  if (code === "audio-capture") return { tone: "error", text: "No microphone was found. Check that one is connected and allowed." };
  if (code === "network") return { tone: "error", text: "Voice recognition needs an internet connection. Check your connection, or type instead." };
  if (code === "silence-timeout" || code === "no-speech") {
    return { tone: "info", text: "I didn't hear anything, so I stopped listening. Tap the mic when you're ready." };
  }
  if (code === "unstable") return { tone: "error", text: "Voice recognition keeps stopping in this browser. Try typing instead." };
  return { tone: "error", text: "Voice input stopped unexpectedly. Tap the mic to try again, or type instead." };
};

export default function App() {
  const [settings, updateSettings] = useSettings();
  const [conversations, setConversations] = useConversations();
  const [activeId, setActiveId] = useState(() => conversations[0]?.id || null);
  const [status, setStatus] = useState("idle");
  const [streamingText, setStreamingText] = useState("");
  const [draft, setDraft] = useState("");
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [failedTurn, setFailedTurn] = useState(null);

  const statusRef = useRef(status);
  statusRef.current = status;
  const abortRef = useRef(null);
  const pauseTimerRef = useRef(null);
  const sendingRef = useRef(false);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const stt = useSpeechToText({ lang: settings.lang, continuous: true, interimResults: true });
  const tts = useSpeechQueue({ voiceURI: settings.voiceURI, rate: settings.rate, lang: settings.lang });
  const speakReplies = settings.speakReplies !== false && tts.isSupported;

  const active = conversations.find((c) => c.id === activeId) || null;
  const messages = active?.messages || [];
  const isEmpty = messages.length === 0 && !streamingText && status !== "thinking";

  // ---------- Toasts ----------
  const notify = useCallback((text, tone = "error") => {
    const id = newId();
    setToasts((current) => [...current.filter((t) => t.text !== text), { id, text, tone }].slice(-3));
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), tone === "error" ? 7000 : 4500);
  }, []);

  // ---------- Conversations ----------
  const updateConversation = useCallback(
    (id, update) => {
      setConversations((current) =>
        current
          .map((c) => (c.id === id ? { ...update(c), updatedAt: Date.now() } : c))
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
    },
    [setConversations]
  );

  const stopAll = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    window.clearTimeout(pauseTimerRef.current);
    stt.stopListening();
    stt.resetTranscript();
    tts.stop();
    setStatus("idle");
  }, [stt, tts]);

  const startNewChat = () => {
    stopAll();
    setActiveId(null);
    setStreamingText("");
    setFailedTurn(null);
    setSidebarOpen(false);
    inputRef.current?.focus();
  };

  const selectChat = (id) => {
    stopAll();
    setActiveId(id);
    setStreamingText("");
    setFailedTurn(null);
    setSidebarOpen(false);
  };

  const deleteChat = (id) => {
    if (id === activeId) {
      stopAll();
      setActiveId(null);
    }
    setConversations((current) => current.filter((c) => c.id !== id));
  };

  // ---------- Talking to the model ----------
  const sendMessage = useCallback(
    async (rawText, { viaVoice = false, retry = false } = {}) => {
      const text = String(rawText || "").replace(/\s+/g, " ").trim();
      if (!text || sendingRef.current) return;
      sendingRef.current = true;

      window.clearTimeout(pauseTimerRef.current);
      stt.stopListening();
      stt.resetTranscript();
      tts.stop();
      setFailedTurn(null);

      // Find or create the conversation, and add the user's message.
      let conversationId = activeId;
      let history = active?.messages || [];
      if (!conversationId) {
        conversationId = newId();
        const now = Date.now();
        setConversations((current) => [{ id: conversationId, title: makeTitle(text), createdAt: now, updatedAt: now, messages: [] }, ...current]);
        setActiveId(conversationId);
        history = [];
      }
      if (!retry) {
        const userMessage = { id: newId(), role: "user", content: text };
        history = [...history, userMessage];
        updateConversation(conversationId, (c) => ({ ...c, messages: [...c.messages, userMessage] }));
      }

      setStatus("thinking");
      setStreamingText("");
      const controller = new AbortController();
      abortRef.current = controller;
      const splitter = createSentenceSplitter();
      if (speakReplies) tts.begin();

      try {
        const reply = await streamChat({
          messages: history.map(({ role, content }) => ({ role, content })),
          style: settings.style,
          signal: controller.signal,
          onText: (chunk, full) => {
            if (statusRef.current === "thinking") setStatus("replying");
            setStreamingText(full);
            if (speakReplies) splitter.push(chunk).forEach(tts.enqueue);
          }
        });

        const finalText = reply || "I'm not sure what to say to that. Could you put it another way?";
        updateConversation(conversationId, (c) => ({
          ...c,
          messages: [...c.messages, { id: newId(), role: "assistant", content: finalText }]
        }));
        setStreamingText("");
        abortRef.current = null;
        sendingRef.current = false;

        let finishedSpeaking = true;
        if (statusRef.current === "thinking") setStatus("replying");
        if (speakReplies) {
          if (!reply) tts.enqueue(finalText);
          splitter.flush().forEach(tts.enqueue);
          setStatus("speaking");
          finishedSpeaking = await tts.finish();
        }
        // Stopped, or the person started talking again, while Aura was speaking.
        if (statusRef.current === "idle" || statusRef.current === "listening") return;

        if (finishedSpeaking && viaVoice && settings.autoListen && stt.isSupported) {
          stt.resetTranscript();
          stt.startListening();
          setStatus("listening");
        } else {
          setStatus("idle");
        }
      } catch (error) {
        abortRef.current = null;
        sendingRef.current = false;
        setStreamingText("");
        tts.stop();
        if (error.name === "AbortError") {
          setStatus((current) => (current === "listening" ? current : "idle"));
          return;
        }
        setStatus("idle");
        setFailedTurn({ conversationId, viaVoice });
        notify(error.message || "Aura couldn't answer. Try again.");
      }
    },
    [active, activeId, notify, setConversations, settings.autoListen, settings.style, speakReplies, stt, tts, updateConversation]
  );

  const sendFromMic = useCallback(async () => {
    window.clearTimeout(pauseTimerRef.current);
    const heard = await stt.stopListeningAndGetTranscript();
    const text = heard || stt.interimTranscript;
    if (text.trim()) await sendMessage(text, { viaVoice: true });
    else setStatus("idle");
  }, [sendMessage, stt]);

  const startListening = useCallback(() => {
    if (!stt.isSupported) {
      notify("Voice input isn't available in this browser. Type to Aura, or use Chrome, Edge or Safari to talk.", "info");
      inputRef.current?.focus();
      return;
    }
    abortRef.current?.abort();
    tts.stop();
    stt.resetTranscript();
    stt.startListening();
    setStatus("listening");
  }, [notify, stt, tts]);

  // The one big button: start, send, or cut in.
  const onMicPress = () => {
    if (status === "listening") {
      void sendFromMic();
      return;
    }
    startListening();
  };

  const retryLast = () => {
    if (!active) return;
    const lastUser = [...active.messages].reverse().find((m) => m.role === "user");
    if (lastUser) void sendMessage(lastUser.content, { viaVoice: Boolean(failedTurn?.viaVoice), retry: true });
  };

  // ---------- Voice side effects ----------
  // Hands-free: send after a short pause in speech.
  useEffect(() => {
    if (status !== "listening" || !settings.handsFree) return undefined;
    if (!stt.transcript.trim()) return undefined;
    window.clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = window.setTimeout(() => {
      if (statusRef.current === "listening") void sendFromMic();
    }, PAUSE_TO_SEND_MS);
    return () => window.clearTimeout(pauseTimerRef.current);
  }, [stt.transcript, stt.interimTranscript, status, settings.handsFree, sendFromMic]);

  // If the browser stops listening on its own, go back to ready.
  useEffect(() => {
    if (!stt.isListening && status === "listening" && !sendingRef.current) {
      const timer = window.setTimeout(() => {
        if (statusRef.current === "listening" && !sendingRef.current) {
          if (stt.transcript.trim() && settings.handsFree) void sendFromMic();
          else setStatus("idle");
        }
      }, 400);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [stt.isListening, stt.transcript, status, settings.handsFree, sendFromMic]);

  useEffect(() => {
    const message = speechErrorMessage(stt.error);
    if (message) notify(message.text, message.tone);
  }, [stt.error, notify]);

  useEffect(() => {
    if (tts.error && tts.error !== "interrupted" && tts.error !== "canceled") {
      notify("Aura couldn't read the reply aloud in this browser. You can still read it on screen.", "info");
    }
  }, [tts.error, notify]);

  // ---------- Keyboard ----------
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (event.key === "Escape") {
        if (helpOpen) setHelpOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else if (sidebarOpen) setSidebarOpen(false);
        else stopAll();
        return;
      }
      if (typing || helpOpen || settingsOpen) return;
      if (event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
      } else if (event.code === "Space" && !(target instanceof HTMLButtonElement) && !event.repeat) {
        event.preventDefault();
        onMicPress();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Keep the latest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText, status]);

  // ---------- Message actions ----------
  const copyMessage = async (message) => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      notify("Couldn't copy. Select the text and copy it instead.", "info");
    }
  };

  const replayMessage = (message) => {
    stt.stopListening();
    setStatus("speaking");
    void tts.speakAll(message.content).then(() => {
      if (statusRef.current === "speaking") setStatus("idle");
    });
  };

  const downloadChat = () => {
    if (!active) return;
    const lines = active.messages.map((m) => `${m.role === "user" ? "You" : "Aura"}: ${m.content}`);
    const blob = new Blob([`${active.title}\n${new Date(active.createdAt).toLocaleString()}\n\n${lines.join("\n\n")}\n`], {
      type: "text/plain"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura-chat-${new Date(active.createdAt).toISOString().slice(0, 10)}.txt`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const submitDraft = (event) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    void sendMessage(text);
  };

  // ---------- View ----------
  const liveWords = `${stt.transcript} ${stt.interimTranscript}`.trim();
  const orb = ORB[status] || ORB.idle;
  const statusInfo = STATUS[status] || STATUS.idle;
  const micLabel =
    status === "listening"
      ? settings.handsFree
        ? "Listening. Pause to send, or tap to send now"
        : "Tap to send"
      : status === "speaking" || status === "replying"
        ? "Tap to cut in and talk"
        : "Tap to talk";

  const composerHint = useMemo(() => {
    if (status === "listening") return settings.handsFree ? "Listening — pause when you're done" : "Listening — tap the mic to send";
    if (status === "thinking") return "Thinking…";
    if (status === "replying" || status === "speaking") return "Tap the mic to cut in";
    if (!stt.isSupported) return "Type your message";
    return isTouch ? "Tap the mic to talk" : "Tap the mic or press Space to talk";
  }, [status, settings.handsFree, stt.isSupported]);

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onSelect={selectChat}
        onNew={startNewChat}
        onDelete={deleteChat}
      />

      <div className="stage">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open chats">
            <Menu size={20} />
          </button>
          <div className="topbar-title">
            <span className="wordmark topbar-wordmark" aria-hidden="true">aura</span>
            {active && <span className="topbar-chat">{active.title}</span>}
          </div>
          <div className={`status-pill tone-${statusInfo.tone}`} role="status" aria-live="polite">
            <span className="status-dot" />
            {statusInfo.label}
          </div>
          <div className="topbar-actions">
            {active && (
              <button type="button" className="icon-button" onClick={downloadChat} aria-label="Download this chat" title="Download this chat">
                <Download size={18} />
              </button>
            )}
            <button type="button" className="icon-button" onClick={() => setHelpOpen(true)} aria-label="Help" title="Help">
              <CircleHelp size={18} />
            </button>
            <button type="button" className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings" title="Settings">
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        <main className={`dialogue ${isEmpty ? "is-empty" : ""}`} ref={scrollRef}>
          <div className={`orb-wrap ${isEmpty ? "orb-hero" : "orb-docked"}`}>
            <AgentAudioVisualizerAura
              size="lg"
              state={orb.state}
              color={orb.color}
              colorShift={orb.shift}
              themeMode="dark"
              className="orb"
            />
          </div>

          {isEmpty && (
            <section className="welcome">
              {status === "listening" ? (
                <p className={`live-words ${liveWords ? "" : "is-waiting"}`}>{liveWords || "I'm listening…"}</p>
              ) : (
                <>
                  <h1>Hi, I'm Aura.</h1>
                  <p className="welcome-sub">
                    {stt.isSupported ? "Tap the mic and talk to me, or type below." : "Type a message below to start. Voice works in Chrome, Edge and Safari."}
                  </p>
                  <div className="suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button key={suggestion} type="button" className="suggestion" onClick={() => void sendMessage(suggestion)}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          {!isEmpty && (
            <ol className="messages" aria-label="Conversation">
              {messages.map((message) =>
                message.role === "user" ? (
                  <li key={message.id} className="msg msg-user">
                    <p>{message.content}</p>
                  </li>
                ) : (
                  <li key={message.id} className="msg msg-aura">
                    <Markdown text={message.content} />
                    <div className="msg-actions">
                      <button type="button" className="icon-button small" onClick={() => copyMessage(message)} aria-label="Copy reply" title="Copy">
                        {copiedId === message.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      {tts.isSupported && (
                        <button type="button" className="icon-button small" onClick={() => replayMessage(message)} aria-label="Read reply aloud" title="Read aloud">
                          <Volume2 size={14} />
                        </button>
                      )}
                    </div>
                  </li>
                )
              )}
              {status === "thinking" && (
                <li className="msg msg-aura is-thinking" aria-label="Aura is thinking">
                  <span className="thinking-dots"><i /><i /><i /></span>
                </li>
              )}
              {streamingText && (
                <li className="msg msg-aura is-streaming">
                  <Markdown text={streamingText} />
                </li>
              )}
              {status === "idle" && !streamingText && messages[messages.length - 1]?.role === "user" && (
                <li className="msg-retry">
                  <span>Aura didn't answer that one.</span>
                  <button type="button" className="ghost-button" onClick={retryLast}>
                    Try again
                  </button>
                </li>
              )}
            </ol>
          )}
        </main>

        <footer className="composer-wrap">
          {!isEmpty && status === "listening" && (
            <p className={`live-words docked ${liveWords ? "" : "is-waiting"}`} aria-live="polite">
              {liveWords || "I'm listening…"}
            </p>
          )}
          <form className="composer" onSubmit={submitDraft}>
            <button
              type="button"
              className={`mic tone-${statusInfo.tone} ${stt.isSupported ? "" : "is-unavailable"}`}
              onClick={onMicPress}
              aria-label={micLabel}
              title={micLabel}
            >
              {status === "listening" && !settings.handsFree ? <ArrowUp size={24} /> : <Mic size={24} />}
            </button>
            <label className="sr-only" htmlFor="composer-input">Message Aura</label>
            <textarea
              id="composer-input"
              ref={inputRef}
              value={draft}
              rows={1}
              placeholder="Message Aura"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) submitDraft(event);
              }}
            />
            {status === "thinking" || status === "replying" || status === "speaking" ? (
              <button type="button" className="send stop" onClick={stopAll} aria-label="Stop" title="Stop">
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send" disabled={!draft.trim()} aria-label="Send message" title="Send">
                <ArrowUp size={20} />
              </button>
            )}
          </form>
          <p className="composer-hint">{composerHint}</p>
        </footer>
      </div>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        voices={tts.voices}
        onPreviewVoice={() => void tts.speakAll("Hi, I'm Aura. This is how I'll sound.")}
        onClearAll={() => {
          stopAll();
          setConversations([]);
          setActiveId(null);
        }}
        hasChats={conversations.length > 0}
      />
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} voiceSupported={stt.isSupported} />

      <div className="toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast tone-${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
            <p>{toast.text}</p>
            <button
              type="button"
              className="icon-button small"
              onClick={() => setToasts((current) => current.filter((t) => t.id !== toast.id))}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
