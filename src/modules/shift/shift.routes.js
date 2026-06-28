import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import requireActiveRole from "../../middleware/requireActiveRole.js";
import * as shiftController from "./shift.controller.js";
import { listShiftsRules, shiftIdRules } from "./shift.validation.js";

const router = Router();

// discovery is worker-facing
router.use(authenticate, requireActiveRole("worker"));

router.get("/dashboard", shiftController.getDashboard);
router.get("/", listShiftsRules, shiftController.listShifts);
router.get("/:id", shiftIdRules, shiftController.getShift);

export default router;
