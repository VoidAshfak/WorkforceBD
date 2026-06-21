import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import * as realtimeController from "./realtime.controller.js";

const router = Router();

// ticket is scoped to the authenticated user, any role
router.use(authenticate);

router.post("/ticket", realtimeController.createTicket);

export default router;
