import  sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";
import ExcelJS from "exceljs";
export const exportLedgerExcel = async (req, res) => {
  try {
    const { store_code } = req.params;

    //  Store Info
    const store = await sequelize.query(`
      SELECT id, store_name, store_code, organization_level
      FROM stores
      WHERE store_code = :store_code
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    const storeData = store[0];

    //  Customer Ledger Data
    const customers = await sequelize.query(`
      SELECT 
        c.id AS customer_id,
        c.name,
        c.phone,
        c.address,
        c.store_code,

        COUNT(inv.id) AS total_deals,
        COALESCE(SUM(inv.total_amount),0) AS total_amount,
        COALESCE(SUM(inv.received_amount),0) AS received_amount,
        COALESCE(SUM(inv.pending_amount),0) AS pending_amount

      FROM customers c
      LEFT JOIN invoices inv 
        ON c.id = inv.customer_id
        AND inv.store_code = :store_code

      WHERE c.store_code = :store_code
      GROUP BY c.id
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    //  Create Workbook
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Ledger Report");

    //  TITLE
    sheet.mergeCells("A1:J1");
    sheet.getCell("A1").value = "Ledger Dashboard Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    //  STORE DETAILS
    sheet.addRow([]);
    sheet.addRow(["Store Name", storeData.store_name]);
    sheet.addRow(["Store Code", storeData.store_code]);
    sheet.addRow(["Organization ID", storeData.id]);
    sheet.addRow(["Organization Level", storeData.organization_level]);
    sheet.addRow(["Generated At", new Date().toLocaleString()]);

    sheet.addRow([]);

    //  TABLE HEADER
    const header = [
      "Customer ID",
      "Client Name",
      "Phone",
      "Address",
      "Customer Store Code",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount"
    ];

    sheet.addRow(header);

    //  STYLE HEADER
    const headerRow = sheet.getRow(8);
    headerRow.font = { bold: true };

    //  DATA ROWS
    customers.forEach((c) => {
      sheet.addRow([
        c.customer_id,
        c.name,
        c.phone,
        c.address,
        c.store_code,
        c.total_deals,
        c.total_amount,
        c.received_amount,
        c.pending_amount
      ]);
    });

    //  AUTO WIDTH
    sheet.columns.forEach(col => {
      col.width = 20;
    });

    //  RESPONSE
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=ledger-${store_code}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * @desc Dashboard + All Stores Ledger (Combined API)
 * @route GET /api/dashboard/complete
 */
export const getCompleteDashboard = async (req, res) => {
  try {

    // ================= PERCENT CALC (FINAL FIX) =================
    const calcPercent = (curr, prev) => {
      curr = Number(curr) || 0;
      prev = Number(prev) || 0;

      if (prev === 0 && curr === 0) return 0;
      if (prev === 0) return "N/A";

      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

   // ================= CURRENT DATA =================
const current = await sequelize.query(`
  SELECT 
      COALESCE(SUM(ii.quantity),0) AS total_sales,

      COALESCE(SUM(i.purchase_rate * ii.quantity),0) AS total_cost,

      COALESCE(
          SUM(ii.total_amount - (i.purchase_rate * ii.quantity)),
      0) AS total_profit,

      COALESCE(SUM(inv.received_amount),0) AS received,

      COALESCE(SUM(inv.pending_amount),0) AS pending

  FROM invoices inv

  LEFT JOIN invoice_items ii
      ON inv.id = ii.invoice_id

  LEFT JOIN items i
      ON ii.item_id = i.id

  WHERE inv.status IN ('PAID', 'PARTIAL')
  AND COALESCE(ii.is_active, true) = true
`, { type: QueryTypes.SELECT });
   const previous = [{
  total_sales: 0,
  total_cost: 0,
  total_profit: 0,
  received: 0,
  pending: 0
}];
    const curr = current[0] || {};
    const prev = previous[0] || {};

    // ================= SAFE NUMBER CAST =================
    const currSales = Number(curr.total_sales) || 0;
    const prevSales = Number(prev.total_sales) || 0;

    const currProfit = Number(curr.total_profit) || 0;
    const prevProfit = Number(prev.total_profit) || 0;

    const currRevenue = Number(curr.received) || 0;
    const prevRevenue = Number(prev.received) || 0;

    const currPending = Number(curr.pending) || 0;
    const prevPending = Number(prev.pending) || 0;

    // ================= LOSS =================
    const lossCurrent = currProfit < 0 ? Math.abs(currProfit) : 0;
    const lossPrevious = prevProfit < 0 ? Math.abs(prevProfit) : 0;

    // ================= DASHBOARD =================
    const dashboard = {
      totalSales: {
        value: currSales,
        change: calcPercent(currSales, prevSales)
      },
      loss: {
        value: lossCurrent,
        change: calcPercent(lossCurrent, lossPrevious)
      },
      totalProfit: {
        value: currProfit,
        change: calcPercent(currProfit, prevProfit)
      },
      totalRevenue: {
        value: currRevenue,
        change: calcPercent(currRevenue, prevRevenue)
      },
      collectableAmount: {
        value: currPending,
        change: calcPercent(currPending, prevPending)
      }
    };

    // ================= LEDGER (UNCHANGED) =================
    const ledger = await sequelize.query(`
  SELECT 
    st.id,
    st.store_code,
    st.store_name,
    st.organization_level,

    MAX(u.name) AS store_manager,

    COUNT(DISTINCT inv.id) AS total_deals,

    COALESCE(SUM(inv.total_amount), 0) AS total_amount,

    COALESCE(SUM(inv.received_amount), 0) AS received_amount,

    COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

  FROM stores st

  LEFT JOIN users u
    ON st.store_code = u.store_code

  LEFT JOIN invoices inv 
    ON st.store_code = inv.store_code

  WHERE st.organization_level IN ('District', 'Retail')

  GROUP BY 
    st.id,
    st.store_code,
    st.store_name,
    st.organization_level

  ORDER BY 
    st.organization_level DESC,
    st.store_name
`, { type: QueryTypes.SELECT });

    // ================= FINAL RESPONSE =================
    res.json({
      success: true,
      data: {
        dashboard,
        ledger
      }
    });

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ error: error.message });
  }
};
/**
 * @desc Get Customer Ledger by Store Code
 * @route GET /api/ledger/store/:store_code/customers
 * @access All
 */
export const getStoreCustomerLedger = async (req, res) => {
  try {
    const { store_code } = req.params;

    if (!store_code) {
      return res.status(400).json({
        error: "store_code is required"
      });
    }

    const data = await sequelize.query(`
      SELECT 
        id AS customer_id,
        name AS client_name,
        store_code

      FROM customers

      WHERE store_code = :store_code

      ORDER BY name ASC
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
};
/**
 * @desc Get Customer Invoices
 * @route GET /api/ledger/customer/:customer_id/invoices
 */
export const getCustomerInvoices = async (req, res) => {
  try {
    const { customer_id } = req.params;

    const data = await sequelize.query(`
      SELECT 
        id,
        invoice_number,
        invoice_date,
        total_amount,
        received_amount,
        pending_amount

      FROM invoices
      WHERE customer_id = :customer_id
      ORDER BY invoice_date DESC
    `, {
      replacements: { customer_id },
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


/**
 * @desc Get Payment History (READ ONLY for HO)
 * @route GET /api/ledger/invoice/:invoice_id/payments
 */
export const getInvoicePayments = async (req, res) => {
  try {
    const { invoice_id } = req.params;

    const data = await sequelize.query(`
      SELECT 
        payment_date AS date,
        amount AS received_amount,
        payment_method,
        txn_id,
        operator

      FROM payments
      WHERE invoice_id = :invoice_id
      ORDER BY payment_date DESC
    `, {
      replacements: { invoice_id },
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
/**
 * @desc Export Dashboard + All Stores Ledger Excel
 * @route GET /api/dashboard/export-complete
 */


/**
 * @desc Export Dashboard + All Stores Ledger (Single Sheet)
 * @route GET /api/head-ledger/dashboard/export-complete
 */
export const exportDashboardAndLedgerExcel = async (req, res) => {
  try {

    // ================= DASHBOARD DATA =================
    const dashboardData = await sequelize.query(`
      SELECT 
        COALESCE(SUM(total_amount),0) AS total_sales,
        COALESCE(SUM(received_amount),0) AS received,
        COALESCE(SUM(pending_amount),0) AS pending
      FROM invoices
    `, { type: QueryTypes.SELECT });

    const dashboard = dashboardData[0];

    // ================= LEDGER DATA =================
    const ledger = await sequelize.query(`
      SELECT 
        st.store_code,
        st.store_name,
        st.organization_level,

        COUNT(DISTINCT inv.id) AS total_deals,
        COALESCE(SUM(inv.total_amount), 0) AS total_amount,
        COALESCE(SUM(inv.received_amount), 0) AS received_amount,
        COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

      FROM stores st
      LEFT JOIN invoices inv 
        ON st.store_code = inv.store_code

     
      WHERE LOWER(st.organization_level::text) IN ('district', 'retail')

      GROUP BY st.id
      ORDER BY st.organization_level DESC, st.store_name
    `, { type: QueryTypes.SELECT });

    // ================= EXCEL =================
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Dashboard Report");

    // -------- TITLE --------
    sheet.mergeCells("A1:G1");
    sheet.getCell("A1").value = "Dashboard & Ledger Report";
    sheet.getCell("A1").font = { size: 16, bold: true };
    sheet.getCell("A1").alignment = { horizontal: "center" };

    // -------- DASHBOARD SECTION --------
    sheet.addRow([]);
    sheet.addRow(["Dashboard Cards"]);
    sheet.getRow(3).font = { bold: true };

    const dashHeader = sheet.addRow(["Metric", "Value"]);
    dashHeader.font = { bold: true };

    sheet.addRow(["Total Sales", dashboard.total_sales]);
    sheet.addRow(["Total Revenue", dashboard.received]);
    sheet.addRow(["Total Profit", dashboard.received]);
    sheet.addRow(["Loss", dashboard.pending]);
    sheet.addRow(["Collectable Amount", dashboard.pending]);

    // -------- GAP --------
    sheet.addRow([]);
    sheet.addRow([]);

    // -------- LEDGER SECTION --------
    sheet.addRow(["All Stores Ledger"]);
    sheet.getRow(sheet.lastRow.number).font = { bold: true };

    const ledgerHeader = sheet.addRow([
      "Store Code",
      "Store Name",
      "Organization Level",
      "Total Deals",
      "Total Amount",
      "Received Amount",
      "Pending Amount"
    ]);

    ledgerHeader.font = { bold: true };

    // DATA
    ledger.forEach((l) => {
      sheet.addRow([
        l.store_code,
        l.store_name,
        l.organization_level,
        l.total_deals,
        l.total_amount,
        l.received_amount,
        l.pending_amount
      ]);
    });

    // -------- AUTO WIDTH --------
    sheet.columns.forEach(col => col.width = 22);

    // ================= RESPONSE =================
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=dashboard-ledger.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error("EXPORT ERROR:", error);
    res.status(500).json({ error: error.message });
  }
};
