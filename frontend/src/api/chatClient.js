const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

export const sendChat = async ({ sessionId, message, signal }) => {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ sessionId, message })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    const retryHint = payload.retryAfterSeconds ? ` Retry in about ${payload.retryAfterSeconds}s.` : "";
    throw new Error((payload.error || "Chat request failed") + retryHint);
  }

  return response.json();
};
