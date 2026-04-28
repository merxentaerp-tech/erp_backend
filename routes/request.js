import express from "express";
import { auth } from "../middlewares/authMiddleware.js";
import { upload } from "../middlewares/upload.js";
import {
  createStockRequest,
  getMyStockRequests,
  getReceivedStockRequests,
  getStockRequestById,
  cancelStockRequest,
  rejectStockRequest,
  approveAndDispatchRequest,
  receiveTransfer,
  getIncomingTransfers,
  getOutgoingTransfers,
  getAvailableStockForRequest,getTransferDetails,getEWayBillByTransferId
} from "../controller/stockRequest.controller.js";

const router = express.Router();

router.get("/getinventory", auth, getAvailableStockForRequest);

router.post("/requests", auth, createStockRequest);
router.get("/requests/my", auth, getMyStockRequests);
router.get("/requests/received", auth, getReceivedStockRequests);
router.get("/requests/:requestId", auth, getStockRequestById);
router.put("/requests/:requestId/cancel", auth, cancelStockRequest);
router.put("/requests/:requestId/reject", auth, rejectStockRequest);

router.put(
  "/requests/:requestId/approve-dispatch",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
    { name: "e_way_bill", maxCount: 1}
  ]),
  approveAndDispatchRequest
);

router.get("/transfers/incoming", auth, getIncomingTransfers);
router.get("/transfers/outgoing", auth, getOutgoingTransfers);
router.put("/transfers/:transferId/receive", auth, receiveTransfer);
router.get("/transfers/:id/details",auth,getTransferDetails
);
router.get(
  "/transfers/:id/e-way-bill",
  auth,
  getEWayBillByTransferId
);
export default router;