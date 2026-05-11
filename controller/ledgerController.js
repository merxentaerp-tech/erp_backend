// controllers/LedgerEntry.js
// controllers/LedgerEntry.js
import { QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import axios from "axios";
import Customer from "../model/Customer.js";
import LedgerEntry from "../model/LedgerEntry.js";
import Bill from "../model/Bill.js"
import PDFDocument from "pdfkit";
import InvoiceItem from "../model/InvoiceItem.js"
// import Customer from "../model/Customer.js";
import Store from "../model/Store.js";
import Invoice from "../model/invoices.js"; // if available in your project
import ExcelJS from "exceljs";
// import { resolveDistrictOrganization } from "../utils/resolveDistrictOrganization.js"
import { Op, fn,col, literal } from "sequelize";


/**
 * @desc    Get ledger dashboard summary + client wise ledger
 * @route   GET /api/ledger
 */
export const getLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    const ledgerWhere = {
      organization_id,
    };

    const customerWhere = {
      organization_id,
    };

    if (cleanSearch) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${cleanSearch}%` } },
        { phone: { [Op.iLike]: `%${cleanSearch}%` } },
      ];
    }

    // ===============================
    // SUMMARY RAW
    // ===============================
    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    // ===============================
    // CLIENT WISE TABLE
    // ===============================
    const clientRows = await LedgerEntry.findAll({
      where: ledgerWhere,
      attributes: [
        "customer_id",
        [
          fn(
            "COUNT",
            literal(
              `DISTINCT CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."reference_id" END`
            )
          ),
          "total_deals",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "total_amount",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "received_amount",
        ],
        [
          literal(`
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'DEBIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
            -
            COALESCE(
              SUM(
                CASE 
                  WHEN "LedgerEntry"."type" = 'CREDIT' 
                  THEN "LedgerEntry"."amount" 
                  ELSE 0 
                END
              ), 
              0
            )
          `),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Customer,
          as: "customer", // ✅ FIXED: alias lowercase hona chahiye
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => {
      const totalAmount = Number(row.get("total_amount") || 0);
      const receivedAmount = Number(row.get("received_amount") || 0);
      const pendingAmount = Number(row.get("pending_amount") || 0);

      return {
        customer_id: Number(row.customer_id),
        client_name: row.customer?.name || "",
        phone: row.customer?.phone || "",
        address: row.customer?.address || "",
        store_code: row.customer?.store_code || "",
        total_deals: Number(row.get("total_deals") || 0),
        total_amount: Number(totalAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
      };
    });

    const totalAmount = clients.reduce(
      (sum, item) => sum + Number(item.total_amount || 0),
      0
    );

    const receivedAmount = clients.reduce(
      (sum, item) => sum + Number(item.received_amount || 0),
      0
    );

    const pendingAmount = clients.reduce(
      (sum, item) => sum + Number(item.pending_amount || 0),
      0
    );

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),

      // UI me Total Loss ke liye
      loss: 0,

      // Purana key backward compatibility ke liye rakha hai
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),

      // New proper dashboard keys
      total_clients: clients.length,
      total_amount: Number(totalAmount.toFixed(2)),
      received_amount: Number(receivedAmount.toFixed(2)),
      pending_amount: Number(pendingAmount.toFixed(2)),

      // UI me Collectable Amount ke liye ye use karo
      collectable_amount: Number(pendingAmount.toFixed(2)),
    };

    return res.status(200).json({
      success: true,
      message: "Ledger dashboard fetched successfully",
      data: {
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("Ledger Error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch ledger",
      error: error.message,
    });
  }
};
export const downloadLedgerExcel = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { organization_id } = req.user;
    const { search = "" } = req.query;

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id is missing in req.user",
      });
    }

    const cleanSearch = String(search || "").trim();

    const ledgerWhere = { organization_id };
    const customerWhere = { organization_id };

    if (cleanSearch) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${cleanSearch}%` } },
        { phone: { [Op.iLike]: `%${cleanSearch}%` } },
      ];
    }

    const store = await Store.findOne({
      where: { id: organization_id },
      attributes: ["id", "store_name", "store_code", "organization_level"],
      raw: true,
    });

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await LedgerEntry.findAll({
      where: ledgerWhere,
      attributes: [
        "customer_id",
        [
          fn(
            "COUNT",
            literal(
              `DISTINCT CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."reference_id" END`
            )
          ),
          "total_deals",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "total_amount",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`
              )
            ),
            0
          ),
          "received_amount",
        ],
        [
          literal(`
            COALESCE(SUM(CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END), 0)
            -
            COALESCE(SUM(CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END), 0)
          `),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Customer,
          as: "customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => ({
      customer_id: Number(row.customer_id),
      client_name: row.customer?.name || "",
      phone: row.customer?.phone || "",
      address: row.customer?.address || "",
      store_code: row.customer?.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: clients.length,
      total_amount: clients.reduce(
        (sum, item) => sum + Number(item.total_amount || 0),
        0
      ),
      received_amount: clients.reduce(
        (sum, item) => sum + Number(item.received_amount || 0),
        0
      ),
      pending_amount: clients.reduce(
        (sum, item) => sum + Number(item.pending_amount || 0),
        0
      ),
    };

    const workbook = new ExcelJS.Workbook();

    workbook.creator = "ERP System";
    workbook.created = new Date();
    workbook.modified = new Date();

    const worksheet = workbook.addWorksheet("Ledger Report", {
      views: [{ state: "frozen", ySplit: 12 }],
      pageSetup: {
        paperSize: 9,
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });

    worksheet.properties.defaultRowHeight = 22;

    worksheet.columns = [
      { key: "customer_name", width: 26 },
      { key: "phone", width: 16 },
      { key: "store_code", width: 16 },
      { key: "address", width: 34 },
      { key: "total_deals", width: 14 },
      { key: "total_amount", width: 18 },
      { key: "received_amount", width: 20 },
      { key: "pending_amount", width: 20 },
    ];

    const titleFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF111827" },
    };

    const sectionFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE5E7EB" },
    };

    const headerFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };

    const cardFill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFF9FAFB" },
    };

    const border = {
      top: { style: "thin", color: { argb: "FFD1D5DB" } },
      left: { style: "thin", color: { argb: "FFD1D5DB" } },
      bottom: { style: "thin", color: { argb: "FFD1D5DB" } },
      right: { style: "thin", color: { argb: "FFD1D5DB" } },
    };

    const moneyFormat = '₹#,##0.00;[Red]-₹#,##0.00';
    const numberFormat = '#,##0';

    // =========================
    // TITLE
    // =========================
    worksheet.mergeCells("A1:H1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "Dashboard & Ledger Report";
    titleCell.font = {
      bold: true,
      size: 18,
      color: { argb: "FFFFFFFF" },
    };
    titleCell.fill = titleFill;
    titleCell.alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    worksheet.getRow(1).height = 34;

    // =========================
    // STORE INFO
    // =========================
    worksheet.mergeCells("A3:B3");
    worksheet.getCell("A3").value = "Store / Organization";
    worksheet.getCell("A3").font = { bold: true };

    worksheet.mergeCells("C3:D3");
    worksheet.getCell("C3").value =
      store?.store_name || req.user?.store_name || "N/A";

    worksheet.mergeCells("E3:F3");
    worksheet.getCell("E3").value = "Store Code";
    worksheet.getCell("E3").font = { bold: true };

    worksheet.mergeCells("G3:H3");
    worksheet.getCell("G3").value =
      store?.store_code || req.user?.store_code || "N/A";

    worksheet.mergeCells("A4:B4");
    worksheet.getCell("A4").value = "Organization ID";
    worksheet.getCell("A4").font = { bold: true };

    worksheet.mergeCells("C4:D4");
    worksheet.getCell("C4").value = organization_id;

    worksheet.mergeCells("E4:F4");
    worksheet.getCell("E4").value = "Generated At";
    worksheet.getCell("E4").font = { bold: true };

    worksheet.mergeCells("G4:H4");
    worksheet.getCell("G4").value = new Date().toLocaleString("en-IN");

    ["A3", "C3", "E3", "G3", "A4", "C4", "E4", "G4"].forEach((cell) => {
      worksheet.getCell(cell).border = border;
      worksheet.getCell(cell).alignment = {
        vertical: "middle",
        horizontal: "left",
      };
    });

    // =========================
    // DASHBOARD CARDS
    // =========================
    worksheet.mergeCells("A6:H6");
    worksheet.getCell("A6").value = "Dashboard Cards";
    worksheet.getCell("A6").font = { bold: true, size: 13 };
    worksheet.getCell("A6").fill = sectionFill;
    worksheet.getCell("A6").border = border;

    const cards = [
      ["A7:B8", "Total Sales", summary.total_sales, numberFormat],
      ["C7:D8", "Goods Receipt", summary.goods_receipt, numberFormat],
      ["E7:F8", "Total Clients", summary.total_clients, numberFormat],
      ["G7:H8", "Loss", summary.loss, moneyFormat],
      ["A9:B10", "Total Amount", summary.total_amount, moneyFormat],
      ["C9:D10", "Received Amount", summary.received_amount, moneyFormat],
      ["E9:F10", "Pending Amount", summary.pending_amount, moneyFormat],
      ["G9:H10", "Collectable", summary.pending_amount, moneyFormat],
    ];

    cards.forEach(([range, label, value, format]) => {
      worksheet.mergeCells(range);

      const startCell = range.split(":")[0];
      const cell = worksheet.getCell(startCell);

      cell.value = {
        richText: [
          {
            text: `${label}\n`,
            font: {
              bold: true,
              size: 10,
              color: { argb: "FF6B7280" },
            },
          },
          {
            text: String(value),
            font: {
              bold: true,
              size: 15,
              color: { argb: "FF111827" },
            },
          },
        ],
      };

      cell.fill = cardFill;
      cell.border = border;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };

      if (typeof value === "number") {
        cell.numFmt = format;
      }
    });

    worksheet.getRow(7).height = 25;
    worksheet.getRow(8).height = 25;
    worksheet.getRow(9).height = 25;
    worksheet.getRow(10).height = 25;

    // =========================
    // CUSTOMER LEDGER TABLE
    // =========================
    worksheet.mergeCells("A12:H12");
    worksheet.getCell("A12").value = "Customer Ledger";
    worksheet.getCell("A12").font = { bold: true, size: 13 };
    worksheet.getCell("A12").fill = sectionFill;
    worksheet.getCell("A12").border = border;

    const headerRowIndex = 13;
    const headerRow = worksheet.getRow(headerRowIndex);

    headerRow.values = [
      "Customer Name",
      "Phone",
      "Store Code",
      "Address",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
    ];

    headerRow.height = 26;

    headerRow.eachCell((cell) => {
      cell.font = {
        bold: true,
        color: { argb: "FFFFFFFF" },
      };
      cell.fill = headerFill;
      cell.border = border;
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
    });

    clients.forEach((item) => {
      const row = worksheet.addRow({
        customer_name: item.client_name,
        phone: item.phone,
        store_code: item.store_code,
        address: item.address,
        total_deals: item.total_deals,
        total_amount: item.total_amount,
        received_amount: item.received_amount,
        pending_amount: item.pending_amount,
      });

      row.eachCell((cell, colNumber) => {
        cell.border = border;
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 5 ? "right" : "left",
          wrapText: true,
        };
      });

      row.getCell(2).numFmt = "@";
      row.getCell(3).numFmt = "@";
      row.getCell(5).numFmt = numberFormat;
      row.getCell(6).numFmt = moneyFormat;
      row.getCell(7).numFmt = moneyFormat;
      row.getCell(8).numFmt = moneyFormat;
    });

    const lastRow = worksheet.rowCount;

    if (clients.length > 0) {
      const totalRow = worksheet.addRow({
        customer_name: "Grand Total",
        phone: "",
        store_code: "",
        address: "",
        total_deals: clients.reduce(
          (sum, item) => sum + Number(item.total_deals || 0),
          0
        ),
        total_amount: summary.total_amount,
        received_amount: summary.received_amount,
        pending_amount: summary.pending_amount,
      });

      totalRow.height = 26;

      totalRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true };
        cell.fill = sectionFill;
        cell.border = border;
        cell.alignment = {
          vertical: "middle",
          horizontal: colNumber >= 5 ? "right" : "left",
        };
      });

      totalRow.getCell(5).numFmt = numberFormat;
      totalRow.getCell(6).numFmt = moneyFormat;
      totalRow.getCell(7).numFmt = moneyFormat;
      totalRow.getCell(8).numFmt = moneyFormat;
    }

    worksheet.autoFilter = {
      from: {
        row: headerRowIndex,
        column: 1,
      },
      to: {
        row: headerRowIndex,
        column: 8,
      },
    };

    worksheet.eachRow((row) => {
      row.eachCell((cell) => {
        cell.font = {
          name: "Calibri",
          size: cell.font?.size || 11,
          bold: cell.font?.bold || false,
          color: cell.font?.color,
        };
      });
    });

    worksheet.getRow(1).font = {
      name: "Calibri",
      bold: true,
      size: 18,
      color: { argb: "FFFFFFFF" },
    };

    const fileName = `ledger_report_${
      store?.store_code || req.user?.store_code || organization_id
    }_${Date.now()}.xlsx`;

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
    console.error("Download Ledger Excel Error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to download ledger excel",
        error: error.message,
      });
    }

    return res.end();
  }
};
/**
 * @desc    Get detailed ledger for one customer
 * @route   GET /api/ledger/customer/:customer_id
 */

export const getCustomerLedgerDetail = async (req, res) => {
  try {
    const customer_id = Number(req.params.customer_id);

    if (isNaN(customer_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid customer_id",
      });
    }

    const organization_id = req.user?.organization_id || null;

    const customerWhere = { id: customer_id };
    if (organization_id) {
      customerWhere.organization_id = organization_id;
    }

    const customer = await Customer.findOne({
      where: customerWhere,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const ledgerWhere = { customer_id };
    if (organization_id) {
      ledgerWhere.organization_id = organization_id;
    }

    const entries = await LedgerEntry.findAll({
      where: ledgerWhere,
      order: [["createdAt", "ASC"]],
      raw: true,
    });

    const debitEntries = entries.filter((e) => e.type === "DEBIT");
    const creditEntries = entries.filter((e) => e.type === "CREDIT");

    let totalCreditPool = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const rows = [];

    for (const entry of debitEntries) {
      const debitAmount = parseFloat(entry.amount || 0);

      let receivedAmount = 0;

      if (totalCreditPool > 0) {
        receivedAmount = Math.min(totalCreditPool, debitAmount);
        totalCreditPool -= receivedAmount;
      }

      const pendingAmount = debitAmount - receivedAmount;

      let invoiceNumber = entry.reference_id || "-";
      let invoiceId = null;

      if (
        (entry.reference_type === "BILL" ||
          entry.reference_type === "INVOICE") &&
        entry.reference_id
      ) {
        invoiceId = entry.reference_id;
      }

      if (entry.reference_type === "BILL" && entry.reference_id) {
        const billWhere = { id: entry.reference_id };

        if (organization_id) {
          billWhere.organization_id = organization_id;
        }

        const bill = await Bill.findOne({
          where: billWhere,
          attributes: ["id", "bill_number", "createdAt"],
          raw: true,
        });

        if (bill) {
          invoiceId = bill.id;
          invoiceNumber = bill.bill_number;
        }
      }

      rows.push({
        ledger_id: entry.id,
        invoice_id: invoiceId,
        invoice_number: invoiceNumber || "-",
        date: entry.createdAt,
        total_amount: Number(debitAmount.toFixed(2)),
        received_amount: Number(receivedAmount.toFixed(2)),
        pending_amount: Number(pendingAmount.toFixed(2)),
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        action: "View",
      });
    }

    const totalAmount = debitEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalReceived = creditEntries.reduce(
      (sum, e) => sum + parseFloat(e.amount || 0),
      0
    );

    const totalPending = totalAmount - totalReceived;

    return res.status(200).json({
      success: true,
      message: "Customer ledger detail fetched successfully",
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          phone: customer.phone,
          address: customer.address,
          pan_card_number: customer.pan_card_number,
          store_code: customer.store_code,
        },
        summary: {
          total_amount: Number(totalAmount.toFixed(2)),
          received_amount: Number(totalReceived.toFixed(2)),
          pending_amount: Number(totalPending.toFixed(2)),
        },
        deals: rows.reverse(),
      },
    });
  } catch (err) {
    console.error("Ledger Detail Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer ledger detail",
      error: err.message,
    });
  }
};
const DISTRICT_LEVELS = ["district", "District", "DISTRICT"];

const getStoreNameField = () => {
  if (Store.rawAttributes?.store_name) return "store_name";
  if (Store.rawAttributes?.name) return "name";
  return "store_name";
};

const getStoreCodeField = () => {
  if (Store.rawAttributes?.store_code) return "store_code";
  if (Store.rawAttributes?.code) return "code";
  return "store_code";
};

const getInvoiceNoField = () => {
  if (Invoice?.rawAttributes?.invoice_number) return "invoice_number";
  if (Invoice?.rawAttributes?.invoice_no) return "invoice_no";
  if (Invoice?.rawAttributes?.bill_no) return "bill_no";
  return "invoice_number";
};

const getInvoiceDateField = () => {
  if (Invoice?.rawAttributes?.invoice_date) return "invoice_date";
  if (Invoice?.rawAttributes?.date) return "date";
  if (Invoice?.rawAttributes?.createdAt) return "createdAt";
  return "invoice_date";
};

const resolveDistrictOrganization = async (user) => {
  if (!user) {
    throw new Error("User not authenticated");
  }

  if (!DISTRICT_LEVELS.includes(user.organization_level)) {
    throw new Error("Only district users can access this ledger");
  }

  let districtOrg = null;

  if (user.store_code) {
    districtOrg = await Store.findOne({
      where: {
        store_code: user.store_code,
      },
      raw: true,
    });

    if (districtOrg) return districtOrg;
  }

  districtOrg = await Store.findOne({
    where: {
      id: user.organization_id,
    },
    raw: true,
  });

  if (districtOrg) return districtOrg;

  throw new Error("District office organization not found");
};

const getDistrictScope = async (user) => {
  const districtOrg = await resolveDistrictOrganization(user);

  return {
    districtOrg,
    districtStoreCode: user.store_code || districtOrg[getStoreCodeField()],
    districtOrgId: user.organization_id || districtOrg.id,
  };
};

export const getDistrictLedger = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const clients = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      store_code: row.store_code || "",
      source_type: "district",
      source_name: districtOrg[getStoreNameField()] || "District Office",
      source_store_code: districtStoreCode,
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: clients.length,
      total_amount: clients.reduce(
        (sum, item) => sum + Number(item.total_amount || 0),
        0
      ),
      total_received: clients.reduce(
        (sum, item) => sum + Number(item.received_amount || 0),
        0
      ),
      total_pending: clients.reduce(
        (sum, item) => sum + Number(item.pending_amount || 0),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "District ledger dashboard fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
          organization_level: req.user.organization_level,
        },
        summary,
        clients,
      },
    });
  } catch (error) {
    console.error("District Ledger Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district ledger",
      error: error.message,
    });
  }
};

export const getDistrictLedgerClientDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { customerId } = req.params;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this ledger detail",
      });
    }

    if (!customerId) {
      return res.status(400).json({
        success: false,
        message: "customerId is required",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customer = await Customer.findOne({
      where: {
        id: customerId,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
      ],
      raw: true,
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: "District client not found",
      });
    }

    const invoiceNoField = getInvoiceNoField();
    const invoiceDateField = getInvoiceDateField();

    const invoices = await Invoice.findAll({
      where: {
        customer_id: customer.id,
        store_code: districtStoreCode,
      },
      attributes: [
        "id",
        ...(invoiceNoField ? [invoiceNoField] : []),
        ...(invoiceDateField ? [invoiceDateField] : []),
        "total_amount",
        "received_amount",
        "pending_amount",
      ],
      order: [
        [invoiceDateField, "DESC"],
        ["id", "DESC"],
      ],
      raw: true,
    });

    const rows = invoices.map((inv) => ({
      invoice_id: inv.id,
      invoice_number: inv[invoiceNoField] || `INV-${inv.id}`,
      date: inv[invoiceDateField]
        ? new Date(inv[invoiceDateField]).toISOString().split("T")[0]
        : null,
      total_amount: Number(inv.total_amount || 0),
      received_amount: Number(inv.received_amount || 0),
      pending_amount: Number(inv.pending_amount || 0),
      action: "View",
    }));

    return res.status(200).json({
      success: true,
      message: "District client ledger detail fetched successfully",
      data: {
        district: {
          organization_id: districtOrgId,
          district_id: districtOrg.district_id || districtOrgId,
          store_code: districtStoreCode,
          store_name: districtOrg[getStoreNameField()] || "District Office",
        },
        client: {
          id: customer.id,
          name: customer.name || "",
          phone: customer.phone || "",
          address: customer.address || "",
          store_code: customer.store_code || "",
          source_type: "district",
          source_name: districtOrg[getStoreNameField()] || "District Office",
        },
        summary: {
          total_deals: rows.length,
          total_amount: rows.reduce((sum, item) => sum + item.total_amount, 0),
          received_amount: rows.reduce(
            (sum, item) => sum + item.received_amount,
            0
          ),
          pending_amount: rows.reduce(
            (sum, item) => sum + item.pending_amount,
            0
          ),
        },
        rows,
      },
    });
  } catch (error) {
    console.error("District Ledger Client Detail Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district client ledger detail",
      error: error.message,
    });
  }
};

export const downloadDistrictLedgerExcel = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated. req.user is missing.",
      });
    }

    const { search = "" } = req.query;

    if (!DISTRICT_LEVELS.includes(req.user.organization_level)) {
      return res.status(403).json({
        success: false,
        message: "Only district users can download this ledger excel",
      });
    }

    const { districtOrg, districtStoreCode, districtOrgId } =
      await getDistrictScope(req.user);

    const customerWhere = {
      store_code: districtStoreCode,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    const ledgerWhere = {
      store_code: districtStoreCode,
    };

    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "total_sales",
        ],
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(
                `CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`
              )
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const clientRows = await Customer.findAll({
      where: customerWhere,
      attributes: [
        "id",
        "name",
        "phone",
        "address",
        "store_code",
        "organization_id",
        [fn("COUNT", literal(`DISTINCT "invoices"."id"`)), "total_deals"],
        [
          fn("COALESCE", fn("SUM", col(`invoices.total_amount`)), 0),
          "total_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.received_amount`)), 0),
          "received_amount",
        ],
        [
          fn("COALESCE", fn("SUM", col(`invoices.pending_amount`)), 0),
          "pending_amount",
        ],
      ],
      include: [
        {
          model: Invoice,
          as: "invoices",
          attributes: [],
          required: false,
          where: {
            store_code: districtStoreCode,
          },
        },
      ],
      group: ["Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
      subQuery: false,
    });

    const data = clientRows.map((row) => ({
      customer_id: row.id,
      client_name: row.name || "",
      phone: row.phone || "",
      address: row.address || "",
      customer_store_code: row.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
      total_clients: data.length,
      total_amount: data.reduce((sum, item) => sum + item.total_amount, 0),
      total_received: data.reduce((sum, item) => sum + item.received_amount, 0),
      total_pending: data.reduce((sum, item) => sum + item.pending_amount, 0),
    };

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("District Ledger");

    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").value = "District Ledger Dashboard Report";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    worksheet.getCell("A3").value = "District Office Name";
    worksheet.getCell("B3").value =
      districtOrg[getStoreNameField()] || "District Office";

    worksheet.getCell("A4").value = "District Office Code";
    worksheet.getCell("B4").value = districtStoreCode;

    worksheet.getCell("A5").value = "Organization ID";
    worksheet.getCell("B5").value = districtOrgId;

    worksheet.getCell("A6").value = "District ID";
    worksheet.getCell("B6").value = districtOrg.district_id || districtOrgId;

    worksheet.getCell("A7").value = "Organization Level";
    worksheet.getCell("B7").value = req.user.organization_level || "District";

    worksheet.getCell("A8").value = "Generated At";
    worksheet.getCell("B8").value = new Date().toLocaleString();

    ["A3", "A4", "A5", "A6", "A7", "A8"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    worksheet.getCell("D3").value = "Total Sales";
    worksheet.getCell("E3").value = summary.total_sales;

    worksheet.getCell("D4").value = "Loss";
    worksheet.getCell("E4").value = summary.loss;

    worksheet.getCell("D5").value = "Goods Receipt";
    worksheet.getCell("E5").value = summary.goods_receipt;

    worksheet.getCell("D6").value = "Total Clients";
    worksheet.getCell("E6").value = summary.total_clients;

    worksheet.getCell("D7").value = "Total Amount";
    worksheet.getCell("E7").value = summary.total_amount;

    worksheet.getCell("D8").value = "Received Amount";
    worksheet.getCell("E8").value = summary.total_received;

    worksheet.getCell("D9").value = "Pending Amount";
    worksheet.getCell("E9").value = summary.total_pending;

    ["D3", "D4", "D5", "D6", "D7", "D8", "D9"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    const headerRowIndex = 11;

    worksheet.getRow(headerRowIndex).values = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "District Store Code",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount",
    ];

    worksheet.getRow(headerRowIndex).font = { bold: true };

    data.forEach((item) => {
      worksheet.addRow([
        item.customer_id,
        item.client_name,
        item.phone,
        item.address,
        item.customer_store_code,
        item.total_deals,
        item.total_amount,
        item.received_amount,
        item.pending_amount,
      ]);
    });

    worksheet.columns = [
      { width: 15 },
      { width: 25 },
      { width: 18 },
      { width: 30 },
      { width: 20 },
      { width: 15 },
      { width: 18 },
      { width: 18 },
      { width: 18 },
    ];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= headerRowIndex) {
        row.getCell(6).alignment = { horizontal: "center" };
        row.getCell(7).alignment = { horizontal: "right" };
        row.getCell(8).alignment = { horizontal: "right" };
        row.getCell(9).alignment = { horizontal: "right" };
      }
    });

    const fileName = `district_ledger_${districtStoreCode}_${Date.now()}.xlsx`;

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error("Download District Ledger Excel Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to download district ledger excel",
      error: error.message,
    });
  }
};


