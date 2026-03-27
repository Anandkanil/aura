import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import SessionStore from "./services/sessionStore.js";
import { LlmService } from "./services/llmService.js";
import { createChatController } from "./controllers/chatController.js";
import { createChatRoutes } from "./routes/chatRoutes.js";

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      // allow non-browser requests
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        env.frontendOrigin,
        "http://localhost:5173"
      ];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      console.log("❌ Blocked by CORS:", origin); // debug
      return callback(null, false); // ✅ DON'T throw error
    }
  })
);
app.use(express.json());

const sessionStore = new SessionStore(env.maxHistoryMessages);
const llmService = new LlmService(env);
const chatController = createChatController({ llmService, sessionStore });

app.get("/api/health", (_, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api", createChatRoutes(chatController));

export default app;
