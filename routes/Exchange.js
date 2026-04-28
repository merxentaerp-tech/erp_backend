import express from "express";
import { createExchange , getExchangeDashboard,getInvoiceForExchange,} from "../controller/exchangeController.js";
// import downloadInvoice from "../controllers/invoicePDFController.js";
const router = express.Router();

// Create Exchange
router.get("/invoice/:invoice_number", getInvoiceForExchange);
router.post("/create", createExchange);
router.get("/dashboard", getExchangeDashboard);
router.get("/invoice/download/:invoice_number", downloadInvoice);

export default router;
