import express from "express";
import { getDashboardSummary,getAllReports } from "../controller/dashboardController.js";
import { auth } from "../middlewares/authMiddleware.js";
import { getDistrictDashboard,addDistrictItemWithStock} from "../controller/districtController.js"
const router = express.Router();

router.get("/summary", auth, getDashboardSummary);
router.get('/Dis/dash',auth,getDistrictDashboard)
router.post("/district/item-stock/add", auth, addDistrictItemWithStock);
router.get('/report',auth,getAllReports)
export default router;