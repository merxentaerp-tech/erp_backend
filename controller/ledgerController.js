// controllers/LedgerEntry.js

import Customer from "../model/Customer.js";
import LedgerEntry from "../model/LedgerEntry.js";
import Bill from "../model/Bill.js"
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

    const ledgerWhere = {
      organization_id,
    };

    const customerWhere = {
      organization_id,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    // ===============================
    // SUMMARY CARDS
    // ===============================
    const summaryRaw = await LedgerEntry.findOne({
      where: ledgerWhere,
      attributes: [
        [
          fn(
            "COALESCE",
            fn(
              "SUM",
              literal(`CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN 1 ELSE 0 END`)
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
              literal(`CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN 1 ELSE 0 END`)
            ),
            0
          ),
          "goods_receipt",
        ],
      ],
      raw: true,
    });

    const summary = {
      total_sales: Number(summaryRaw?.total_sales || 0),
      loss: 0,
      goods_receipt: Number(summaryRaw?.goods_receipt || 0),
    };

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
              literal(`CASE WHEN "LedgerEntry"."type" = 'DEBIT' THEN "LedgerEntry"."amount" ELSE 0 END`)
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
              literal(`CASE WHEN "LedgerEntry"."type" = 'CREDIT' THEN "LedgerEntry"."amount" ELSE 0 END`)
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
          as: "Customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
    });

    const clients = clientRows.map((row) => ({
      customer_id: row.customer_id,
      client_name: row.Customer?.name || "",
      phone: row.Customer?.phone || "",
      address: row.Customer?.address || "",
      store_code: row.Customer?.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
    }));

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

    // same logic as working getLedger API
    const ledgerWhere = {
      organization_id,
    };

    const customerWhere = {
      organization_id,
    };

    if (search?.trim()) {
      customerWhere[Op.or] = [
        { name: { [Op.iLike]: `%${search.trim()}%` } },
        { phone: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    // store info for header
    const store = await Store.findOne({
      where: { id: organization_id },
      attributes: ["id", "store_name", "store_code", "organization_level"],
      raw: true,
    });

    // client-wise data
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
          as: "Customer",
          attributes: ["id", "name", "phone", "address", "store_code"],
          where: customerWhere,
          required: true,
        },
      ],
      group: ["LedgerEntry.customer_id", "Customer.id"],
      order: [[literal(`"pending_amount"`), "DESC"]],
    });

    const data = clientRows.map((row) => ({
      customer_id: row.customer_id,
      client_name: row.Customer?.name || "",
      phone: row.Customer?.phone || "",
      address: row.Customer?.address || "",
      customer_store_code: row.Customer?.store_code || "",
      total_deals: Number(row.get("total_deals") || 0),
      total_amount: Number(row.get("total_amount") || 0),
      received_amount: Number(row.get("received_amount") || 0),
      pending_amount: Number(row.get("pending_amount") || 0),
      action: "View",
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Ledger Data");

    // title
    worksheet.mergeCells("A1:I1");
    worksheet.getCell("A1").value = "Ledger Dashboard Report";
    worksheet.getCell("A1").font = { bold: true, size: 16 };
    worksheet.getCell("A1").alignment = {
      horizontal: "center",
      vertical: "middle",
    };

    // store/org info
    worksheet.getCell("A3").value = "Store Name";
    worksheet.getCell("B3").value = store?.store_name || "";

    worksheet.getCell("A4").value = "Store Code";
    worksheet.getCell("B4").value = store?.store_code || req.user?.store_code || "";

    worksheet.getCell("A5").value = "Organization ID";
    worksheet.getCell("B5").value = organization_id;

    worksheet.getCell("A6").value = "Organization Level";
    worksheet.getCell("B6").value = store?.organization_level || "";

    worksheet.getCell("A7").value = "Generated At";
    worksheet.getCell("B7").value = new Date().toLocaleString();

    // make header labels bold
    ["A3", "A4", "A5", "A6", "A7"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    // blank row then table
    const headerRowIndex = 9;

    worksheet.getRow(headerRowIndex).values = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "Customer Store Code",
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

    // widths
    worksheet.columns = [
      { width: 15 }, // Customer ID
      { width: 25 }, // Client Name
      { width: 18 }, // Phone
      { width: 30 }, // Address
      { width: 20 }, // Customer Store Code
      { width: 15 }, // Total Deals
      { width: 18 }, // Total Amount
      { width: 18 }, // Received Amount
      { width: 18 }, // Pending Amount
    ];

    // alignment for numeric columns
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber >= headerRowIndex) {
        row.getCell(6).alignment = { horizontal: "center" };
        row.getCell(7).alignment = { horizontal: "right" };
        row.getCell(8).alignment = { horizontal: "right" };
        row.getCell(9).alignment = { horizontal: "right" };
      }
    });

    const fileName = `ledger_data_${store?.store_code || organization_id}_${Date.now()}.xlsx`;

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
    return res.status(500).json({
      success: false,
      message: "Failed to download ledger excel",
      error: error.message,
    });
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
ladger controller
