import { randomUUID } from "node:crypto";

export const createChatController = ({ llmService, sessionStore }) => {
  return {
    async chat(req, res) {
      try {
        const message = req.body?.message?.trim();

        if (!message) {
          return res.status(400).json({ error: "'message' is required." });
        }

        const sessionId = req.body?.sessionId?.trim() || randomUUID();
        const history = sessionStore.getHistory(sessionId);
        const reply = await llmService.createReply(history, message);

        const nextHistory = [...history, { role: "user", content: message }, { role: "assistant", content: reply }];
        sessionStore.setHistory(sessionId, nextHistory);

        return res.status(200).json({
          sessionId,
          reply,
          history: sessionStore.getHistory(sessionId)
        });
      } catch (error) {
        const statusCode = error.statusCode || 500;
        return res.status(statusCode).json({
          error: error.message || "Failed to process chat request.",
          retryAfterSeconds: error.retryAfterSeconds || null
        });
      }
    }
  };
};
