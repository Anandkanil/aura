// Text helpers shared by the voice engine and the message view.

// Remove markdown so replies sound natural when read aloud.
export const toSpeakable = (text) =>
  String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

// Splits streamed text into complete sentences. Call push() with each new
// piece; it returns the sentences that are now complete. flush() returns the
// rest at the end of the reply.
export const createSentenceSplitter = () => {
  let buffer = "";
  const boundary = /([.!?।]+["')\]]?)(\s+|$)|\n+/g;

  const take = (force) => {
    const out = [];
    let lastIndex = 0;
    boundary.lastIndex = 0;
    let match;
    while ((match = boundary.exec(buffer))) {
      const end = match.index + match[0].length;
      // At the very end of the buffer we can't be sure the sentence is over
      // (it may be "3." in "3.5"), unless we're flushing.
      if (end >= buffer.length && !force && !match[0].includes("\n")) break;
      const sentence = buffer.slice(lastIndex, end).trim();
      if (sentence.length >= 2) out.push(sentence);
      lastIndex = end;
    }
    buffer = buffer.slice(lastIndex);
    if (force && buffer.trim()) {
      out.push(buffer.trim());
      buffer = "";
    }
    return out;
  };

  return {
    push: (text) => {
      buffer += text;
      return take(false);
    },
    flush: () => take(true)
  };
};

export const makeTitle = (text) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "New chat";
  return clean.length > 42 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
};

export const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
