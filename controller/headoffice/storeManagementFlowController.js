import Store from "../models/Store.js"; 
import sequelize from "../config/db.js";

export const getStoreSummaryCards = async (req, res) => {
  try {
    const { district_id } = req.query;

    let filter = "";
    if (district_id) {
      filter = `WHERE st.district_id = ${Number(district_id)}`;
    }

    const data = await sequelize.query(`
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

      ${filter}
    `);

    const result = data[0][0];

    res.json({
      success: true,
      data: {
        totalStores: Number(result.total_stores),
        activeStores: Number(result.active_stores),
        totalEmployees: Number(result.total_employees),
        totalRevenue: Number(result.total_revenue),
      },
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getDistricts = async (req, res) => {
  try {
    const data = await Store.findAll({
      where: { organizationlevel: "District" },
      attributes: ["id", "store_name", "store_code"]
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getDistrictInventory = async (req, res) => {
  try {
    const { district_id } = req.params;

    const data = await sequelize.query(`
      SELECT 
        i.category,
        i.sku_code,
        SUM(s.available_qty) as quantity,
        i.rate as selling_price,
        i.making_charge,
        i.purity,
        SUM(i.net_weight) as net_weight,
        SUM(i.gross_weight) as gross_weight
      FROM items i
      JOIN stocks s ON i.id = s.item_id
      JOIN stores st ON st.id = s.organization_id
      WHERE st.district_id = :district_id
      GROUP BY i.category, i.sku_code, i.rate, i.making_charge, i.purity
    `, {
      replacements: { district_id },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getRetailStores = async (req, res) => {
  try {
    const { district_id } = req.params;

    const data = await Store.findAll({
      where: {
        district_id,
        organizationlevel: "Retail"
      },
      attributes: ["id", "store_name", "store_code"]
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getStoreInventory = async (req, res) => {
  try {
    const { store_id } = req.params;
    const { category } = req.query;

    let condition = `WHERE s.organization_id = :store_id`;

    if (category) {
      condition += ` AND i.category = :category`;
    }

    const data = await sequelize.query(`
      SELECT 
        i.item_name,
        i.sku_code,
        s.available_qty as quantity,
        i.rate,
        i.making_charge,
        i.purity,
        i.net_weight,
        i.gross_weight
      FROM items i
      JOIN stocks s ON i.id = s.item_id
      ${condition}
    `, {
      replacements: { store_id, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};