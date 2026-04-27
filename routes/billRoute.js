import express from "express";
import { createInvoiceFromBill,createBill } from "../controller/billingController.js";

const router = express.Router();
router.post("/create-bill", createBill);

export default router;