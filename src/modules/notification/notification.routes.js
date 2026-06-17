import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import * as notificationController from "./notification.controller.js";
import { listNotificationsRules, notificationIdRules } from "./notification.validation.js";

const router = Router();

// notifications belong to the authenticated user regardless of role
router.use(authenticate);

router.get("/", listNotificationsRules, notificationController.listNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.patch("/read-all", notificationController.markAllRead);
router.patch("/:id/read", notificationIdRules, notificationController.markRead);

export default router;
