import express from "express";
import {
  getTodayAuditItems,
  createDailyAudit,
  getMyAuditHistory,
  getAuditDetails,
  getPendingAuditReminders,
  submitMissingItemReason,
  getReviewAudits,
  reviewAudit,
} from "../controller/inventoryAuditController.js";

import { auth } from "../middlewares/authMiddleware.js"; // apna auth middleware path lagao

const router = express.Router();

/* =========================================================
   DAILY AUDIT ROUTES
   Base URL => /api/audit
========================================================= */

/**
 * GET /api/audit/today-items
 * retail/district ke aaj ke audit items
 */
router.get("/today-items", auth, getTodayAuditItems);

/**
 * POST /api/audit/create
 * audit submit / save
 */
router.post("/create", auth, createDailyAudit);

/**
 * GET /api/audit/history
 * apni audit history
 */
router.get("/history", auth, getMyAuditHistory);

/**
 * GET /api/audit/pending-reminders
 * missing items reminders
 */
router.get(
  "/pending-reminders",
  auth,
  getPendingAuditReminders
);

/**
 * GET /api/audit/review-list
 * district/head review list
 */
router.get("/review-list", auth, getReviewAudits);

/**
 * GET /api/audit/:id
 * single audit details
 */
router.get("/:id", auth, getAuditDetails);

/**
 * PATCH /api/audit/reason/:audit_item_id
 * missing item ka reason submit
 */
router.patch(
  "/reason/:audit_item_id",
  auth,
  submitMissingItemReason
);

/**
 * PATCH /api/audit/review/:id
 * district/head review audit
 */
router.patch("/review/:id", auth, reviewAudit);

export default router;