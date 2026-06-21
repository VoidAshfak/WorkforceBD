import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import authorize from "../../middleware/authorize.js";
import requireVerifiedProfile from "../../middleware/requireVerifiedProfile.js";
import * as paymentController from "./payment.controller.js";
import {
  listTransactionsRules,
  listPayoutsRules,
  requestPayoutRules,
  shiftIdRules,
  listPayoutQueueRules,
  processPayoutRules,
} from "./payment.validation.js";

const router = Router();

// every payment route requires a logged-in user; role is enforced per group below
router.use(authenticate);

/* ------------------------------ Worker ----------------------------- */
// Wallet is look-only; requesting a payout needs an admin-verified profile.
router.get("/wallet", authorize("worker"), paymentController.getWallet);
router.get("/wallet/transactions", authorize("worker"), listTransactionsRules, paymentController.listTransactions);
router.get("/payouts", authorize("worker"), listPayoutsRules, paymentController.listPayouts);
router.post("/payouts", authorize("worker"), requireVerifiedProfile("worker"), requestPayoutRules, paymentController.requestPayout);

/* ----------------------------- Business ---------------------------- */
// Complete a live shift, then settle it to pay the hired workers.
router.post("/shifts/:shiftId/complete", authorize("business"), shiftIdRules, paymentController.completeShift);
router.post("/shifts/:shiftId/settle", authorize("business"), requireVerifiedProfile("business"), shiftIdRules, paymentController.settleShift);

/* ------------------------------ Admin ------------------------------ */
router.get("/admin/payouts", authorize("admin"), listPayoutQueueRules, paymentController.listPayoutQueue);
router.patch("/admin/payouts/:payoutId", authorize("admin"), processPayoutRules, paymentController.processPayout);

export default router;
