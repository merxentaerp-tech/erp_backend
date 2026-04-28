import express from "express";
import {
  createExchange,
  getExchangeDashboard,
  getInvoiceForExchange,
} from "../controller/exchangeController.js";   // ✅ FIXED

// import downloadInvoice from "../controller/invoicePDFController.js"; // ✅ check path

import {
  auth

} from "../middlewares/authMiddleware.js";

const router = express.Router();

// GET INVOICE
router.get(
  "/invoice/:invoice_number",
  auth,

  getInvoiceForExchange
);

// CREATE EXCHANGE
router.post(
  "/create",
  auth,

  createExchange
);

// DASHBOARD
router.get(
  "/dashboard",
  auth,

  getExchangeDashboard
);

// DOWNLOAD
// router.get(
//   "/invoice/download/:invoice_number",
//   auth,
 
//   downloadInvoice
// );

export default router;
