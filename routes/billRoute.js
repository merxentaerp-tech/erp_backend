import express from "express";
import { createInvoiceFromBill,createBill ,scanBillingItem} from "../controller/billingController.js";
import { auth } from "../middlewares/authMiddleware.js"; // apna auth middleware path lagao
const router = express.Router();
router.post("/create-bill",auth, createBill);
router.get("/billing/scan-item/:code", auth, scanBillingItem);
export default router;
