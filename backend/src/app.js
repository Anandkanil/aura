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
      if (!origin) {
        callback(null, true);
        return;
      }

      const isConfiguredOrigin = origin === env.frontendOrigin;
      const isLocalhostDevOrigin = /^http:\/\/localhost:\d+$/.test(origin);

      if (isConfiguredOrigin || isLocalhostDevOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
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
