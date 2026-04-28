import express from "express";
import {
  startLiveTracking,
  updateLiveLocation,
  getTransferRoute,
  stopLiveTracking,
} from "../controller/transferTracking.controller.js";

const router = express.Router();

router.post("/:id/start", startLiveTracking);
router.patch("/:id/location", updateLiveLocation);
router.get("/:id/route", getTransferRoute);
router.post("/:id/stop", stopLiveTracking);

export default router;