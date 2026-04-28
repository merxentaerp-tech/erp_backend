import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";

// ==============================
//  GET INVOICE FOR EXCHANGE
// ==============================
export const getInvoiceForExchange = async (req, res) => {
  try {
    const { invoice_number } = req.params;

    const storeCode = req.user.store_code; // ✅ FIX

    const data = await sequelize.query(
      `
      SELECT 
        i.id,
        i.invoice_number,
        c.name,
        c.phone,

        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        ii.product_code,
        ii.description,
        ii.purity,
        ii.gross_weight,
        ii.net_weight,
        ii.stone_weight,
        ii.total_amount

      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id

      LEFT JOIN LATERAL (
        SELECT * FROM exchange_logs 
        WHERE invoice_id = i.id 
        ORDER BY id DESC LIMIT 1
      ) e ON true

      LEFT JOIN invoice_items ii ON ii.invoice_id = i.id

      WHERE i.invoice_number = :invoice_number
      AND i.store_code = :store_code   

      LIMIT 1
      `,
      {
        replacements: { invoice_number, store_code: storeCode },
        type: QueryTypes.SELECT
      }
    );

    if (!data.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const item = data[0];

    const original_product = item.old_product_code
      ? {
          product_code: item.old_product_code,
          product_name: item.old_product_name,
          purity: item.old_purity,
          gross_weight: item.old_gross_weight,
          net_weight: item.old_net_weight,
          stone_weight: item.old_stone_weight,
          value: item.old_value
        }
      : {
          product_code: item.product_code,
          product_name: item.description,
          purity: item.purity,
          gross_weight: item.gross_weight,
          net_weight: item.net_weight,
          stone_weight: item.stone_weight,
          value: item.total_amount
        };

    return res.json({
      success: true,
      data: {
        invoice_id: item.id,
        invoice_number: item.invoice_number,
        customer_name: item.name,
        phone: item.phone,
        original_product
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// ==============================
//  CREATE EXCHANGE
// ==============================
export const createExchange = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const {
      invoice_number,
      original_product,
      new_product,
      making_charge = 0,
      stone_amount = 0
    } = req.body;

    const storeCode = req.user.store_code; // ✅ FIX

    const invoice = await sequelize.query(
      `
      SELECT *
      FROM invoices
      WHERE invoice_number = :invoice_number
      AND store_code = :store_code
      LIMIT 1 FOR UPDATE
      `,
      {
        replacements: {
          invoice_number,
          store_code: storeCode
        },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!invoice.length) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found for this store"
      });
    }

    const inv = invoice[0];

    if (!original_product?.item_id || !new_product?.item_id) {
      throw new Error("Item ID missing");
    }

    const customer = await sequelize.query(
      `SELECT id, name, phone FROM customers WHERE id = :id`,
      {
        replacements: { id: inv.customer_id },
        type: QueryTypes.SELECT
      }
    );

    const customerData = customer[0] || {};

    const daysResult = await sequelize.query(
      `SELECT DATE_PART('day', NOW() - invoice_date) AS days FROM invoices WHERE id = :id`,
      {
        replacements: { id: inv.id },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    const days = parseInt(daysResult[0].days);

    const oldValue = parseFloat(original_product.value || 0);
    const newValue = parseFloat(new_product.value || 0);

    if (oldValue <= 0 || newValue <= 0) {
      throw new Error("Invalid values");
    }

    const oldCondition = original_product.condition || "UNKNOWN";
    const newCondition = new_product.condition || "NEW";

    let makingCharges = days <= 7 ? 0 : making_charge + stone_amount;

    const finalAmount = newValue + makingCharges;
    const difference = finalAmount - oldValue;

    const countResult = await sequelize.query(
      `SELECT COUNT(*) as count FROM exchange_logs WHERE invoice_id = :id`,
      {
        replacements: { id: inv.id },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    const count = parseInt(countResult[0].count) + 1;
    const suffix = inv.invoice_number.split("-").pop();

    const exchangeInvoiceNo = `EX-${inv.store_code}-${suffix}-${String(count).padStart(2, "0")}`;

    const exchangeInvoiceResult = await sequelize.query(
      `
      INSERT INTO invoices (
        invoice_number,
        customer_id,
        total_amount,
        received_amount,
        pending_amount,
        status,
        invoice_date,
        organization_id,
        created_by,
        store_code,
        is_exchange,
        parent_invoice_id,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        :invoice_number,
        :customer_id,
        :amount,
        0,
        :amount,
        'UNPAID',
        NOW(),
        :org_id,
        :created_by,
        :store_code,
        true,
        :parent_id,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      {
        replacements: {
          invoice_number: exchangeInvoiceNo,
          customer_id: inv.customer_id,
          amount: Math.abs(difference),
          org_id: inv.organization_id,
          created_by: inv.created_by,
          store_code: inv.store_code,
          parent_id: inv.id
        },
        type: QueryTypes.INSERT,
        transaction: t
      }
    );

    const exchangeInvoice = exchangeInvoiceResult[0][0];

    await sequelize.query(
      `
      INSERT INTO exchange_logs (
        invoice_id,
        old_product_code, old_product_name, old_condition, old_value,
        new_product_code, new_product_name, new_condition, new_value,
        difference, making_charges,
        "createdAt", "updatedAt"
      )
      VALUES (
        :invoice_id,
        :old_code, :old_name, :old_condition, :old_value,
        :new_code, :new_name, :new_condition, :new_value,
        :difference, :making_charges,
        NOW(), NOW()
      )
      `,
      {
        replacements: {
          invoice_id: inv.id,
          old_code: original_product.product_code,
          old_name: original_product.product_name,
          old_condition: oldCondition,
          old_value: oldValue,
          new_code: new_product.product_code,
          new_name: new_product.product_name,
          new_condition: newCondition,
          new_value: newValue,
          difference,
          making_charges: makingCharges
        },
        transaction: t
      }
    );

    await t.commit();

    return res.json({
      success: true,
      message: "Exchange Done",
      data: {
        invoice_number: inv.invoice_number,
        customer: {
          id: customerData.id,
          name: customerData.name,
          phone: customerData.phone
        },
        old_product: {
          name: original_product.product_name,
          condition: oldCondition,
          value: oldValue
        },
        new_product: {
          name: new_product.product_name,
          condition: newCondition,
          value: newValue
        },
        calculation: {
          making_charges: makingCharges,
          final_amount: finalAmount,
          difference: difference
        },
        original_invoice: {
          invoice_number: inv.invoice_number,
          total_amount: oldValue
        },
        exchange_invoice: {
          invoice_number: exchangeInvoiceNo,
          total_amount: Math.abs(difference),
        }
      }
    });

  } catch (error) {
    await t.rollback();

    return res.status(500).json({
      success: false,
      message: "Exchange Failed",
      error: error.message
    });
  }
};

// ==============================
//  GET EXCHANGE DASHBOARD
// ==============================
export const getExchangeDashboard = async (req, res) => {
  try {
    const { filter = "all" } = req.query;

    const storeCode = req.user.store_code; // ✅ FIX

    let dateFilter = "";

    if (filter === "day") {
      dateFilter = `AND DATE(e.createdat) = CURRENT_DATE`;
    } else if (filter === "week") {
      dateFilter = `AND e.createdat >= NOW() - INTERVAL '7 days'`;
    } else if (filter === "month") {
      dateFilter = `AND DATE_TRUNC('month', e.createdat) = DATE_TRUNC('month', CURRENT_DATE)`;
    }

    const list = await sequelize.query(
      `
      SELECT 
        e.id,
        i.invoice_number,
        c.name,
        c.phone,
        i.invoice_date,
        e.createdat AS exchange_date,
        FLOOR(DATE_PART('day', NOW() - i.invoice_date)) AS days_since_purchase,

        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        e.new_product_code,
        e.new_product_name,
        e.new_purity,
        e.new_gross_weight,
        e.new_net_weight,
        e.new_stone_weight,
        e.new_value,

        e.making_charges,
        e.difference

      FROM exchange_logs e
      JOIN invoices i ON e.invoice_id = i.id
      LEFT JOIN customers c ON i.customer_id = c.id

      WHERE 1=1
      AND i.store_code = :store_code
      ${dateFilter}

      ORDER BY e.createdat DESC
      `,
      {
        replacements: { store_code: storeCode },
        type: QueryTypes.SELECT
      }
    );

    const stats = await sequelize.query(
      `
      SELECT 
        COUNT(*) AS total_exchanges,
        COUNT(CASE WHEN DATE_PART('day', NOW() - i.invoice_date) <= 7 THEN 1 END) AS within_7_days,
        COUNT(CASE WHEN DATE_PART('day', NOW() - i.invoice_date) > 7 THEN 1 END) AS after_7_days,
        COALESCE(SUM(e.making_charges), 0) AS making_charges

      FROM exchange_logs e
      JOIN invoices i ON e.invoice_id = i.id

      WHERE 1=1
      AND i.store_code = :store_code
      ${dateFilter}
      `,
      {
        replacements: { store_code: storeCode },
        type: QueryTypes.SELECT
      }
    );

    return res.json({
      success: true,
      stats: {
        total_exchanges: parseInt(stats[0].total_exchanges),
        within_7_days: parseInt(stats[0].within_7_days),
        after_7_days: parseInt(stats[0].after_7_days),
        making_charges: parseFloat(stats[0].making_charges)
      },
      count: list.length,
      data: list
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
