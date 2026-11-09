// Speech-to-text for browsers whose built-in recognition doesn't work
// (Firefox, Brave, in-app browsers…). Served at /api/transcribe.
//
// POST { audio: <base64 WAV>, lang: "ml-IN" }  ->  { text }

import { callGemini, createRateLimiter, friendlyError, json, languageName, visitorKey } from '../lib/common.mjs';

export const config = { path: '/api/transcribe' };

const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest'];
const MAX_AUDIO_BASE64 = 4_500_000; // about 2 minutes of 16 kHz mono WAV
const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 25 });

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: 'Voice input needs a Gemini key on the server.' });
  if (isRateLimited(visitorKey(req, context))) {
    return json(429, { error: "You're talking to Aura very quickly. Wait a minute and try again." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const audio = typeof body?.audio === 'string' ? body.audio : '';
  if (!audio) return json(400, { error: 'No audio was received.' });
  if (audio.length > MAX_AUDIO_BASE64) return json(413, { error: 'That recording is too long. Keep it under a minute.' });

  const language = languageName(body?.lang);
  const instructions = [
    'Transcribe the speech in this recording exactly as spoken.',
    language
      ? `The speaker most likely speaks ${language}; write it in that language's own script.`
      : "Detect the language being spoken and write it in that language's own script (for example Malayalam in Malayalam script, Hindi in Devanagari, English in Latin letters).",
    'Return only the transcript, with normal punctuation. Do not translate, summarise or answer it.',
    'If there is no clear speech, return nothing.',
  ]
    .filter(Boolean)
    .join(' ');

  let worst = 0;
  for (const model of MODELS) {
    const result = await callGemini({
      model,
      apiKey,
      timeoutMs: 20000,
      body: {
        contents: [{ role: 'user', parts: [{ text: instructions }, { inlineData: { mimeType: 'audio/wav', data: audio } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 1024 },
      },
    });

    if (result.ok) {
      const text = (result.data?.candidates?.[0]?.content?.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim();
      return json(200, { text, model });
    }
    console.error('Transcription failed', model, result.status, JSON.stringify(result.data?.error || '').slice(0, 300));
    worst = worst === 429 || worst === 402 ? worst : result.status;
  }

  return json(502, { error: friendlyError(worst, 'voice recognition') });
};
