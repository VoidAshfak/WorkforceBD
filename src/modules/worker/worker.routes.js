import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import requireActiveRole from "../../middleware/requireActiveRole.js";
import * as workerController from "./worker.controller.js";
import {
  basicInfoRules,
  skillsRules,
  availabilityRules,
  documentsRules,
} from "./worker.validation.js";

const router = Router();

// all worker routes require auth + active worker context
router.use(authenticate, requireActiveRole("worker"));

router.get("/skills", workerController.getSkills);
router.get("/zones", workerController.getZones);

router.get("/profile", workerController.getProfile);
router.patch("/profile/basic", basicInfoRules, workerController.updateBasicInfo);
router.patch("/profile/skills", skillsRules, workerController.updateSkills);
router.patch("/profile/availability", availabilityRules, workerController.updateAvailability);
router.patch("/profile/documents", documentsRules, workerController.submitDocuments);

export default router;
