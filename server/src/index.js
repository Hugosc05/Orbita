import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import { config, llmReady, msReady, PUBLIC_DIR } from "./config.js";
import "./db.js";
import { apiLimiter, buildHelmet, corsGuard, csrfGuard, heavyLimiter, makeAuthLimiter, sanitizeRequest } from "./security.js";
import { authRouter } from "./routes/auth.routes.js";
import { stateRouter } from "./routes/state.routes.js";
import { categoriesRouter, eventsRouter } from "./routes/events.routes.js";
import { outlookRouter } from "./routes/outlook.routes.js";
import { streamRouter } from "./routes/stream.routes.js";
import { startScheduler } from "./services/automation.service.js";

const app = express();

if (config.trustProxy) app.set("trust proxy", 1);
app.disable("x-powered-by");
app.disable("etag");

app.use(buildHelmet());
app.use(corsGuard);
app.use(cookieParser());
app.use(express.json({ limit: "12mb" }));
app.use(sanitizeRequest);

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  next();
});

app.use("/api", apiLimiter);
app.use("/api", csrfGuard);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    name: "orbita",
    version: 2,
    outlook: msReady(),
    llm: llmReady(),
    time: Date.now()
  });
});

app.use("/api/auth/login", makeAuthLimiter());
app.use("/api/auth/register", makeAuthLimiter());
app.use("/api/auth/me/pin", makeAuthLimiter());
app.use("/api/outlook/sync", heavyLimiter);

app.use("/api/auth", authRouter);
app.use("/api/state", stateRouter);
app.use("/api/events", eventsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/outlook", outlookRouter);
app.use("/api/stream", streamRouter);

app.use("/api", (req, res) => {
  res.status(404).json({ error: "no_encontrado" });
});

app.use(express.static(PUBLIC_DIR, {
  index: "index.html",
  maxAge: "1h",
  setHeaders: res => {
    res.setHeader("X-Content-Type-Options", "nosniff");
  }
}));

app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use((err, req, res, next) => {
  const status = err && err.status === 413 ? 413 : 500;
  res.status(status).json({ error: status === 413 ? "peticion_demasiado_grande" : "error_servidor" });
});

app.listen(config.port, () => {
  startScheduler();
  const lines = [
    "Órbita servidor en " + config.publicUrl,
    "Base de datos: " + config.dbFile,
    "Cookies seguras: " + (config.cookieSecure ? "sí" : "no (solo para desarrollo en local)"),
    "Outlook: " + (msReady() ? "configurado" : "sin configurar"),
    "IA: " + (llmReady() ? config.llm.provider + " / " + config.llm.model : "sin configurar"),
    "Sincronización automática cada " + config.sync.intervalMinutes + " min"
  ];
  console.log(lines.join("\n"));
});
