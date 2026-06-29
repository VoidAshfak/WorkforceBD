import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import * as chatController from "./chat.controller.js";
import {
  openConversationRules,
  unreadCountRules,
  listConversationsRules,
  conversationIdRules,
  listMessagesRules,
  sendMessageRules,
} from "./chat.validation.js";

const router = Router();

// Chat is available to any authenticated worker/business. Participant + the
// application gate are enforced in the service; both sides are implicitly
// verified (applying / posting a shift both require a verified profile).
router.use(authenticate);

router.get("/unread-count", unreadCountRules, chatController.getUnreadCount);

router.get("/conversations", listConversationsRules, chatController.listConversations);
router.post("/conversations", openConversationRules, chatController.openConversation);

router.get("/conversations/:id/messages", listMessagesRules, chatController.listMessages);
router.post("/conversations/:id/messages", sendMessageRules, chatController.sendMessage);
router.patch("/conversations/:id/read", conversationIdRules, chatController.markRead);

export default router;
