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
} from "./admin.validation.js";

const router = Router();

// all admin routes require auth + admin role
router.use(authenticate, authorize("admin"));

router.get("/verifications", listVerificationsRules, adminController.listVerifications);
router.get("/verifications/:profileId", getVerificationRules, adminController.getVerification);
router.patch("/verifications/:profileId", decideVerificationRules, adminController.decideVerification);

// Shift-post moderation — approve before a shift becomes worker-visible
router.get("/shifts", listShiftPostsRules, adminController.listShiftPosts);
router.patch("/shifts/:shiftId", decideShiftPostRules, adminController.decideShiftPost);

export default router;
