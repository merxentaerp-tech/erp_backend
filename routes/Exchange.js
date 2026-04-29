import express from "express";
import {
  createExchange,
  getExchangeDashboard,
  getInvoiceForExchange
} from "../controller/exchangeController.js";

import { auth } from "../middlewares/authMiddleware.js"; 

const router = express.Router();

// Create Exchange
router.get("/invoice/:invoice_number", auth, getInvoiceForExchange); 
router.post("/create", auth, createExchange); 
router.get("/dashboard", auth, getExchangeDashboard); 

export default router;
