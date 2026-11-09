// Text-to-speech for languages the visitor's browser has no voice for
// (for example Malayalam on most computers). Served at /api/speak.
//
// POST { text, lang }  ->  audio/wav

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

export default async (req, context) => {
  if (req.method !== 'POST') return json(405, { error: 'Use POST.' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json(500, { error: 'Cloud voice needs a Gemini key on the server.' });
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
  const language = languageName(body?.lang);
  const prompt = `Read this aloud in a warm, natural, friendly voice${language ? `, in ${language}` : ''}:\n${text}`;

  let worst = 0;
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

  return json(502, { error: friendlyError(worst, 'voice') });
};
