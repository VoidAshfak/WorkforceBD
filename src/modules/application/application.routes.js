import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import * as applicationController from "./application.controller.js";
import { applyRules, listApplicationsRules, applicationIdRules } from "./application.validation.js";

const router = Router();

// all application routes are worker-facing
router.use(authenticate, authorize("worker"));

router.post("/", applyRules, applicationController.apply);
router.get("/", listApplicationsRules, applicationController.listMyApplications);
router.patch("/:id/withdraw", applicationIdRules, applicationController.withdraw);

export default router;
