
import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";


export const getInvoiceForExchange = async (req, res) => {
  try {
    const { invoice_number } = req.params;

    const data = await sequelize.query(
      `
      SELECT 
        i.id,
        i.invoice_number,
        c.name,
        c.phone,

        -- OLD FROM LOG
        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        -- FALLBACK FROM INVOICE ITEM
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
      LIMIT 1
      `,
      {
        replacements: { invoice_number },
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

    // ======================
    // 1. LOCK INVOICE
    // ======================
    const invoice = await sequelize.query(
      `
      SELECT *
      FROM invoices
      WHERE invoice_number = :invoice_number
      LIMIT 1 FOR UPDATE
      `,
      {
        replacements: { invoice_number },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!invoice.length) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Invoice not found"
      });
    }

    const inv = invoice[0];

    // ======================
    // 2. CUSTOMER
    // ======================
    const customer = await sequelize.query(
      `
      SELECT id, name, phone
      FROM customers
      WHERE id = :customer_id
      `,
      {
        replacements: { customer_id: inv.customer_id },
        type: QueryTypes.SELECT
      }
    );

    const customerData = customer[0] || {};

    // ======================
    // 3. FETCH ITEMS
    // ======================
    const items = await sequelize.query(
      `
      SELECT id, product_code, description, total_amount
      FROM invoice_items
      WHERE invoice_id = :invoice_id
      `,
      {
        replacements: { invoice_id: inv.id },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    if (!items.length) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "No items found for this invoice"
      });
    }

    // ======================
    // 4. VALIDATION
    // ======================
    const normalize = (str) =>
      str?.toString().trim().toLowerCase().replace(/\s+/g, " ");

    const userValue = parseFloat(original_product.value || 0);

    const matchedItem = items.find((item) => {
      const dbValue = parseFloat(item.total_amount || 0);

      return (
        normalize(item.product_code) === normalize(original_product.product_code) &&
        normalize(item.description) === normalize(original_product.product_name) &&
        Math.abs(dbValue - userValue) < 1
      );
    });

    if (!matchedItem) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid product details for this invoice"
      });
    }

    // ======================
    // 5. CALCULATIONS
    // ======================
    const diffDays = Math.floor(
      (new Date() - new Date(inv.invoice_date)) / (1000 * 60 * 60 * 24)
    );

    const isFree = diffDays <= 7;

    const oldValue = userValue;
    const newValue = parseFloat(new_product.value || 0);

    const makingCharges = isFree ? 0 : (making_charge + stone_amount);

    const finalAmount = newValue + makingCharges;
    const difference = finalAmount - oldValue;

    // ======================
    // 6. UPDATE INVOICE (ENUM FIX)
    // ======================
    await sequelize.query(
      `
      UPDATE invoices
      SET 
        total_amount = :finalAmount,
        pending_amount = :difference,
        is_exchanged = TRUE,
        "updatedAt" = NOW(),
        status = CASE
          WHEN :difference <= 0 THEN 'PAID'::enum_invoices_status
          ELSE 'PARTIAL'::enum_invoices_status
        END
      WHERE id = :invoice_id
      `,
      {
        replacements: {
          finalAmount,
          difference,
          invoice_id: inv.id
        },
        transaction: t
      }
    );

    // ======================
    // 7. DELETE OLD ITEM
    // ======================
    await sequelize.query(
      `DELETE FROM invoice_items WHERE id = :item_id`,
      {
        replacements: { item_id: matchedItem.id },
        transaction: t
      }
    );

    // ======================
    // 8. INSERT NEW ITEM
    // ======================
    await sequelize.query(
      `
      INSERT INTO invoice_items (
        invoice_id,
        product_code,
        description,
        purity,
        gross_weight,
        net_weight,
        stone_weight,
        rate,
        total_amount,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        :invoice_id,
        :product_code,
        :description,
        :purity,
        :gross_weight,
        :net_weight,
        :stone_weight,
        :rate,
        :total_amount,
        NOW(),
        NOW()
      )
      `,
      {
        replacements: {
          invoice_id: inv.id,
          product_code: new_product.product_code,
          description: new_product.product_name,
          purity: new_product.purity,
          gross_weight: new_product.gross_weight,
          net_weight: new_product.net_weight,
          stone_weight: new_product.stone_weight || 0,
          rate: new_product.net_weight
            ? newValue / new_product.net_weight
            : 0,
          total_amount: finalAmount
        },
        transaction: t
      }
    );

    // ======================
    // 9. SAVE LOG
    // ======================
    await sequelize.query(
      `
      INSERT INTO exchange_logs (
        invoice_id,
        old_product_code,
        old_product_name,
        old_purity,
        old_gross_weight,
        old_net_weight,
        old_stone_weight,
        old_value,
        new_product_code,
        new_product_name,
        new_purity,
        new_gross_weight,
        new_net_weight,
        new_stone_weight,
        new_value,
        difference,
        making_charges,
        createdat,
        updatedat
      )
      VALUES (
        :invoice_id,
        :old_product_code,
        :old_product_name,
        :old_purity,
        :old_gross_weight,
        :old_net_weight,
        :old_stone_weight,
        :old_value,
        :new_product_code,
        :new_product_name,
        :new_purity,
        :new_gross_weight,
        :new_net_weight,
        :new_stone_weight,
        :new_value,
        :difference,
        :making_charges,
        NOW(),
        NOW()
      )
      `,
      {
        replacements: {
          invoice_id: inv.id,
          old_product_code: original_product.product_code,
          old_product_name: original_product.product_name,
          old_purity: original_product.purity,
          old_gross_weight: original_product.gross_weight,
          old_net_weight: original_product.net_weight,
          old_stone_weight: original_product.stone_weight,
          old_value: oldValue,
          new_product_code: new_product.product_code,
          new_product_name: new_product.product_name,
          new_purity: new_product.purity,
          new_gross_weight: new_product.gross_weight,
          new_net_weight: new_product.net_weight,
          new_stone_weight: new_product.stone_weight,
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
      message: "Exchange Completed Successfully",
      data: {
        invoice_number: inv.invoice_number,
        customer_id: customerData.id,
        customer_name: customerData.name,
        phone: customerData.phone,
        final_amount: finalAmount,
        difference,
        making_charges: makingCharges,
        is_free: isFree
      }
    });

  } catch (err) {
    await t.rollback();
    return res.status(500).json({
      success: false,
      message: "Exchange Failed",
      error: err.message
    });
  }
};

