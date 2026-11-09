// Works out which language a piece of text is in, so Aura can pick a voice
// that matches its reply when the language setting is "Automatic".

const SCRIPTS = [
  [/[ഀ-ൿ]/, "ml-IN"], // Malayalam
  [/[஀-௿]/, "ta-IN"], // Tamil
  [/[ಀ-೿]/, "kn-IN"], // Kannada
  [/[ఀ-౿]/, "te-IN"], // Telugu
  [/[ঀ-৿]/, "bn-IN"], // Bengali
  [/[ऀ-ॿ]/, "hi-IN"], // Devanagari (Hindi, Marathi…)
  [/[؀-ۿ]/, "ar-SA"], // Arabic script
  [/[぀-ヿ]/, "ja-JP"], // Japanese kana
  [/[가-힯]/, "ko-KR"], // Korean
  [/[一-鿿]/, "zh-CN"], // Chinese
  [/[Ѐ-ӿ]/, "ru-RU"] // Cyrillic
];

// Common short words that give away Latin-script languages.
const LATIN_HINTS = [
  ["es-ES", /[¿¡ñ]|\b(el|los|las|que|para|pero|está|muy|también|gracias)\b/gi],
  ["fr-FR", /[çœ]|\b(le|les|des|est|vous|nous|pas|avec|très|merci|c'est)\b/gi],
  ["de-DE", /[äöüß]|\b(der|die|das|und|ist|nicht|ich|mit|sehr|danke)\b/gi]
];

const englishDefault = () => {
  const preferred = typeof navigator !== "undefined" ? navigator.language : "";
  return /^en-/i.test(preferred) ? preferred : "en-US";
};

export const detectLanguage = (text) => {
  const sample = String(text || "").slice(0, 400);
  for (const [pattern, code] of SCRIPTS) {
    if (pattern.test(sample)) return code;
  }
  const words = sample.split(/\s+/).filter(Boolean).length || 1;
  let best = null;
  let bestScore = 0;
  for (const [code, pattern] of LATIN_HINTS) {
    const score = (sample.match(pattern) || []).length / words;
    if (score > bestScore) {
      best = code;
      bestScore = score;
    }
  }
  return bestScore >= 0.12 ? best : englishDefault();
};

// The language the browser's speech recognition should listen for.
export const recognitionLanguage = (setting) => (setting && setting !== "auto" ? setting : englishDefault());
