import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function HelpDialog({ open, onClose, voiceSupported }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h2 id="help-title">How to use Aura</h2>
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close help">
            <X size={18} />
          </button>
        </div>

        <ol className="help-steps">
          <li>Tap the microphone and talk as you normally would.</li>
          <li>Pause when you're done. Aura sends your words and answers out loud.</li>
          <li>Tap the microphone while Aura is speaking to cut in.</li>
        </ol>
        <p className="help-note">You can always type instead. Your words and Aura's replies appear in the chat.</p>

        {!voiceSupported && (
          <p className="help-warning">
            Voice input isn't available in this browser. Typing works everywhere; for talking, use Chrome, Edge or Safari.
          </p>
        )}

        <h3>Shortcuts</h3>
        <dl className="shortcuts">
          <div><dt><kbd>Space</kbd></dt><dd>Start or send when you're not typing</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Stop listening, thinking or speaking</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Jump to the message box</dd></div>
          <div><dt><kbd>Enter</kbd></dt><dd>Send a typed message (Shift + Enter for a new line)</dd></div>
        </dl>

        <h3>Privacy</h3>
        <p className="help-note">
          Chats stay in this browser until you delete them. To answer, Aura sends your messages to an AI model hosted by Hugging Face.
        </p>
      </div>
    </div>
  );
}
