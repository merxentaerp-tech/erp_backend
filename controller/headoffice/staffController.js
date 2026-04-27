
import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import ExcelJS from "exceljs";
import jwt from "jsonwebtoken";
import { Op } from "sequelize";
import cloudinary from "../utils/cloudinary.js";


/**
 *  STAFF DASHBOARD STATS
 */
export const getStaffStats = async (req, res) => {
  try {
    const data = await sequelize.query(`
      SELECT 
        COUNT(*) AS total_staff,
        COUNT(*) FILTER (WHERE is_active = true) AS active,
        COUNT(*) FILTER (WHERE is_active = false) AS on_leave,
        COUNT(DISTINCT role) AS departments
      FROM public.users   
    `, { type: QueryTypes.SELECT });

    res.json({ success: true, data: data[0] });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  GET ALL STAFF
 */
export const getAllStaff = async (req, res) => {
  try {
    const data = await sequelize.query(`
      SELECT 
        id,
        name AS username,
        email,
        phone_number,
        store_name,
        user_code,
        role,
        is_police_verified,
        store_code,
        is_active,
        created_at
      FROM public.users 
      ORDER BY id DESC
    `, { type: QueryTypes.SELECT });

    res.json({ success: true, data });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  EXPORT STAFF (EXCEL)
 */
export const exportStaffExcel = async (req, res) => {
  try {
    const staff = await sequelize.query(`
      SELECT 
        id,
        name AS username,
        email,
        phone_number,
        store_name,
        user_code,
        role,
        is_police_verified,
        store_code,
        is_active,
        created_at
      FROM public.users   
      ORDER BY id DESC
    `, { type: QueryTypes.SELECT });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Staff Report");

    //  TITLE
    sheet.mergeCells("A1:K1");
    sheet.getCell("A1").value = "Staff Management Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    sheet.addRow([]);

    //  HEADER
    const header = [
      "ID",
      "Name",
      "Email",
      "Phone",
      "Store",
      "Employee Code",
      "Role",
      "Police Verified",
      "Store Code",
      "Status",
      "Created At"
    ];

    sheet.addRow(header);
    sheet.getRow(3).font = { bold: true };

    //  DATA
    staff.forEach((s) => {
      sheet.addRow([
        s.id,
        s.username,
        s.email,
        s.phone_number,
        s.store_name,
        s.user_code,
        s.role,
        s.is_police_verified ? "Yes" : "No",
        s.store_code,
        s.is_active ? "Active" : "On Leave",
        s.created_at ? new Date(s.created_at).toLocaleString() : ""
      ]);
    });

    sheet.columns.forEach(col => col.width = 20);

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      "attachment; filename=staff-report.xlsx"
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/**
 *  GET SINGLE STAFF
 */
export const getStaffById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);

    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    res.json({ success: true, data: user });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  ADD EMPLOYEE
 */

const generateUserCode = async () => {
  const year = new Date().getFullYear();

  const lastUser = await User.findOne({
    where: {
      userCode: {
        [Op.like]: `USR/${year}/%`,
      },
    },
    order: [["created_at", "DESC"]],
  });

  let nextNumber = 1;

  if (lastUser) {
    const lastPart = lastUser.userCode.split("/")[2];
    const lastNumber = parseInt(lastPart) || 0;
    nextNumber = lastNumber + 1;
  }

  return `USR/${year}/${String(nextNumber).padStart(3, "0")}`;
};


export const addEmployee = async (req, res) => {
  try {
    const {
      email,
      username,
      password,
      role,
      storeCode,
      phoneNumber,
      storeName,
      organizationLevel,
      isPoliceVerified,
    } = req.body;

    if (!email || !username || !password || !role || !organizationLevel) {
      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    
    const validLevels = ["HEAD", "DISTRICT", "STORE"];

    if (!validLevels.includes(organizationLevel)) {
      return res.status(400).json({
        error: "Invalid organization level",
      });
    }

   
    const allowedRoles = ["ADMIN", "INVENTORY_MANAGER", "SALES_MANAGER"];

    if (!["SUPER_ADMIN", ...allowedRoles].includes(role)) {
      return res.status(400).json({
        error: "Invalid role",
      });
    }

    if (role === "SUPER_ADMIN" && organizationLevel !== "HEAD") {
      return res.status(400).json({
        error: "Super Admin only allowed at HEAD",
      });
    }

    
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        error: "Email already exists",
      });
    }

    
    if (phoneNumber) {
      const existingPhone = await User.findOne({
        where: { phoneNumber },
      });

      if (existingPhone) {
        return res.status(400).json({
          error: "Phone number already exists",
        });
      }
    }

 
    const hashedPassword = await bcrypt.hash(password, 10);

   
    const userCode = await generateUserCode();


    let aadhaarUrl = null;
    let panUrl = null;
    let policeDocUrl = null;

    if (isPoliceVerified === "true") {
      if (!req.files?.aadhaar || !req.files?.pan || !req.files?.policeDoc) {
        return res.status(400).json({
          error: "All documents required",
        });
      }

      const aadhaarRes = await cloudinary.uploader.upload(
        req.files.aadhaar[0].path,
        { resource_type: "auto" }
      );

      const panRes = await cloudinary.uploader.upload(
        req.files.pan[0].path,
        { resource_type: "auto" }
      );

      const policeRes = await cloudinary.uploader.upload(
        req.files.policeDoc[0].path,
        { resource_type: "auto" }
      );

      aadhaarUrl = aadhaarRes.secure_url;
      panUrl = panRes.secure_url;
      policeDocUrl = policeRes.secure_url;
    }

    
    const token = jwt.sign(
      { email, role, userCode },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    
    const user = await User.create({
      email,
      username,
      password: hashedPassword,
      role,
      storeCode,
      phoneNumber,
      storeName,
      organizationLevel,
      userCode,
      token, // ❗ if you don't want DB token → remove
      isPoliceVerified: isPoliceVerified === "true",
      aadhaarUrl,
      panUrl,
      policeDocUrl,
      isActive: true,
    });

  
    res.status(201).json({
      success: true,
      message: "Employee added successfully",
      data:{
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        storeCode: user.storeCode,
        phoneNumber: user.phoneNumber,
        storeName: user.storeName,
        organizationLevel: user.organizationLevel,
        userCode: user.userCode,
        isPoliceVerified: user.isPoliceVerified,
        aadhaarUrl: user.aadhaarUrl,
        panUrl: user.panUrl,
        policeDocUrl: user.policeDocUrl,
        isActive: user.isActive,
      },
      token,
    });

  } catch (err) {
    console.log("ADD EMPLOYEE ERROR:", err);
    res.status(500).json({
      error: err.message,
    });
  }
};


/**
 *  UPDATE EMPLOYEE
 */
export const updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    await user.update(req.body);

    res.json({
      success: true,
      data: user
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  DELETE EMPLOYEE
 */
export const deleteEmployee = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    await user.destroy();

    res.json({
      success: true,
      message: "Employee deleted"
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/**
 *  TOGGLE ACTIVE / LEAVE
 */
export const toggleEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findByPk(id);
    if (!user) {
      return res.status(404).json({ error: "Staff not found" });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: "Status updated",
      isActive: user.isActive
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};