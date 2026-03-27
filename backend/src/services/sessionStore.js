class SessionStore {
  constructor(maxHistoryMessages) {
    this.maxHistoryMessages = maxHistoryMessages;
    this.sessions = new Map();
  }

  getHistory(sessionId) {
    return this.sessions.get(sessionId) || [];
  }

  appendMessage(sessionId, role, content) {
    const current = this.getHistory(sessionId);
    const next = [...current, { role, content }].slice(-this.maxHistoryMessages);
    this.sessions.set(sessionId, next);
    return next;
  }

  setHistory(sessionId, history) {
    this.sessions.set(sessionId, history.slice(-this.maxHistoryMessages));
  }
}

export default SessionStore;
