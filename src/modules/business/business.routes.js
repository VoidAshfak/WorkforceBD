import { Router } from "express";
import authenticate from "../../middleware/authenticate.js";
import requireActiveRole from "../../middleware/requireActiveRole.js";
import requireVerifiedProfile from "../../middleware/requireVerifiedProfile.js";
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

// Gate for impactful actions — an unverified business keeps look-only access
// (profile onboarding + reads) but cannot post shifts, move money, or hire.
const verified = requireVerifiedProfile("business");

// Profile onboarding (no verification gate — a business builds its profile here)
router.get("/profile", businessController.getProfile);
router.post("/profile", createProfileRules, businessController.createProfile);
router.patch("/profile/location", locationRules, businessController.updateLocation);
router.patch("/profile/documents", documentsRules, businessController.submitDocuments);
router.patch("/profile/preferences", preferencesRules, businessController.updatePreferences);

// Wallet (escrow funding) — reading is open; funding requires verification
router.get("/wallet", businessController.getWallet);
router.post("/wallet/topup", verified, topUpRules, businessController.topUpWallet);

// Dashboard
router.get("/dashboard", businessController.getDashboard);

// Shift management — reads open; create/edit/publish/cancel require verification
router.post("/shifts", verified, createShiftRules, businessController.createShift);
router.get("/shifts", listShiftsRules, businessController.listShifts);
router.get("/shifts/:id", shiftIdRules, businessController.getShift);
router.patch("/shifts/:id", verified, updateShiftRules, businessController.updateShift);
router.patch("/shifts/:id/publish", verified, shiftIdRules, businessController.publishShift);
router.patch("/shifts/:id/cancel", verified, cancelShiftRules, businessController.cancelShift);
router.get("/shifts/:id/applicants", listApplicantsRules, businessController.listApplicants);
router.get("/shifts/:id/roster", shiftIdRules, businessController.getRoster);

// Applicant decisions — hiring/screening requires verification
router.patch("/applications/:id/shortlist", verified, applicationIdRules, businessController.shortlistApplicant);
router.patch("/applications/:id/accept", verified, applicationIdRules, businessController.acceptApplicant);
router.patch("/applications/:id/reject", verified, applicationIdRules, businessController.rejectApplicant);

export default router;
