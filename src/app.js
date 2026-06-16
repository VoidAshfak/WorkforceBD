import express from "express";
import cors from "cors";
import helmet from "helmet";
import { httpLogger } from "./config/logger.js";
import { env } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import workerRoutes from "./modules/worker/worker.routes.js";
import uploadRoutes from "./modules/upload/upload.routes.js";
import shiftRoutes from "./modules/shift/shift.routes.js";
import applicationRoutes from "./modules/application/application.routes.js";
import errorHandler from "./middleware/errorHandler.js";

const app = express();

app.use(helmet());
app.use(cors({
  origin: env.frontendUrl,
  credentials: true,
}));
app.use(httpLogger);
app.use(express.json());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/worker", workerRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/shifts", shiftRoutes);
app.use("/api/v1/applications", applicationRoutes);

app.use(errorHandler);

export default app;
