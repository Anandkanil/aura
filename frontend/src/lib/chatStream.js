// Sends the conversation to /api/chat and calls onText for each piece of the
// reply as it streams in. Resolves with the full reply text.
export async function streamChat({ messages, style, lang, signal, onText }) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, style, lang }),
    signal
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || "Aura couldn't reach the AI service. Check your connection and try again.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";
    for (const event of events) {
      const line = event.trim();
      if (!line.startsWith("data:")) continue;
      let data;
      try {
        data = JSON.parse(line.slice(5));
      } catch {
        continue;
      }
      if (data.error) throw new Error(data.error);
      if (data.text) {
        full += data.text;
        onText?.(data.text, full);
      }
    }
  }

  return full.trim();
}
