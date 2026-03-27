const SYSTEM_PROMPT =
  "You are Aura, a warm and helpful voice assistant. Speak like a real person in a natural conversational tone, use occasional contractions, keep replies concise, and avoid robotic phrasing or stiff bullet-heavy responses.";
const FALLBACK_MODELS = ["Qwen/Qwen2.5-7B-Instruct", "HuggingFaceH4/zephyr-7b-beta"];

const toMessages = (history, latestUserMessage) => {
  const turnHistory = history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .map((item) => ({
      role: item.role,
      content: item.content
    }));

  return history
    ? [
        { role: "system", content: SYSTEM_PROMPT },
        ...turnHistory,
        { role: "user", content: latestUserMessage }
      ]
    : [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: latestUserMessage }];
};

const extractAssistantText = (responseBody) => {
  const choice = responseBody?.choices?.[0]?.message?.content;

  if (typeof choice === "string") {
    return choice.trim();
  }

  if (Array.isArray(choice)) {
    return choice
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part?.type === "text") {
          return part.text || "";
        }
        return "";
      })
      .join("")
      .trim();
  }

  return "";
};

const parseRetryAfterSeconds = (message, headerValue) => {
  if (headerValue && /^\d+$/.test(headerValue)) {
    return Number.parseInt(headerValue, 10);
  }

  const fromRetryIn = String(message || "").match(/retry in\s+([0-9]+(?:\.[0-9]+)?)s/i);
  if (fromRetryIn) {
    return Math.ceil(Number.parseFloat(fromRetryIn[1]));
  }

  return null;
};

const createHttpError = ({ statusCode, message, retryAfterSeconds = null }) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
};

const isModelNotFound = (statusCode, bodyText) => {
  const lowered = String(bodyText || "").toLowerCase();
  return statusCode === 404 || lowered.includes("model") && lowered.includes("not found");
};

const normalizeHfError = (statusCode, bodyText, retryAfterHeader) => {
  const lowered = String(bodyText || "").toLowerCase();
  const retryAfterSeconds = parseRetryAfterSeconds(bodyText, retryAfterHeader);

  if (statusCode === 429 || lowered.includes("too many requests") || lowered.includes("quota")) {
    const message = retryAfterSeconds
      ? `Hugging Face API rate limit exceeded. Retry in about ${retryAfterSeconds}s.`
      : "Hugging Face API rate limit exceeded. Retry shortly.";
    return createHttpError({ statusCode: 429, message, retryAfterSeconds });
  }

  if (statusCode === 401 || statusCode === 403) {
    return createHttpError({
      statusCode,
      message: "Hugging Face authentication failed. Check HUGGINGFACE_API_KEY permissions and project settings."
    });
  }

  if (statusCode === 503) {
    const message = retryAfterSeconds
      ? `Hugging Face model is loading. Retry in about ${retryAfterSeconds}s.`
      : "Hugging Face model is loading. Retry shortly.";
    return createHttpError({ statusCode: 503, message, retryAfterSeconds });
  }

  return createHttpError({
    statusCode: statusCode || 500,
    message: bodyText || "Hugging Face API request failed."
  });
};

const parseJsonSafely = async (response) => {
  try {
    return await response.json();
  } catch {
    return null;
  }
};

export class LlmService {
  constructor(env) {
    this.env = env;
  }

  async createReply(history, latestUserMessage) {
    if (!this.env.huggingFaceApiKey) {
      throw new Error("HUGGINGFACE_API_KEY is missing. Set it in backend/.env.");
    }

    const modelsToTry = [this.env.huggingFaceModel, ...FALLBACK_MODELS].filter(
      (value, index, array) => Boolean(value) && array.indexOf(value) === index
    );

    let lastModelLookupError = null;

    for (const modelName of modelsToTry) {
      const response = await fetch(this.env.huggingFaceBaseUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.env.huggingFaceApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          messages: toMessages(history, latestUserMessage),
          max_tokens: this.env.huggingFaceMaxTokens
        })
      });

      if (!response.ok) {
        const bodyJson = await parseJsonSafely(response);
        const bodyText = bodyJson?.error?.message || bodyJson?.error || bodyJson?.message || (await response.text());

        if (isModelNotFound(response.status, bodyText)) {
          lastModelLookupError = bodyText;
          continue;
        }

        throw normalizeHfError(response.status, bodyText, response.headers.get("retry-after"));
      }

      const data = await parseJsonSafely(response);
      const assistantText = extractAssistantText(data);

      if (assistantText) {
        return assistantText;
      }

      return "I could not generate a response.";
    }

    throw createHttpError({
      statusCode: 404,
      message: `No supported Hugging Face model available. Tried: ${modelsToTry.join(", ")}. Last error: ${lastModelLookupError || "unknown error"}`
    });
  }
}
