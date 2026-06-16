import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import * as adminController from "./admin.controller.js";
import {
  listVerificationsRules,
  getVerificationRules,
  decideVerificationRules,
} from "./admin.validation.js";

const router = Router();

// all admin routes require auth + admin role
router.use(authenticate, authorize("admin"));

router.get("/verifications", listVerificationsRules, adminController.listVerifications);
router.get("/verifications/:profileId", getVerificationRules, adminController.getVerification);
router.patch("/verifications/:profileId", decideVerificationRules, adminController.decideVerification);

export default router;
