import express from "express";
import {auth} from "../middlewares/authMiddleware.js"
import {
  startFakeTracking,
  getTransferRoute,
//   addGpsLocation,
} from "../controller/transferTracking.controller.js";

const router = express.Router();

router.post("/transfers/:id/start-fake-tracking", auth, startFakeTracking);
router.get("/transfers/:id/route", auth, getTransferRoute);
// router.post("/transfers/:id/location", auth, addGpsLocation);

export default router;