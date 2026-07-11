import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import * as disputeController from "./dispute.controller.js";
import {
  raiseDisputeRules,
  listDisputesRules,
  resolveDisputeRules,
} from "./dispute.validation.js";

const router = Router();

router.use(authenticate);

// Either party of an assignment (worker or business) may raise; the service
// verifies party membership, so no role middleware here.
router.post("/", raiseDisputeRules, disputeController.raise);
router.get("/my", listDisputesRules, disputeController.listMine);

/* ------------------------------ Admin ------------------------------ */
router.get("/admin", authorize("admin"), listDisputesRules, disputeController.listQueue);
router.patch("/admin/:id", authorize("admin"), resolveDisputeRules, disputeController.resolve);

export default router;
