import { Router } from "express";

export const createChatRoutes = (chatController) => {
  const router = Router();

  router.post("/chat", chatController.chat);

  return router;
};
