import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import requireActiveRole from "../../middleware/requireActiveRole.js";
import * as businessController from "./business.controller.js";
import {
  createProfileRules,
  locationRules,
  documentsRules,
  preferencesRules,
  createShiftRules,
  updateShiftRules,
  listShiftsRules,
  shiftIdRules,
  cancelShiftRules,
  listApplicantsRules,
  applicationIdRules,
  topUpRules,
} from "./business.validation.js";

const router = Router();

// every business endpoint requires auth + active business context
router.use(authenticate, requireActiveRole("business"));

// Profile onboarding (no verification gate — a business builds its profile here)
router.get("/profile", businessController.getProfile);
router.post("/profile", createProfileRules, businessController.createProfile);
router.patch("/profile/location", locationRules, businessController.updateLocation);
router.patch("/profile/documents", documentsRules, businessController.submitDocuments);
router.patch("/profile/preferences", preferencesRules, businessController.updatePreferences);

// Wallet (escrow funding)
router.get("/wallet", businessController.getWallet);
router.post("/wallet/topup", topUpRules, businessController.topUpWallet);

// Dashboard
router.get("/dashboard", businessController.getDashboard);

// Shift management
router.post("/shifts", createShiftRules, businessController.createShift);
router.get("/shifts", listShiftsRules, businessController.listShifts);
router.get("/shifts/:id", shiftIdRules, businessController.getShift);
router.patch("/shifts/:id", updateShiftRules, businessController.updateShift);
router.patch("/shifts/:id/publish", shiftIdRules, businessController.publishShift);
router.patch("/shifts/:id/cancel", cancelShiftRules, businessController.cancelShift);
router.get("/shifts/:id/applicants", listApplicantsRules, businessController.listApplicants);
router.get("/shifts/:id/roster", shiftIdRules, businessController.getRoster);

// Applicant decisions
router.patch("/applications/:id/shortlist", applicationIdRules, businessController.shortlistApplicant);
router.patch("/applications/:id/accept", applicationIdRules, businessController.acceptApplicant);
router.patch("/applications/:id/reject", applicationIdRules, businessController.rejectApplicant);

export default router;
