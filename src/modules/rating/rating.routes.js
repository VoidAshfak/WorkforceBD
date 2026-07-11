import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import * as ratingController from "./rating.controller.js";
import { rateRules, listRatingsRules } from "./rating.validation.js";

const router = Router();

router.use(authenticate);

// Party-based like disputes: worker rates business, business rates worker —
// the service verifies the caller is a party to the assignment.
router.post("/", rateRules, ratingController.rate);
router.get("/my", listRatingsRules, ratingController.listMine);

export default router;
