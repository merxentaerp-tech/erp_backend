import express from "express";
import { auth } from "../middlewares/authMiddleware.js";

import {
  getTrackerItems,
  getItemTrackerBatches,
  distributeBatch,
  getBatchFinalDestinations,
  getBatchNodeRoute,
  searchBatchTracker,
  getAllTrackerBatches,
  getBatchMovementHistory,
  getBatchMovementHistoryByBatchNo,
  getItemFinalDestinations,
} from "../controller/headoffice/itemtrackker.js";

const router = express.Router();

router.get("/items", auth, getTrackerItems);

router.get("/items/:item_id/batches", auth, getItemTrackerBatches);

router.get("/items/:item_id/final-destinations", auth, getItemFinalDestinations);

router.post("/batches/distribute", auth, distributeBatch);

router.get("/batches/search", auth, searchBatchTracker);

router.get("/batches", auth, getAllTrackerBatches);

router.get("/batches/:batch_id/final-destinations", auth, getBatchFinalDestinations);

router.get("/batches/:batch_id/route", auth, getBatchNodeRoute);

router.get("/batches/:batch_id/history", auth, getBatchMovementHistory);

router.get("/history", auth, getBatchMovementHistoryByBatchNo);

export default router;
