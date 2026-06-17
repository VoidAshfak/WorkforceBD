import "dotenv/config";
import { createServer } from "http";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { initSocket } from "./socket/io.js";

// Wrap Express in a raw HTTP server so Socket.IO can share the same port.
const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(env.port, () => {
  logger.info(`Server running on port ${env.port} [${env.nodeEnv}]`);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
  httpServer.close(() => process.exit(1));
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception:", err.message);
  httpServer.close(() => process.exit(1));
});
