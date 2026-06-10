import express from "express";
import {
  getStaffWithStats,
  getStaffByLevel,
  addEmployee,
  deleteEmployee,
  toggleEmployeeStatus,
  exportStaffExcel,
  getOrganizationsByLevel,
  updateEmployee,
} from "../controller/headoffice/staffController.js";

import { upload2 } from "../middlewares/upload2.js";

const router = express.Router();

router.get("/get", getStaffWithStats);
router.get("/by-level", getStaffByLevel);
router.get("/export", exportStaffExcel);
router.get("/organizations-by-level", getOrganizationsByLevel);

const uploadEmployeeDocs = (req, res, next) => {
  upload2.fields([
    { name: "aadhaar", maxCount: 1 },
    { name: "pan", maxCount: 1 },
    { name: "policeDoc", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      console.log("MULTER ERROR:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
    next();
  });
};

router.post("/add-emp", uploadEmployeeDocs, addEmployee);

router.put("/:id", uploadEmployeeDocs, updateEmployee);
router.delete("/:id", deleteEmployee);
router.patch("/:id/status", toggleEmployeeStatus);

export default router;
