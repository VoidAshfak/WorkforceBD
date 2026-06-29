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
import businessRoutes from "./modules/business/business.routes.js";
import notificationRoutes from "./modules/notification/notification.routes.js";
import paymentRoutes from "./modules/payment/payment.routes.js";
import adminRoutes from "./modules/admin/admin.routes.js";
import realtimeRoutes from "./modules/realtime/realtime.routes.js";
import chatRoutes from "./modules/chat/chat.routes.js";
import categoryRoutes from "./modules/category/category.routes.js";
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
app.use("/api/v1/business", businessRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/payments", paymentRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/realtime", realtimeRoutes);
app.use("/api/v1/chat", chatRoutes);
app.use("/api/v1/categories", categoryRoutes);

app.use(errorHandler);

export default app;