// ==============================
//  GET EXCHANGE LIST (DASHBOARD)
// ==============================
export const getExchangeDashboard = async (req, res) => {
  try {
    const { filter = "all" } = req.query;

    let dateFilter = "";

    //  FILTER LOGIC
    if (filter === "day") {
      dateFilter = `AND DATE(e.createdat) = CURRENT_DATE`;
    } else if (filter === "week") {
      dateFilter = `AND e.createdat >= NOW() - INTERVAL '7 days'`;
    } else if (filter === "month") {
      dateFilter = `AND DATE_TRUNC('month', e.createdat) = DATE_TRUNC('month', CURRENT_DATE)`;
    }

    // ============================
    // LIST DATA
    // ============================
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

        -- OLD
        e.old_product_code,
        e.old_product_name,
        e.old_purity,
        e.old_gross_weight,
        e.old_net_weight,
        e.old_stone_weight,
        e.old_value,

        -- NEW
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
      ${dateFilter}

      ORDER BY e.createdat DESC
      `,
      { type: QueryTypes.SELECT }
    );

    // ============================
    //  STATS DATA
    // ============================
    const stats = await sequelize.query(
      `
      SELECT 
        COUNT(*) AS total_exchanges,

        COUNT(
          CASE 
            WHEN DATE_PART('day', NOW() - i.invoice_date) <= 7 
            THEN 1 
          END
        ) AS within_7_days,

        COUNT(
          CASE 
            WHEN DATE_PART('day', NOW() - i.invoice_date) > 7 
            THEN 1 
          END
        ) AS after_7_days,

        COALESCE(SUM(e.making_charges), 0) AS making_charges

      FROM exchange_logs e
      JOIN invoices i ON e.invoice_id = i.id

      WHERE 1=1
      ${dateFilter}
      `,
      { type: QueryTypes.SELECT }
    );

    return res.json({
      success: true,

      //  SAME STRUCTURE + MERGED
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