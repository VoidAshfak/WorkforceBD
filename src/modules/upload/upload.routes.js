import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import { presignRules } from "./upload.validation.js";
import { presign } from "./upload.controller.js";

const router = Router();

router.use(authenticate);

// POST /api/v1/upload/presign
router.post("/presign", presignRules, presign);

export default router;
