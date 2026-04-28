// routes/exchangeRoutes.js

import express from "express";
import {
  createExchange,
  getExchangeDashboard,
  getInvoiceForExchange,
} from "../controllers/exchangeController.js";

import downloadInvoice from "../controllers/invoicePDFController.js";

import {
  authMiddleware,
  authorizeRoles,
  restrictToOwnStore,
} from "../middlewares/authMiddleware.js";

const router = express.Router();

//  PROTECTED ROUTES
router.get(
  "/invoice/:invoice_number",
  authMiddleware,
  restrictToOwnStore,
  getInvoiceForExchange
);

router.post(
  "/create",
  authMiddleware,
  restrictToOwnStore,
  createExchange
);

router.get(
  "/dashboard",
  authMiddleware,
  restrictToOwnStore,
  getExchangeDashboard
);

router.get(
  "/invoice/download/:invoice_number",
  authMiddleware,
  restrictToOwnStore,
  downloadInvoice
);

export default router;
