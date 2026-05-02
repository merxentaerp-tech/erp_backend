import Store from "../../model/Store.js";
import sequelize from "../../config/db.js";
import { Op } from "sequelize";
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

    // ================= CATEGORY VIEW =================
    if (!category) {
      const data = await sequelize.query(`
        SELECT 
          i.category,

          MIN(i.sku_code) as code,                         -- ✅ real code
          COUNT(i.id) as quantity,                         -- ✅ correct count

          AVG(i.sale_rate)::numeric(10,2) as selling_price,   -- ✅ avg price
          AVG(i.making_charge)::numeric(10,2) as making_charge,

          MIN(i.purity) as purity,                         -- ✅ representative purity

          SUM(i.net_weight) as net_weight,
          SUM(i.stone_weight) as stone_weight,
          SUM(i.gross_weight) as gross_weight

        FROM items i
        JOIN stores st ON st.id = i.store_id

        ${condition}

        GROUP BY i.category
        ORDER BY i.category
      `, {
        replacements: { store_code },
        type: sequelize.QueryTypes.SELECT
      });

      return res.json({ success: true, data });
    }

    // ================= ITEM VIEW =================
    const data = await sequelize.query(`
      SELECT 
        i.item_name as article,              
        i.sku_code as code,
        1 as quantity,                        

        i.sale_rate as selling_price,
        i.making_charge,
        i.purity,

        i.net_weight,
        i.stone_weight,
        i.gross_weight

      FROM items i
      JOIN stores st ON st.id = i.store_id

      ${condition}

      ORDER BY i."createdAt" DESC             
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getDistrictCategoryItems = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const data = await sequelize.query(`
      SELECT       
        i.item_name as article,            
        i.sku_code as code,               
        1 as quantity,                     
        i.sale_rate as selling_price,      
        i.making_charge,                 
        i.purity,                         
        i.net_weight,                     
        i.stone_weight,                  
        i.gross_weight                   

      FROM items i
      JOIN stores st ON st.id = i.store_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC 
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

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

    // ================= CATEGORY VIEW =================
    if (!category) {
      const data = await sequelize.query(`
        SELECT 
          i.category,

          MIN(i.sku_code) as code,                        
          COUNT(i.id) as quantity,                         

          AVG(i.sale_rate)::numeric(10,2) as selling_price,  
          AVG(i.making_charge)::numeric(10,2) as making_charge,

          MIN(i.purity) as purity,                      
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

    // ================= ITEM VIEW =================
    const data = await sequelize.query(`
      SELECT 
        i.item_name as article,               
        i.sku_code as code,
        1 as quantity,                        

        i.sale_rate as selling_price,
        i.making_charge,
        i.purity,

        i.net_weight,
        i.stone_weight,
        i.gross_weight

      FROM items i
      JOIN stores st ON st.id = i.store_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC            
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({ success: true, data });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const getStoreCategoryItems = async (req, res) => {
  try {
    const { store_code } = req.params;
    const { category } = req.query;

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const data = await sequelize.query(`
      SELECT 
        i.item_name as article,            
        i.sku_code as code,                
        1 as quantity,                     
        i.sale_rate as selling_price,      
        i.making_charge,                   
        i.purity,                         
        i.net_weight,                      
        i.stone_weight,                    
        i.gross_weight                     

      FROM items i
      JOIN stores st ON st.id = i.store_id

      WHERE st.store_code = :store_code
      AND i.category = :category

      ORDER BY i."createdAt" DESC   
    `, {
      replacements: { store_code, category },
      type: sequelize.QueryTypes.SELECT
    });

    res.json({
      success: true,
      data
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// ================= CREATE STORE =================
export const createStore = async (req, res) => {
  let t;

  try {
    const {
      store_name,
      level,
      address,
      pincode,
      store_code,
    } = req.body;

    // ================= VALIDATION =================
    const normalizedLevel = level?.trim();

    const allowedLevels = ["Retail", "District", "head_office"];

    if (!store_name || !normalizedLevel || !store_code) {
      return res.status(400).json({
        success: false,
        message: "store_name, level, store_code required",
      });
    }

    if (!allowedLevels.includes(normalizedLevel)) {
      return res.status(400).json({
        success: false,
        message: "Invalid organization level",
      });
    }

    // Optional safety (avoid wrong data like "District Delhi" saved as Retail)
    if (
      store_name.toLowerCase().includes("district") &&
      normalizedLevel !== "District"
    ) {
      return res.status(400).json({
        success: false,
        message: "Store name indicates District but level is incorrect",
      });
    }

    const finalAddress = `${address || ""} - ${pincode || ""}`;

    // ================= TRANSACTION =================
    t = await sequelize.transaction();

    const newStore = await Store.create(
      {
        store_name,
        organization_level: normalizedLevel, 
        store_code,
        address: finalAddress,
        is_active: true,
      },
      { transaction: t }
    );

    await t.commit();

    // ================= RETAIL =================
    if (normalizedLevel === "Retail") {
      return res.json({
        success: true,
        message: "Retail Store Created",
        data: newStore,
      });
    }

    // ================= DISTRICT =================
    if (normalizedLevel === "District") {

      const unassignedStores = await Store.findAll({
        where: {
          organization_level: "Retail",
          district_id: null,
          is_active: true,
          id: {
            [Op.ne]: newStore.id,
          },
        },
        attributes: ["id", "store_name", "store_code","address"],
        order: [["createdAt", "DESC"]],
      });

      return res.json({
        success: true,
        message: "District Created Successfully",
        data: {
          district: {
            id: newStore.id,
            store_name: newStore.store_name,
            store_code: newStore.store_code,
            organization_level: newStore.organization_level,
          },
          availableStores: unassignedStores,
        },
      });
    }

  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

// ================= MAP STORES TO DISTRICT =================
export const mapStoresToDistrict = async (req, res) => {
  let t;

  try {
    let { district_id, storeIds = [] } = req.body;

    if (!district_id || !Array.isArray(storeIds) || storeIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: "district_id and storeIds required",
      });
    }

    const districtId = Number(district_id);

    if (isNaN(districtId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid district_id",
      });
    }

    // ================= VALIDATE DISTRICT =================
    const district = await Store.findOne({
      where: {
        id: districtId,
        organization_level: "District",
      },
    });

    if (!district) {
      return res.status(400).json({
        success: false,
        message: "Invalid district_id",
      });
    }

    // ================= VALIDATE STORES =================
    const validStores = await Store.findAll({
      where: {
        id: { [Op.in]: storeIds },
        organization_level: "Retail",
        district_id: null,
      },
    });

    if (validStores.length !== storeIds.length) {
      return res.status(400).json({
        success: false,
        message: "Some stores already assigned or invalid",
      });
    }

    // ================= TRANSACTION =================
    t = await sequelize.transaction();

    //  IMPORTANT: RAW UPDATE (FORCE DB UPDATE)
    await sequelize.query(
      `
      UPDATE stores
      SET district_id = :districtId
      WHERE id IN (:storeIds)
      `,
      {
        replacements: { districtId, storeIds },
        transaction: t,
      }
    );

    //  FETCH UPDATED DATA (AFTER UPDATE)
    const updatedStores = await Store.findAll({
      where: {
        id: { [Op.in]: storeIds },
      },
      attributes: [
        "id",
        "store_name",
        "store_code",
        "organization_level",
        "district_id",
      ],
      transaction: t,
    });

    await t.commit();

    return res.json({
      success: true,
      message: "Stores mapped successfully",
      data: updatedStores,
    });

  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }

    console.log(" MAP ERROR:", error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};