export const downloadInvoiceById = async (req, res) => {
  try {
    const invoice_id = Number(req.params.invoice_id);

    if (isNaN(invoice_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid invoice_id",
      });
    }

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const organization_id = req.user?.organization_id || null;

    const invoiceWhere = {
      id: invoice_id,
    };

    // Access check same org ke basis par
    if (organization_id) {
      invoiceWhere.organization_id = organization_id;
    }

    // 1. Invoice fetch
    const invoice = await Invoice.findOne({
      where: invoiceWhere,
      raw: true,
    });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: "Invoice not found or access denied",
      });
    }

    // 2. Customer fetch separately
    let customer = null;

    if (invoice.customer_id) {
      customer = await Customer.findOne({
        where: {
          id: invoice.customer_id,
          ...(organization_id ? { organization_id } : {}),
        },
        raw: true,
      });
    }

    // 3. Invoice items fetch with raw SQL
    // IMPORTANT: InvoiceItem model use nahi karna, kyunki model/DB column mismatch aa raha hai.
    const items = await sequelize.query(
      `
      SELECT *
      FROM invoice_items
      WHERE invoice_id = :invoice_id
      ORDER BY id ASC
      `,
      {
        replacements: {
          invoice_id: invoice.id,
        },
        type: QueryTypes.SELECT,
      }
    );

    const safeFileName = String(
      invoice.invoice_number || `invoice_${invoice.id}`
    ).replace(/[^\w\-]/g, "_");

    const fileName = `${safeFileName}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileName}"`
    );

    const doc = new PDFDocument({
      size: "A4",
      margin: 40,
      bufferPages: true,
    });

    doc.pipe(res);

    const formatMoney = (value) => {
      const num = Number(value || 0);
      return `Rs. ${num.toFixed(2)}`;
    };

    const formatWeight = (value) => {
      const num = Number(value || 0);
      return num.toFixed(3);
    };

    const formatDate = (value) => {
      if (!value) return "-";

      const date = new Date(value);

      if (isNaN(date.getTime())) {
        return "-";
      }

      return date.toLocaleDateString("en-IN");
    };

    // ================= HEADER =================
    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .text("TAX INVOICE", {
        align: "center",
      });

    doc.moveDown(0.5);

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`Invoice No: ${invoice.invoice_number || "-"}`, 40, 80)
      .text(`Invoice Date: ${formatDate(invoice.invoice_date)}`, 40, 96)
      .text(`Store Code: ${invoice.store_code || "-"}`, 40, 112);

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`Invoice ID: ${invoice.id}`, 390, 80, {
        width: 160,
        align: "right",
      })
      .text(`Status: ${invoice.status || "-"}`, 390, 96, {
        width: 160,
        align: "right",
      });

    doc.moveDown(3);

    // ================= CUSTOMER =================
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Customer Details", 40, 145);

    doc
      .moveTo(40, 163)
      .lineTo(555, 163)
      .stroke();

    doc
      .font("Helvetica")
      .fontSize(10)
      .text(`Name: ${customer?.name || "-"}`, 40, 175)
      .text(`Phone: ${customer?.phone || "-"}`, 40, 191)
      .text(`Address: ${customer?.address || "-"}`, 40, 207, {
        width: 320,
      })
      .text(`PAN: ${customer?.pan_card_number || "-"}`, 40, 237);

    // ================= ITEMS TABLE =================
    let y = 275;

    const drawTableHeader = () => {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("No.", 40, y, { width: 25 })
        .text("Product", 68, y, { width: 115 })
        .text("Purity", 185, y, { width: 45 })
        .text("Qty", 230, y, { width: 35, align: "right" })
        .text("Net Wt", 270, y, { width: 55, align: "right" })
        .text("Rate", 330, y, { width: 60, align: "right" })
        .text("Making", 395, y, { width: 65, align: "right" })
        .text("Total", 465, y, { width: 85, align: "right" });

      y += 16;

      doc
        .moveTo(40, y)
        .lineTo(555, y)
        .stroke();

      y += 8;
    };

    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .text("Invoice Items", 40, y);

    y += 22;

    drawTableHeader();

    doc.font("Helvetica").fontSize(8);

    if (!items.length) {
      doc.text("No items found", 40, y);
      y += 20;
    }

    items.forEach((item, index) => {
      if (y > 720) {
        doc.addPage();
        y = 50;
        drawTableHeader();
        doc.font("Helvetica").fontSize(8);
      }

      const productText =
        item.description ||
        item.product_name ||
        item.product_code ||
        item.article_code ||
        item.sku_code ||
        "-";

      const quantity = Number(item.quantity || item.qty || 1);
      const netWeight = item.net_weight || 0;
      const rate = item.rate || 0;
      const making =
        item.making_charge_value ||
        item.making_charge_amount ||
        item.making_charge_percent ||
        0;
      const total =
        item.total_amount ||
        item.line_total ||
        item.value ||
        0;

      doc
        .font("Helvetica")
        .fontSize(8)
        .text(index + 1, 40, y, { width: 25 })
        .text(productText, 68, y, {
          width: 115,
          height: 28,
          ellipsis: true,
        })
        .text(item.purity || "-", 185, y, { width: 45 })
        .text(quantity.toFixed(0), 230, y, {
          width: 35,
          align: "right",
        })
        .text(formatWeight(netWeight), 270, y, {
          width: 55,
          align: "right",
        })
        .text(Number(rate || 0).toFixed(2), 330, y, {
          width: 60,
          align: "right",
        })
        .text(Number(making || 0).toFixed(2), 395, y, {
          width: 65,
          align: "right",
        })
        .text(Number(total || 0).toFixed(2), 465, y, {
          width: 85,
          align: "right",
        });

      y += 30;
    });

    if (y > 650) {
      doc.addPage();
      y = 60;
    }

    doc
      .moveTo(40, y)
      .lineTo(555, y)
      .stroke();

    y += 20;

    // ================= SUMMARY =================
    const totalAmount = Number(invoice.total_amount || 0);
    const receivedAmount = Number(invoice.received_amount || 0);
    const pendingAmount = Number(invoice.pending_amount || 0);

    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .text("Summary", 360, y);

    y += 18;

    doc
      .font("Helvetica")
      .fontSize(10)
      .text("Total Amount:", 360, y, { width: 90 })
      .text(formatMoney(totalAmount), 455, y, {
        width: 95,
        align: "right",
      });

    y += 16;

    doc
      .text("Received:", 360, y, { width: 90 })
      .text(formatMoney(receivedAmount), 455, y, {
        width: 95,
        align: "right",
      });

    y += 16;

    doc
      .text("Pending:", 360, y, { width: 90 })
      .text(formatMoney(pendingAmount), 455, y, {
        width: 95,
        align: "right",
      });

    y += 45;

    // ================= FOOTER =================
    doc
      .font("Helvetica")
      .fontSize(9)
      .text("Thank you for your business.", 40, y, {
        align: "center",
        width: 515,
      });

    doc.end();
  } catch (err) {
    console.error("Download Invoice Error:", err);

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to download invoice",
        error: err.message,
      });
    }

    return res.end();
  }
};
