import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import * as adminController from "./admin.controller.js";
import {
  listVerificationsRules,
  getVerificationRules,
  decideVerificationRules,
  listShiftPostsRules,
  decideShiftPostRules,
  analyticsRules,
  listUsersRules,
  userIdRules,
  blockUserRules,
  unblockUserRules,
  updateSettingRules,
  settingKeyRules,
} from "./admin.validation.js";

const router = Router();

// all admin routes require auth + admin role
router.use(authenticate, authorize("admin"));

// Platform monitoring — headline counters + daily graph series
router.get("/dashboard", adminController.getDashboard);
router.get("/analytics", analyticsRules, adminController.getAnalytics);

router.get("/verifications", listVerificationsRules, adminController.listVerifications);
router.get("/verifications/:profileId", getVerificationRules, adminController.getVerification);
router.patch("/verifications/:profileId", decideVerificationRules, adminController.decideVerification);

// Shift-post moderation — approve before a shift becomes worker-visible
router.get("/shifts", listShiftPostsRules, adminController.listShiftPosts);
router.patch("/shifts/:shiftId", decideShiftPostRules, adminController.decideShiftPost);

// User management — search, inspect, block/unblock (worker + business)
router.get("/users", listUsersRules, adminController.listUsers);
router.get("/users/:userId", userIdRules, adminController.getUserDetail);
router.post("/users/:userId/block", blockUserRules, adminController.blockUser);
router.post("/users/:userId/unblock", unblockUserRules, adminController.unblockUser);

// Platform settings — runtime-tunable constants (no redeploy)
router.get("/settings", adminController.getSettings);
router.patch("/settings/:key", updateSettingRules, adminController.updateSetting);
router.delete("/settings/:key", settingKeyRules, adminController.resetSetting);

export default router;
