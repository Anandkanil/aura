import { useState } from "react";
import { Volume2, X } from "lucide-react";

export const LANGUAGES = [
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
  const base = settings.lang.split("-")[0];
  const matchingVoices = voices.filter((voice) => voice.lang?.replace("_", "-").startsWith(base));

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
        </section>

        <section className="setting-group">
          <h3>Language and voice</h3>
          <label className="field">
            <span>Language you speak</span>
            <select value={settings.lang} onChange={(e) => onChange({ lang: e.target.value, voiceURI: "" })}>
              {LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Aura's voice</span>
            <select value={settings.voiceURI} onChange={(e) => onChange({ voiceURI: e.target.value })}>
              <option value="">Automatic</option>
              {matchingVoices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {voice.name}
                </option>
              ))}
            </select>
          </label>
          {matchingVoices.length === 0 && (
            <p className="setting-hint">This browser has no voices for this language, so Aura will use its default voice.</p>
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
