import { Plus, Trash2, X } from "lucide-react";

const timeLabel = (timestamp) => {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(timestamp).toLocaleDateString();
};

export function Sidebar({ conversations, activeId, open, onClose, onSelect, onNew, onDelete }) {
  return (
    <>
      <div className={`scrim ${open ? "is-open" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`sidebar ${open ? "is-open" : ""}`} aria-label="Chats">
        <div className="sidebar-head">
          <span className="wordmark" aria-hidden="true">aura</span>
          <button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close chats">
            <X size={18} />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={onNew}>
          <Plus size={16} />
          New chat
        </button>

        <nav className="chat-list">
          {conversations.length === 0 && <p className="chat-list-empty">Your chats will appear here. They're saved only in this browser.</p>}
          {conversations.map((conversation) => (
            <div key={conversation.id} className={`chat-item ${conversation.id === activeId ? "is-active" : ""}`}>
              <button
                type="button"
                className="chat-item-main"
                onClick={() => onSelect(conversation.id)}
                aria-current={conversation.id === activeId ? "true" : undefined}
              >
                <span className="chat-item-title">{conversation.title}</span>
                <span className="chat-item-time">{timeLabel(conversation.updatedAt)}</span>
              </button>
              <button
                type="button"
                className="icon-button chat-item-delete"
                onClick={() => onDelete(conversation.id)}
                aria-label={`Delete chat: ${conversation.title}`}
                title="Delete chat"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
