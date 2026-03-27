import dotenv from "dotenv";

dotenv.config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export const env = {
  port: toInt(process.env.PORT, 4000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  huggingFaceApiKey: process.env.HUGGINGFACE_API_KEY || "",
  huggingFaceModel: process.env.HUGGINGFACE_MODEL || "Qwen/Qwen2.5-7B-Instruct",
  huggingFaceBaseUrl: process.env.HUGGINGFACE_BASE_URL || "https://router.huggingface.co/v1/chat/completions",
  huggingFaceMaxTokens: toInt(process.env.HUGGINGFACE_MAX_TOKENS, 300),
  maxHistoryMessages: toInt(process.env.MAX_HISTORY_MESSAGES, 20)
};
