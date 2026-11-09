// Text-to-speech for languages the visitor's browser has no voice for
// (for example Malayalam on most computers). Served at /api/speak.
//
// POST { text, lang }  ->  audio (MP3 from Google Cloud TTS, or WAV from Gemini)
//
// Providers, in order:
//   GOOGLE_TTS_API_KEY  optional: Google Cloud Text-to-Speech. Fast (<1 s),
//                       generous free tier, proper Indian-language voices.
//   GEMINI_API_KEY      Gemini speech models. Free tier is small and slower.

import { callGemini, createRateLimiter, friendlyError, json, languageName, visitorKey } from '../lib/common.mjs';

export const config = { path: '/api/speak' };

const MODELS = ['gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'];
const VOICE = 'Kore';
const MAX_CHARS = 1500;
const isRateLimited = createRateLimiter({ windowMs: 60_000, max: 20 });

// Gemini returns raw 16-bit mono PCM; add a WAV header so browsers can play it.
const pcmToWav = (pcm, sampleRate = 24000) => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

// Google Cloud Text-to-Speech: returns an MP3 Response, or { status } on failure.
const googleCloudTts = async ({ text, lang, apiKey }) => {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10000);
  try {
    const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: lang || 'en-US' },
        audioConfig: { audioEncoding: 'MP3' },
      }),
      signal: abort.signal,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.audioContent) {
      console.error('Google TTS failed', res.status, JSON.stringify(data?.error || '').slice(0, 300));
      return { status: res.status || 502 };
    }
    return {
      response: new Response(Buffer.from(data.audioContent, 'base64'), {
        headers: { 'Content-Type': 'audio/mpeg', 'X-Aura-Model': 'google-cloud-tts' },
      }),
    };
  } catch (err) {
    console.error('Google TTS request failed', err?.name);
    return { status: 504 };
  } finally {
    clearTimeout(timer);
  }
};

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const googleKey = process.env.GOOGLE_TTS_API_KEY;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !googleKey) return json(500, { error: 'Cloud voice needs a Gemini or Google Cloud key on the server.' });
  if (isRateLimited(visitorKey(req, context))) {
    return json(429, { error: "Aura's voice is busy. Wait a minute and try again." });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'Invalid request.' });
  }

  const text = String(body?.text || '').trim().slice(0, MAX_CHARS);
  if (!text) return json(400, { error: 'Nothing to say.' });
  const lang = /^[a-z]{2}-[A-Z]{2}$/.test(body?.lang || '') ? body.lang : 'en-US';
  const language = languageName(lang);

  let worst = 0;
  if (googleKey) {
    const result = await googleCloudTts({ text, lang, apiKey: googleKey });
    if (result.response) return result.response;
    worst = result.status;
  }
  if (!apiKey) return json(502, { error: friendlyError(worst, 'voice') });
  const prompt = `Read this aloud in a warm, natural, friendly voice${language ? `, in ${language}` : ''}:\n${text}`;

  for (const model of MODELS) {
    const result = await callGemini({
      model,
      apiKey,
      timeoutMs: 25000,
      body: {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
        },
      },
    });

    const part = result.data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (result.ok && part) {
      const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || '')?.[1]) || 24000;
      const wav = pcmToWav(Buffer.from(part.inlineData.data, 'base64'), rate);
      return new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'X-Aura-Model': model } });
    }
    console.error('Speech failed', model, result.status, JSON.stringify(result.data?.error || '').slice(0, 300));
    worst = worst === 429 || worst === 402 ? worst : result.status || 502;
  }

  if (worst === 429) {
    return json(429, {
      error: "Aura's free cloud voice limit has been reached for now, so this reply is text only. It resets daily.",
    });
  }
  return json(502, { error: friendlyError(worst, 'voice') });
};
