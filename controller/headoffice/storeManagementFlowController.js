import Store from "../../model/Store.js";
import sequelize from "../../config/db.js";

// ================= SUMMARY CARDS (UNCHANGED) =================
export const getStoreDashboard = async (req, res) => {
  try {
    // ================= SUMMARY =================
    const summaryData = await sequelize.query(`
      SELECT 
        COUNT(DISTINCT st.id) AS total_stores,

        COUNT(DISTINCT CASE 
          WHEN st.is_active = true THEN st.id 
        END) AS active_stores,

        COUNT(DISTINCT u.id) AS total_employees,

        COALESCE(SUM(inv.total_amount), 0) AS total_revenue

      FROM stores st

      LEFT JOIN users u 
        ON u.store_code = st.store_code

      LEFT JOIN invoices inv 
        ON inv.store_code = st.store_code
    `);

    const summary = summaryData[0][0];

    // ================= DISTRICTS =================
    const districts = await Store.findAll({
      where: { organization_level: "District" },
      attributes: ["id", "store_name", "store_code"]
    });

    // ================= FINAL RESPONSE =================
    res.json({
      success: true,
      data: {
        summary: {
          totalStores: Number(summary.total_stores),
          activeStores: Number(summary.active_stores),
          totalEmployees: Number(summary.total_employees),
          totalRevenue: Number(summary.total_revenue),
        },
        districts
      }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= DISTRICT INVENTORY =================
export const getDistrictInventory = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    let condition = `WHERE st.store_code = :store_code`;

    if (category) {
      condition += ` AND i.category = :category`;
    }

    // CATEGORY VIEW
    if (!category) {
      const data = await sequelize.query(`
        SELECT 
          i.category,
          '-' as code,
          COUNT(*) as quantity,
          0 as selling_price,
          0 as making_charge,
          '-' as purity,
          SUM(i.net_weight) as net_weight,
          SUM(i.stone_weight) as stone_weight,
          SUM(i.gross_weight) as gross_weight

        FROM items i
        JOIN stores st ON st.id = i.store_id

        ${condition}

        GROUP BY i.category
      `, {
        replacements: { store_code },
        type: sequelize.QueryTypes.SELECT
      });

      return res.json({ success: true, data });
    }

    //  ITEM VIEW
    const data = await sequelize.query(`
      SELECT 
        i.category,
        i.sku_code as code,
        COUNT(*) as quantity,
        i.sale_rate as selling_price,
        i.making_charge,
        i.purity,
        SUM(i.net_weight) as net_weight,
        SUM(i.stone_weight) as stone_weight,
        SUM(i.gross_weight) as gross_weight

      FROM items i
      JOIN stores st ON st.id = i.store_id

      ${condition}

      GROUP BY 
        i.category,
        i.sku_code,
        i.sale_rate,
        i.making_charge,
        i.purity
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= RETAIL STORES =================
export const getRetailStores = async (req, res) => {
  try {
    const { store_code } = req.params;

    const data = await sequelize.query(`
      SELECT id, store_name, store_code
      FROM stores
      WHERE district_id = (
        SELECT id FROM stores WHERE store_code = :store_code
      )
      AND organization_level = 'Retail' 
    `, {
      replacements: { store_code },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// ================= STORE INVENTORY =================
export const getStoreInventory = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    //  CATEGORY VIEW
    if (!category) {
      const data = await sequelize.query(`
        SELECT 
          i.category,
          '-' as code,
          COUNT(*) as quantity,
          0 as selling_price,
          0 as making_charge,
          '-' as purity,
          SUM(i.net_weight) as net_weight,
          SUM(i.stone_weight) as stone_weight,
          SUM(i.gross_weight) as gross_weight
        FROM items i
        JOIN stores st ON st.id = i.store_id
        WHERE st.store_code = :store_code
        GROUP BY i.category
        ORDER BY i.category
      `, {
        replacements: { store_code },
        type: sequelize.QueryTypes.SELECT
      });

      return res.json({ success: true, data });
    }

    //  ITEM VIEW
    const data = await sequelize.query(`
      SELECT 
        i.item_name,
        i.sku_code as code,
        COUNT(*) as quantity,
        i.sale_rate as selling_price,
        i.making_charge,
        i.purity,
        SUM(i.net_weight) as net_weight,
        SUM(i.stone_weight) as stone_weight,
        SUM(i.gross_weight) as gross_weight
      FROM items i
      JOIN stores st ON st.id = i.store_id
      WHERE st.store_code = :store_code
      AND i.category = :category
      GROUP BY 
        i.item_name,
        i.sku_code,
        i.sale_rate,
        i.making_charge,
        i.purity
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};