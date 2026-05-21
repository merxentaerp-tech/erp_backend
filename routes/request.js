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
  getOutgoingTransfers,getRetailStoresUnderDistrict,
  getAvailableStockForRequest,getTransferDetails,getEWayBillByTransferId,estimateDispatchRequestValue,createDistrictStockRequest,getHeadStore,getRetailStoresUnderDistrict,approveAndDispatchRequestfromretail
} from "../controller/stockRequest.controller.js";

import {getHeadReceivedStockRequests,approveAndDispatchHeadRequest,createHeadStockRequest,getHeadAllTransfers,getAvailableStoresForHeadRequest,getAnyTransferDetailsForHead} from "../controller/headoffice/headrequestflow.js"

const router = express.Router();

router.get("/getinventory", auth, getAvailableStockForRequest);

router.post("/requests", auth, createStockRequest);
router.get("/requests/my", auth, getMyStockRequests);
router.get("/requests/received", auth, getReceivedStockRequests);
router.get("/requests/:requestId", auth, getStockRequestById);
router.put("/requests/:requestId/cancel", auth, cancelStockRequest);
router.put("/requests/:requestId/reject", auth, rejectStockRequest);





router.post(
  "/requests/:requestId/approve-dispatch-from-retail",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
    { name: "e_way_bill", maxCount: 1 },
  ]),
  approveAndDispatchRequestfromretail
);



//this is district 
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
router.post(
  "/stock-requests/:requestId/estimate-dispatch-value",
  auth,
  estimateDispatchRequestValue
);




// ye district ka request api h to head and to retail
router.post(
  "/district-stock-request",
  auth,
  createDistrictStockRequest
);



router.get(
  "/district/retail-stores",
  auth,
  getRetailStoresUnderDistrict
);
router.post(
  "/head/available-stores",
  auth,
  getHeadStore
)
router.post(
  "/head/available-stores",
  auth,
  getRetailStoresUnderDistrict
)







//head request flow 
router.get('/headrece',auth,getHeadReceivedStockRequests)

router.post(
  "/requestshead/:requestId/approve-dispatch",
  auth,
  upload.fields([
    { name: "driver_photo", maxCount: 1 },
    { name: "dispatch_images", maxCount: 3 },
    { name: "dispatch_video", maxCount: 1 },
  ]),
  approveAndDispatchHeadRequest
);

router.post(
  "/head/available-stores",
  auth,
  getAvailableStoresForHeadRequest
);

router.post(
  "/head/create",
  auth,
  createHeadStockRequest
);


router.get(
  "/head/transfers/:id",
  auth,
  getAnyTransferDetailsForHead
);

router.get("/transfers/head/all", auth, getHeadAllTransfers);
export default router;
