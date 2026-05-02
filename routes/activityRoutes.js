import express from "express";
import {auth} from "../middlewares/authMiddleware.js";
import {
  getDistrictOwnRecentActivities,
  getDistrictRetailRecentActivities,getRetailOwnRecentActivities
} from "../controller/activityController.js";

const router = express.Router();

router.get(
  "/district/own",
  auth,
  getDistrictOwnRecentActivities
);

router.get(
  "/district/retails",
  auth,
  getDistrictRetailRecentActivities
);
router.get(
  "/retail/own",
  auth,
  getRetailOwnRecentActivities
);
export default router;
