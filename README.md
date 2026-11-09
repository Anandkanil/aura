# Aura

Aura is a voice assistant that runs in the browser. Tap the mic and talk, or type. Aura answers on screen and out loud, starting to speak as soon as the first sentence of its reply arrives.

**Live:** https://auraa-voice.netlify.app

![Aura](docs/images/aura-home.jpeg)

## Features

- Talk or type; your words appear live while you speak
- Hands-free mode: Aura sends your message when you pause, and listens again after it answers
- Streaming replies that are spoken sentence by sentence
- Tap the mic while Aura is speaking to cut in
- Saved chats (in this browser only), with a chat list, delete and download as text
- Settings: reply length, read aloud on/off, language (English US/UK/India, Hindi, Malayalam, Tamil, Spanish, French, German), voice, speaking speed
- Copy or replay any reply
- Keyboard shortcuts: `Space` talk/send, `Esc` stop, `/` focus the message box
- Works on phone, tablet and desktop. Typing works in every browser; voice input needs Chrome, Edge or Safari

## How it works

```
Browser                                   Netlify
──────────────────────────────            ─────────────────────────────────
Mic → Web Speech API (speech-to-text)
Chat history (localStorage)  ── POST ──▶  /api/chat  (frontend/netlify/functions/chat.mjs)
                                             • validates and trims the conversation
                                             • rate limits per visitor
                                             • calls Hugging Face, with model fallback
Speaker ← speechSynthesis    ◀─ stream ──    • streams the reply back (server-sent events)
```

The Hugging Face key stays on the server. There is no separate backend to host.

## Project structure

```text
frontend/
  netlify/functions/chat.mjs   # the AI endpoint
  src/
    App.jsx                    # main screen and conversation logic
    components/                # orb visualiser, sidebar, settings, help, markdown
    hooks/                     # speech-to-text, speech queue, saved state
    lib/                       # streaming client, text helpers
  public/favicon.svg
frontend/netlify.toml          # Netlify build settings
```

## Run it locally

Requires Node.js 18+.

```bash
npm install
cd frontend
npx netlify dev        # runs the site and the /api/chat function together
```

Create `frontend/.env` with your key for local testing (it's git-ignored):

```
HUGGINGFACE_API_KEY=hf_...
```

`npm run dev` starts the site alone (without the AI endpoint).

## Configuration

Set these in Netlify → Project configuration → Environment variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `HUGGINGFACE_API_KEY` | Yes (mark as secret) | Token with permission to call Inference Providers |
| `HUGGINGFACE_MODEL` | No | Model tried first. Defaults to `meta-llama/Llama-3.1-8B-Instruct`, then falls back to Gemma 3 12B, Qwen 2.5 72B and GPT-OSS 20B |
| `HUGGINGFACE_BASE_URL` | No | Defaults to `https://router.huggingface.co/v1/chat/completions` |

## Deploying

Pushing to `main` deploys to Netlify automatically.

## Privacy

Chats are stored only in the visitor's browser. Messages are sent to the AI model through Hugging Face to generate replies.
