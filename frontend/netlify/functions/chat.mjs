// Aura chat endpoint (Netlify Function, served at /api/chat).
//
// The browser sends the conversation so far; this function adds Aura's
// instructions, asks a Hugging Face model for a reply and streams it back as
// server-sent events:  data: {"text":"..."}  ...  data: {"done":true}
//
// Environment variables (Netlify -> Project configuration -> Environment):
//   HUGGINGFACE_API_KEY  required, secret
//   HUGGINGFACE_MODEL    optional, tried first
//   HUGGINGFACE_BASE_URL optional, defaults to the Hugging Face router

export const config = { path: '/api/chat' };

const DEFAULT_BASE_URL = 'https://router.huggingface.co/v1/chat/completions';
// Fast, widely available instruct models, tried in order.
const FALLBACK_MODELS = [
  'meta-llama/Llama-3.1-8B-Instruct',
  'google/gemma-3-12b-it',
  'Qwen/Qwen2.5-72B-Instruct',
  'openai/gpt-oss-20b',
];

const MAX_MESSAGES = 30;
const MAX_MESSAGE_CHARS = 4000;
const MAX_TOTAL_CHARS = 24000;
const FIRST_BYTE_TIMEOUT_MS = 15000;
const RATE_LIMIT = { windowMs: 60_000, max: 20 };

const STYLE_PROMPTS = {
  short: 'Keep replies short: one to three sentences unless the person asks for more.',
  detailed: 'Give complete, well-organised answers, but stay conversational.',
};

const basePrompt = (style) =>
  [
    'You are Aura, a warm and helpful voice assistant.',
    'Your replies are read aloud, so write the way a friendly person talks: natural sentences, contractions, no emoji, no tables, no code blocks unless asked, and only use a short list when it truly helps.',
    "Reply in the same language as the person's latest message.",
    STYLE_PROMPTS[style] || STYLE_PROMPTS.short,
  ].join(' ');

// Best-effort limit per visitor. Each function instance keeps its own counts,
// which is enough to stop casual abuse of the API key.
const hits = new Map();
const isRateLimited = (key) => {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT.max;
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const validateMessages = (messages) => {
  if (!Array.isArray(messages) || messages.length === 0) return 'Send at least one message.';
  if (messages.length > MAX_MESSAGES * 2) return 'This conversation is too long. Start a new chat.';
  let total = 0;
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return 'Messages must have a role of user or assistant and text content.';
    }
    if (m.content.length > MAX_MESSAGE_CHARS) return `Messages can be up to ${MAX_MESSAGE_CHARS} characters.`;
    total += m.content.length;
  }
  if (messages[messages.length - 1].role !== 'user') return 'The last message must be from the user.';
  if (total > MAX_TOTAL_CHARS * 4) return 'This conversation is too long. Start a new chat.';
  return null;
};

// Keep the most recent turns that fit the budget.
const trimHistory = (messages) => {
  const kept = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && kept.length < MAX_MESSAGES; i -= 1) {
    const content = messages[i].content.trim();
    if (!content) continue;
    if (total + content.length > MAX_TOTAL_CHARS && kept.length > 0) break;
    total += content.length;
    kept.unshift({ role: messages[i].role, content });
  }
  // Models expect the conversation to start with the user.
  while (kept.length && kept[0].role !== 'user') kept.shift();
  return kept;
};

// Is this upstream failure worth trying the next model for?
const shouldTryNextModel = (status) => [400, 404, 408, 409, 422, 429, 500, 502, 503, 504].includes(status);

const friendlyUpstreamError = (status) => {
  if (status === 401 || status === 403) {
    return 'Aura could not sign in to the AI service. The Hugging Face key needs to be checked.';
  }
  if (status === 402) {
    return "Aura's AI credits have run out for this month. The Hugging Face account needs more credits or a paid plan.";
  }
  if (status === 429) return 'Aura is getting a lot of requests right now. Try again in a minute.';
  return `The AI service is not responding right now (error ${status || 'timeout'}). Try again in a minute.`;
};

const encoder = new TextEncoder();
const sse = (payload) => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);

// Turn the provider's OpenAI-style stream into Aura's simple stream.
const relayStream = (upstream, model) =>
  new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              const text = parsed?.choices?.[0]?.delta?.content;
              if (typeof text === 'string' && text) controller.enqueue(sse({ text }));
            } catch {
              // Ignore keep-alive or partial lines.
            }
          }
        }
        controller.enqueue(sse({ done: true, model }));
      } catch (err) {
        console.error('Stream relay failed', err);
        controller.enqueue(sse({ error: 'The reply was cut off. Try again.' }));
      } finally {
        controller.close();
      }
    },
  });

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) return json(500, { error: 'Aura is not set up yet: the Hugging Face key is missing on the server.' });

  const visitor = context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  if (isRateLimited(visitor)) {
    return json(429, { error: "You're sending messages very quickly. Wait a minute and try again." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const problem = validateMessages(body?.messages);
  if (problem) return json(400, { error: problem });

  const style = body?.style === 'detailed' ? 'detailed' : 'short';
  const messages = [{ role: 'system', content: basePrompt(style) }, ...trimHistory(body.messages)];
  const maxTokens = style === 'detailed' ? 700 : 300;

  const baseUrl = process.env.HUGGINGFACE_BASE_URL || DEFAULT_BASE_URL;
  const models = [...new Set([process.env.HUGGINGFACE_MODEL, ...FALLBACK_MODELS].filter(Boolean))];
  let lastStatus = 0;

  for (const model of models) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), FIRST_BYTE_TIMEOUT_MS);
    try {
      const upstream = await fetch(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
        signal: abort.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok || !upstream.body) {
        lastStatus = upstream.status;
        const detail = await upstream.text().catch(() => '');
        console.error('Model failed', model, upstream.status, detail.slice(0, 300));
        if (shouldTryNextModel(upstream.status)) continue;
        return json(502, { error: friendlyUpstreamError(upstream.status) });
      }

      return new Response(relayStream(upstream, model), {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Aura-Model': model,
        },
      });
    } catch (err) {
      clearTimeout(timer);
      lastStatus = 504;
      console.error('Model request failed', model, err?.name, err?.message);
    }
  }

  return json(503, { error: friendlyUpstreamError(lastStatus) });
};
