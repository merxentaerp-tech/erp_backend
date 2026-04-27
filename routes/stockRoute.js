import express from "express";
import {
  getRetailInventory,
  // getRetailInventory,
  getSingleStock,
  updateStockStatus,
  stockSummary,
  addStockIn,
  getStockItemsByCategory,getDistrictInventory,getDistrictStockItemsByCategory
} from "../controller/stock.controller.js";
import { auth } from "../middlewares/authMiddleware.js"

const router = express.Router();
//esme retail wala ka data aatega
router.get("/list", auth, getRetailInventory);
//this api for to the ditrict inventory 
router.get("/getdistrict",auth,getDistrictInventory)
//this is for stock summary
router.get("/summary", auth, stockSummary);
router.get("/:id", auth, getSingleStock);
router.put("/:id/status", auth, updateStockStatus);
router.post("/stock-in", auth, addStockIn);

//this is for finding the by category according data 
router.get("/category/:category", auth, getStockItemsByCategory);


router.get("/district/inventory/category/:category",auth, getDistrictStockItemsByCategory);
export default router;