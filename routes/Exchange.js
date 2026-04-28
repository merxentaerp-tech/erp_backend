import express from "express";
import {
  createExchange,
  getExchangeDashboard,
  getInvoiceForExchange,
} from "../controller/exchangeController.js";   // ✅ FIXED

import downloadInvoice from "../controller/invoicePDFController.js"; // ✅ check path

import {
  auth,
  authorizeRoles,
  restrictToOwnStore,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

// GET INVOICE
router.get(
  "/invoice/:invoice_number",
  auth,
  restrictToOwnStore,
  getInvoiceForExchange
);

// CREATE EXCHANGE
router.post(
  "/create",
  auth,
  restrictToOwnStore,
  createExchange
);

// DASHBOARD
router.get(
  "/dashboard",
  auth,
  restrictToOwnStore,
  getExchangeDashboard
);

// DOWNLOAD
router.get(
  "/invoice/download/:invoice_number",
  auth,
  restrictToOwnStore,
  downloadInvoice
);

export default router;
