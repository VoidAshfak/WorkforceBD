import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import requireVerifiedProfile from "../../middleware/requireVerifiedProfile.js";
import * as applicationController from "./application.controller.js";
import { applyRules, listApplicationsRules, applicationIdRules, checkInRules } from "./application.validation.js";

const router = Router();

// all application routes are worker-facing
router.use(authenticate, authorize("worker"));

// applying requires an admin-verified worker profile; viewing/withdrawing does not
router.post("/", requireVerifiedProfile("worker"), applyRules, applicationController.apply);
router.get("/", listApplicationsRules, applicationController.listMyApplications);
router.patch("/:id/withdraw", applicationIdRules, applicationController.withdraw);

// live attendance — requires an admin-verified worker profile
router.post("/:id/check-in", requireVerifiedProfile("worker"), checkInRules, applicationController.checkIn);
router.post("/:id/check-out", requireVerifiedProfile("worker"), applicationIdRules, applicationController.checkOut);

export default router;
