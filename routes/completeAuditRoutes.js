import express from "express";
import { auth } from "../middlewares/authMiddleware.js";

import {
  getDistrictRetailAudits,
  getDistrictRetailAuditDetails,
  downloadDistrictRetailAudit,
} from "../controller/completeAuditController.js";

const router = express.Router();

/* =========================================================
   DISTRICT - RETAIL AUDIT REVIEW
========================================================= */

// District apne aligned retail stores ke audits ki list dekhega
router.get(
  "/district/retail-audits",
  auth,
  getDistrictRetailAudits
);

// District kisi ek retail audit ka full detail dekhega
router.get(
  "/district/retail-audits/:id",
  auth,
  getDistrictRetailAuditDetails
);

// District audit report CSV download karega
router.get(
  "/district/retail-audits/:id/download",
  auth,
  downloadDistrictRetailAudit
);

export default router;