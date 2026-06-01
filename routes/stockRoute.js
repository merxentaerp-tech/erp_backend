import express from "express";
import multer from "multer";

import {
  getRetailInventory,
  getSingleStock,
  updateStockStatus,
  stockSummary,
  addStockIn,
  getStockItemsByCategory,
  getDistrictInventory,
  getDistrictStockItemsByCategory,
  uploadStockInItems,
  getItemQR,
  updateItemImage,
} from "../controller/stock.controller.js";

import {
  getOverallInventoryDashboard,
  getOverallCategoryItems,
  updateStockPricing,
} from "../controller/headoffice/headInventoryController.js";

import { uploadInventoryFile } from "../middlewares/uploadchallan.js";

import { auth } from "../middlewares/authMiddleware.js";

const router = express.Router();

/**
 * ==========================================
 * MULTER
 * ==========================================
 */

const storage = multer.memoryStorage();

const upload = multer({
  storage,
});

/**
 * ==========================================
 * RETAIL INVENTORY
 * ==========================================
 */

router.get(
  "/list",
  auth,
  getRetailInventory
);

/**
 * ==========================================
 * DISTRICT INVENTORY
 * ==========================================
 */

router.get(
  "/getdistrict",
  auth,
  getDistrictInventory
);

/**
 * ==========================================
 * STOCK SUMMARY
 * ==========================================
 */

router.get(
  "/summary",
  auth,
  stockSummary
);

/**
 * ==========================================
 * SINGLE STOCK
 * ==========================================
 */

router.get(
  "/:id",
  auth,
  getSingleStock
);

/**
 * ==========================================
 * UPDATE STATUS
 * ==========================================
 */

router.put(
  "/:id/status",
  auth,
  updateStockStatus
);

/**
 * ==========================================
 * STOCK IN
 * MULTIPLE IMAGE SUPPORT
 * ==========================================
 */

router.post(
  "/stock-in",
  auth,
  upload.array("images"),
  addStockIn
);

/**
 * ==========================================
 * CATEGORY ITEMS
 * ==========================================
 */

router.get(
  "/category/:category",
  auth,
  getStockItemsByCategory
);

/**
 * ==========================================
 * UPLOAD STOCK ITEMS
 * ==========================================
 */

router.post(
  "/inventory/stock-in/upload",
  auth,
  uploadInventoryFile.single("file"),
  uploadStockInItems
);
router.patch(
  "/item/:itemId/image", auth,
  upload.single("image"),
  updateItemImage
);

/**
 * ==========================================
 * ITEM QR
 * ==========================================
 */

router.get(
  "/items/:itemId/qr",
  auth,
  getItemQR
);

/**
 * ==========================================
 * DISTRICT CATEGORY
 * ==========================================
 */

router.get(
  "/district/inventory/category/:category",
  auth,
  getDistrictStockItemsByCategory
);

/**
 * ==========================================
 * HEAD OFFICE
 * ==========================================
 */

router.get(
  "/inventory/dashboard",
  getOverallInventoryDashboard
);

router.get(
  "/inventory/overall/category",
  getOverallCategoryItems
);

router.put(
  "/update-stock-pricing",
  updateStockPricing
);

export default router;
