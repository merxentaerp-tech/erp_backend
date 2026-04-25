import express from "express";
import { createExchange , getExchangeDashboard,getInvoiceForExchange} from "../controller/exchangeController.js";

const router = express.Router();

// Create Exchange
router.get("/invoice/:invoice_number", getInvoiceForExchange);
router.post("/create", createExchange);
router.get("/dashboard", getExchangeDashboard);

export default router;
