// Helpers shared by Aura's Netlify Functions.

export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

export const LANGUAGE_NAMES = {
  'en-US': 'English',
  'en-GB': 'English',
  'en-IN': 'English (Indian)',
  'hi-IN': 'Hindi',
  'ml-IN': 'Malayalam',
  'ta-IN': 'Tamil',
  'es-ES': 'Spanish',
  'fr-FR': 'French',
  'de-DE': 'German',
  // Detected automatically from reply text (used for voices).
  'kn-IN': 'Kannada',
  'te-IN': 'Telugu',
  'bn-IN': 'Bengali',
  'ar-SA': 'Arabic',
  'ja-JP': 'Japanese',
  'ko-KR': 'Korean',
  'zh-CN': 'Chinese',
  'ru-RU': 'Russian',
};

export const languageName = (code) => LANGUAGE_NAMES[code] || null;

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Best-effort limit per visitor. Each function instance keeps its own counts,
// which is enough to stop casual abuse of the API keys.
export const createRateLimiter = ({ windowMs, max }) => {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    return recent.length > max;
  };
};

export const visitorKey = (req, context) => context?.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';

// POST to Gemini's native API with a timeout. Returns { ok, status, data }.
export const callGemini = async ({ model, apiKey, body, timeoutMs = 20000 }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: err?.name === 'AbortError' ? 504 : 502, data: null };
  } finally {
    clearTimeout(timer);
  }
};

export const friendlyError = (status, what) => {
  if (status === 401 || status === 403) return `Aura couldn't use the ${what} service: the API key needs to be checked.`;
  if (status === 402) return `Aura's ${what} credits have run out.`;
  if (status === 429) return `Aura's ${what} is busy right now. Try again in a minute.`;
  return `Aura's ${what} isn't responding right now (error ${status || 'timeout'}). Try again in a minute.`;
};
