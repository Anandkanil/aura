import { useState } from "react";
import { Volume2, X } from "lucide-react";
import { browserVoicesFor } from "../hooks/useSpeechQueue";

export const LANGUAGES = [
  { code: "auto", label: "Automatic — match the language I use" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-IN", label: "English (India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "ta-IN", label: "Tamil" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" }
];

function Toggle({ id, label, hint, checked, onChange }) {
  return (
    <div className="setting-row">
      <div>
        <label htmlFor={id} className="setting-label">{label}</label>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? "is-on" : ""}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function SettingsPanel({ open, onClose, settings, onChange, voices, onPreviewVoice, onClearAll, hasChats }) {
  const [confirmClear, setConfirmClear] = useState(false);
  const isAuto = settings.lang === "auto";
  const matchingVoices = isAuto ? [] : browserVoicesFor(voices, settings.lang);
  const languageLabel = LANGUAGES.find((language) => language.code === settings.lang)?.label || "this language";

  return (
    <>
      <div className={`scrim scrim-top ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`drawer ${open ? "is-open" : ""}`} aria-label="Settings" aria-hidden={!open}>
        <div className="drawer-head">
          <h2>Settings</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <section className="setting-group">
          <h3>Replies</h3>
          <div className="segmented" role="radiogroup" aria-label="Reply length">
            {[
              ["short", "Short"],
              ["detailed", "Detailed"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={settings.style === value}
                className={settings.style === value ? "is-selected" : ""}
                onClick={() => onChange({ style: value })}
              >
                {label}
              </button>
            ))}
          </div>
          <Toggle
            id="speak-replies"
            label="Read replies aloud"
            checked={settings.speakReplies !== false}
            onChange={(value) => onChange({ speakReplies: value })}
          />
        </section>

        <section className="setting-group">
          <h3>Talking</h3>
          <Toggle
            id="hands-free"
            label="Send when I pause"
            hint="Aura sends your words after a short pause, so you don't need to tap."
            checked={settings.handsFree}
            onChange={(value) => onChange({ handsFree: value })}
          />
          <Toggle
            id="auto-listen"
            label="Keep the conversation going"
            hint="After Aura answers a spoken message, the mic turns back on."
            checked={settings.autoListen}
            onChange={(value) => onChange({ autoListen: value })}
          />
          <div>
            <p className="setting-label" id="voice-input-label">Voice recognition</p>
            <div className="segmented" role="radiogroup" aria-labelledby="voice-input-label">
              {[
                ["auto", "Automatic"],
                ["cloud", "Aura cloud"]
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={(settings.voiceInput || "auto") === value}
                  className={(settings.voiceInput || "auto") === value ? "is-selected" : ""}
                  onClick={() => onChange({ voiceInput: value })}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="setting-hint">
              {settings.lang === "auto"
                ? "With the language set to Automatic, Aura uses its cloud recognition so it can tell which language you're speaking."
                : "Automatic uses your browser's recognition and shows your words as you speak, switching to Aura cloud if it doesn't work. Aura cloud works in every browser and is more accurate for Indian languages."}
            </p>
          </div>
        </section>

        <section className="setting-group">
          <h3>Language and voice</h3>
          <label className="field">
            <span>Language</span>
            <select value={settings.lang} onChange={(e) => onChange({ lang: e.target.value, voiceURI: "" })}>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
          </label>
          <p className="setting-hint">
            {isAuto
              ? "Aura recognises the language you speak or type in, and replies in that language."
              : `Aura always replies in ${languageLabel}, whatever language you use.`}
          </p>
          <label className="field">
            <span>Aura's voice</span>
            <select value={settings.voiceURI} onChange={(e) => onChange({ voiceURI: e.target.value })}>
              <option value="">Automatic</option>
              <option value="cloud">Aura cloud voice (works for every language)</option>
              {matchingVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          {isAuto && settings.voiceURI !== "cloud" && (
            <p className="setting-hint">Aura picks a voice that matches each reply. Languages your browser can't speak use the cloud voice.</p>
          )}
          {!isAuto && matchingVoices.length === 0 && settings.voiceURI !== "cloud" && (
            <p className="setting-hint">This browser has no {languageLabel} voice, so Aura uses its cloud voice.</p>
          )}
          <label className="field">
            <span>Speaking speed: {Number(settings.rate).toFixed(1)}×</span>
            <input
              type="range"
              min="0.7"
              max="1.5"
              step="0.1"
              value={settings.rate}
              onChange={(e) => onChange({ rate: Number(e.target.value) })}
            />
          </label>
          <button type="button" className="ghost-button" onClick={onPreviewVoice}>
            <Volume2 size={15} />
            Play a sample
          </button>
        </section>

        <section className="setting-group">
          <h3>Your chats</h3>
          <p className="setting-hint">Chats are saved only in this browser. Your messages are sent to an AI model to write Aura's replies.</p>
          {!confirmClear ? (
            <button type="button" className="ghost-button danger" disabled={!hasChats} onClick={() => setConfirmClear(true)}>
              Delete all chats
            </button>
          ) : (
            <div className="confirm-row">
              <span>Delete every chat in this browser?</span>
              <button
                type="button"
                className="ghost-button danger"
                onClick={() => {
                  onClearAll();
                  setConfirmClear(false);
                }}
              >
                Delete all
              </button>
              <button type="button" className="ghost-button" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
            </div>
          )}
        </section>
      </aside>
    </>
  );
}
