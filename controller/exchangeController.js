import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";


// ==============================
//  GET INVOICE FOR EXCHANGE
// ==============================
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

    const storeCode =
      req.user?.store_code ||
      req.user?.storeCode ||
      req.headers.store_code;

    if (!storeCode) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Store code missing in token"
      });
    }

    // 🔒 LOCK INVOICE
    const invoice = await sequelize.query(
      `
      SELECT *
      FROM invoices
      WHERE invoice_number = :invoice_number
      AND store_code = :store_code
      LIMIT 1 FOR UPDATE
      `,
      {
        replacements: { invoice_number, store_code: storeCode },
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

    // 👤 CUSTOMER
    const customer = await sequelize.query(
      `SELECT id, name, phone FROM customers WHERE id = :customer_id`,
      {
        replacements: { customer_id: inv.customer_id },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    const customerData = customer[0] || {};

    // 📦 ITEMS
    const items = await sequelize.query(
      `
      SELECT id, product_code, description, total_amount, item_id
      FROM invoice_items
      WHERE invoice_id = :invoice_id AND is_active = true
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

    // ✅ VALIDATION (UPDATED)
    const normalize = (str) =>
      str?.toString().trim().toLowerCase().replace(/\s+/g, " ");

    const matchedItem = items.find((item) => {
      return normalize(item.product_code) === normalize(original_product.product_code);
    });

    if (!matchedItem) {
      await t.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid product details for this invoice"
      });
    }

    // 🧮 CALCULATIONS (UPDATED 🔥)
    const diffDays = Math.floor(
      (new Date() - new Date(inv.invoice_date)) / (1000 * 60 * 60 * 24)
    );

    const isFree = diffDays <= 7;

    const oldValue = parseFloat(original_product.value || 0);
    const newValue = parseFloat(new_product.value || 0);

    const makingCharges = isFree ? 0 : (making_charge + stone_amount);

    // 🔥 CORE CHANGE
    const difference = newValue - oldValue;

    const finalAmount = newValue + makingCharges;

    // 🧾 UPDATE INVOICE (UNCHANGED)
    await sequelize.query(
      `
      UPDATE invoices
      SET 
        total_amount = :finalAmount,
        pending_amount = GREATEST(:difference, 0),
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

    // ❌ SOFT DELETE OLD ITEM
    await sequelize.query(
      `UPDATE invoice_items SET is_active = false WHERE id = :item_id`,
      {
        replacements: { item_id: matchedItem.id },
        transaction: t
      }
    );

    // ➕ INSERT NEW ITEM
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
        is_active,
        item_id,
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
        true,
        (SELECT id FROM items WHERE article_code = :product_code LIMIT 1),
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
            ? parseFloat((newValue / new_product.net_weight).toFixed(2))
            : 0,
          total_amount: finalAmount
        },
        transaction: t
      }
    );

    // 🔢 EXCHANGE NUMBER
    const countData = await sequelize.query(
      `SELECT COUNT(*) as count FROM exchange_logs WHERE invoice_id = :invoice_id`,
      {
        replacements: { invoice_id: inv.id },
        type: QueryTypes.SELECT,
        transaction: t
      }
    );

    const exchangeNumber = String(parseInt(countData[0].count) + 1).padStart(2, "0");
    const exchangeInvoiceNumber = `EX-${inv.invoice_number.replace("BILL-", "")}-${exchangeNumber}`;

    // 🧾 CREATE EXCHANGE INVOICE
    await sequelize.query(
      `
      INSERT INTO invoices (
        invoice_number,
        customer_id,
        total_amount,
        received_amount,
        pending_amount,
        status,
        invoice_date,
        store_code,
        created_by,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        :invoice_number,
        :customer_id,
        :total_amount,
        0,
        :pending_amount,
        'UNPAID',
        NOW(),
        :store_code,
        :created_by,
        NOW(),
        NOW()
      )
      `,
      {
        replacements: {
          invoice_number: exchangeInvoiceNumber,
          customer_id: inv.customer_id,
          total_amount: Math.abs(difference),
          pending_amount: Math.abs(difference),
          store_code: storeCode,
          created_by: req.user?.id || null
        },
        transaction: t
      }
    );

    // 📊 SAVE LOG (UNCHANGED)
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

    // 📒 LEDGER ENTRY
    const entryType = difference > 0 ? "DEBIT" : "CREDIT";

    await sequelize.query(
      `
      INSERT INTO ledger_entries (
        customer_id,
        type,
        amount,
        reference_type,
        reference_id,
        description,
        "createdAt",
        "updatedAt"
      )
      VALUES (
        :customer_id,
        :type,
        :amount,
        'EXCHANGE',
        :invoice_id,
        :desc,
        NOW(),
        NOW()
      )
      `,
      {
        replacements: {
          customer_id: inv.customer_id,
          type: entryType,
          amount: Math.abs(difference),
          invoice_id: inv.id,
          desc: `Exchange for invoice ${inv.invoice_number}`
        },
        transaction: t
      }
    );

    await t.commit();

    // ✅ RESPONSE (UNCHANGED)
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
          condition: original_product.condition || "OLD",
          value: oldValue
        },
        new_product: {
          name: new_product.product_name,
          condition: new_product.condition || "NEW",
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
          invoice_number: exchangeInvoiceNumber,
          total_amount: Math.abs(difference)
        }
      }
    });

  } catch (err) {
    await t.rollback();
    return res.status(500).json({ error: err.message });
  }
};
export const getExchangeDashboard = async (req, res) => {
  try {
    const { filter = "all" } = req.query;

    const storeCode =
      req.user?.store_code ||
      req.user?.storeCode ||
      req.headers.store_code;

    if (!storeCode) {
      return res.status(400).json({
        success: false,
        message: "Store code missing (token ya header me bhejo)"
      });
    }

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

        CONCAT(
          'EXG-',
          TO_CHAR(e.createdat, 'YYYY-MM'),
          '-',
          LPAD(
            ROW_NUMBER() OVER (
              PARTITION BY DATE_TRUNC('month', e.createdat)
              ORDER BY e.createdat
            )::text,
            3,
            '0'
          )
        ) AS exchange_number,

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

        -- 🔥 FIX APPLIED HERE ONLY
        COALESCE(
          SUM(
            CASE 
              WHEN DATE_PART('day', NOW() - i.invoice_date) > 7 
              THEN e.making_charges
              ELSE 0
            END
          ), 
        0) AS making_charges

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
