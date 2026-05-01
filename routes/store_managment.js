import express from "express";
import {

  getDistrictInventory,
  getRetailStores,
  getStoreInventory,
  getStoreDashboard
} from "../controller/headoffice/storeManagementFlowController.js";
import { auth } from "../middlewares/authMiddleware.js";
const router = express.Router();

// District list
// router.get("/districts", getDistricts);

// District flow
router.get("/district/:store_code/inventory", auth,getDistrictInventory);
router.get("/district/:store_code/stores", auth,getRetailStores);

// Store inventory
router.get("/store/:store_code/inventory",auth, getStoreInventory);

// Summary (unchanged)
router.get("/dashboard",auth, getStoreDashboard);

export default router;