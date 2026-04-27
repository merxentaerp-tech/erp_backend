import  sequelize from "../config/db.js";
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
 * @desc Get Dashboard Cards Data
 * @route GET /api/dashboard/cards
 */
export const getDashboardCards = async (req, res) => {
  try {

    //  Current Month
    const current = await sequelize.query(`
      SELECT 
        COALESCE(SUM(total_amount),0) AS total_sales,
        COALESCE(SUM(received_amount),0) AS received,
        COALESCE(SUM(pending_amount),0) AS pending
      FROM invoices
      WHERE DATE_TRUNC('month', invoice_date) = DATE_TRUNC('month', CURRENT_DATE)
    `, { type: QueryTypes.SELECT });

    // Previous Month
    const previous = await sequelize.query(`
      SELECT 
        COALESCE(SUM(total_amount),0) AS total_sales,
        COALESCE(SUM(received_amount),0) AS received,
        COALESCE(SUM(pending_amount),0) AS pending
      FROM invoices
      WHERE DATE_TRUNC('month', invoice_date) = 
            DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
    `, { type: QueryTypes.SELECT });

    const curr = current[0];
    const prev = previous[0];

 
    const totalSales = Number(curr.total_sales);
    const totalRevenue = Number(curr.received);
    const collectable = Number(curr.pending);

    const totalProfit = totalRevenue;
    const loss = collectable;

    
    const calcPercent = (curr, prev) => {
      if (prev === 0 && curr === 0) return 0;   // no change
      if (prev === 0) return null;              // no previous data
      return Number((((curr - prev) / prev) * 100).toFixed(1));
    };

    const response = {
      totalSales: {
        value: totalSales,
        change: calcPercent(totalSales, Number(prev.total_sales))
      },
      loss: {
        value: loss,
        change: calcPercent(loss, Number(prev.pending))
      },
      totalProfit: {
        value: totalProfit,
        change: calcPercent(totalProfit, Number(prev.received))
      },
      totalRevenue: {
        value: totalRevenue,
        change: calcPercent(totalRevenue, Number(prev.received))
      },
      collectableAmount: {
        value: collectable,
        change: calcPercent(collectable, Number(prev.pending))
      }
    };

    res.json({ success: true, data: response });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
/**
 * @desc Get ALL Stores Ledger (District + Retail)
 * @route GET /api/ledger/stores
 * @access Head Office (Read Only)
 */
export const getAllStoresLedger = async (req, res) => {
  try {
    const data = await sequelize.query(`
      SELECT 
        st.id,  -- 
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

      WHERE st.organization_level IN ('District', 'Retail')

      GROUP BY st.id
      ORDER BY st.organization_level DESC, st.store_name
    `, { type: QueryTypes.SELECT });

    res.json({ success: true, data });

  } catch (error) {
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
      return res.status(400).json({ error: "store_code is required" });
    }

    const data = await sequelize.query(`
      SELECT 
        c.id AS customer_id,
        c.name AS client_name,

        COUNT(inv.id) AS total_deals,

        COALESCE(SUM(inv.total_amount), 0) AS total_amount,
        COALESCE(SUM(inv.received_amount), 0) AS received_amount,
        COALESCE(SUM(inv.pending_amount), 0) AS pending_amount

      FROM customers c
      LEFT JOIN invoices inv 
        ON c.id = inv.customer_id
        AND inv.store_code = :store_code

      WHERE c.store_code = :store_code

      GROUP BY c.id
      ORDER BY client_name
    `, {
      replacements: { store_code },
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
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