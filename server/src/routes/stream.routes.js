import { Router } from "express";
import { requireAuth } from "../auth.js";
import { addClient, push, removeClient } from "../util/sse.js";

export const streamRouter = Router();

streamRouter.get("/", requireAuth, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 4000\n\n");
  addClient(req.user.id, res);
  const ping = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (err) {
      clearInterval(ping);
    }
  }, 25000);
  push(req.user.id, "hello", { at: Date.now() });
  req.on("close", () => {
    clearInterval(ping);
    removeClient(req.user.id, res);
  });
});
