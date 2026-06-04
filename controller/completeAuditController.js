import { Op } from "sequelize";
import ExcelJS from "exceljs";
import InventoryAudit from "../model/inventoryAudit.js";
import InventoryAuditItem from "../model/inventoryAuditItem.js";

const safeNum = (val, def = 0) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
};

const normalizeLevel = (level) => String(level || "").toLowerCase();

const getUserScope = async (user) => {
  const organizationId = safeNum(user?.organization_id, null);
  const level = normalizeLevel(user?.organization_level);

  if (!user?.id) {
    throw new Error("Unauthorized user");
  }

  if (level === "district") {
    return {
      organization_id: organizationId,
      organization_level: "district",
    };
  }

  if (level === "retail" || level === "store") {
    return {
      organization_id: organizationId,
      organization_level: "retail",
    };
  }

  return {
    organization_id: organizationId,
    organization_level: level,
  };
};
export const getDistrictRetailAudits = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can view retail audits",
      });
    }

    const { date_from, date_to, status, store_id } = req.query;

    const whereClause = {
      organization_level: "retail",
      visible_to_organization_id: scope.organization_id,
    };

    if (status) whereClause.status = status;
    if (store_id) whereClause.store_id = store_id;

    if (date_from || date_to) {
      whereClause.audit_date = {};
      if (date_from) whereClause.audit_date[Op.gte] = date_from;
      if (date_to) whereClause.audit_date[Op.lte] = date_to;
    }

    const audits = await InventoryAudit.findAll({
      where: whereClause,
      order: [["audit_date", "DESC"], ["id", "DESC"]],
    });

    return res.status(200).json({
      success: true,
      message: "Retail audits fetched successfully",
      count: audits.length,
      data: audits,
    });
  } catch (error) {
    console.error("getDistrictRetailAudits error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail audits",
      error: error.message,
    });
  }
};
export const getDistrictRetailAuditDetails = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can view retail audit details",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: scope.organization_id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Audit not found under your district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    return res.status(200).json({
      success: true,
      message: "Retail audit details fetched successfully",
      data: {
        ...audit.toJSON(),
        audit_items: auditItems,
      },
    });
  } catch (error) {
    console.error("getDistrictRetailAuditDetails error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch audit details",
      error: error.message,
    });
  }
};
export const downloadDistrictRetailAudit = async (req, res) => {
  try {
    const scope = await getUserScope(req.user);

    if (scope.organization_level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district user can download retail audits",
      });
    }

    const { id } = req.params;

    const audit = await InventoryAudit.findOne({
      where: {
        id,
        organization_level: "retail",
        visible_to_organization_id: scope.organization_id,
      },
    });

    if (!audit) {
      return res.status(404).json({
        success: false,
        message: "Audit not found under your district",
      });
    }

    const auditItems = await InventoryAuditItem.findAll({
      where: {
        audit_id: audit.id,
      },
      order: [
        ["category", "ASC"],
        ["id", "DESC"],
      ],
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Audit Report");

    worksheet.columns = [
      { header: "Audit No", key: "audit_no", width: 28 },
      { header: "Audit Date", key: "audit_date", width: 15 },
      { header: "Store Code", key: "store_code", width: 15 },
      { header: "Store Name", key: "store_name", width: 30 },
      { header: "Item ID", key: "item_id", width: 12 },
      { header: "Article Code", key: "article_code", width: 22 },
      { header: "SKU Code", key: "sku_code", width: 22 },
      { header: "Item Name", key: "item_name", width: 30 },
      { header: "Category", key: "category", width: 18 },
      { header: "System Qty", key: "system_qty", width: 15 },
      { header: "Physical Qty", key: "physical_qty", width: 15 },
      { header: "System Weight", key: "system_weight", width: 18 },
      { header: "Physical Weight", key: "physical_weight", width: 18 },
      { header: "Audit Result", key: "audit_result", width: 16 },
      { header: "Missing Reason", key: "missing_reason", width: 30 },
      { header: "Note", key: "note", width: 30 },
    ];

    auditItems.forEach((item) => {
      worksheet.addRow({
        audit_no: audit.audit_no,
        audit_date: audit.audit_date,
        store_code: audit.store_code || "",
        store_name: audit.store_name || "",
        item_id: item.item_id || "",
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        category: item.category || "",
        system_qty: item.system_qty || 0,
        physical_qty: item.physical_qty || 0,
        system_weight: item.system_weight || 0,
        physical_weight: item.physical_weight || 0,
        audit_result: item.audit_result || "",
        missing_reason: item.missing_reason || "",
        note: item.checklist_note || "",
      });
    });

    worksheet.getRow(1).font = { bold: true };

    worksheet.getRow(1).eachCell((cell) => {
      cell.alignment = {
        vertical: "middle",
        horizontal: "center",
      };
    });

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    const fileName = `${audit.audit_no || "audit-report"}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("downloadDistrictRetailAudit error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download audit",
      error: error.message,
    });
  }
};