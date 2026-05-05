// controllers/headOfficeController.js

// import sequelize from "../config/db.js";
// import { QueryTypes } from "sequelize";

// export const getHeadOfficeStock = async (req, res) => {
//   try {
//     const { search = "", category = "" } = req.query;

//     const user = {
//       organization_level: req.headers.organization_level,
//       store_code: req.headers.store_code, 
//     };

    
//     if (user.organization_level !== "head_office") {
//       return res.status(403).json({ message: "Access denied" });
//     }

    

//     const summary = await sequelize.query(
//       `
//       SELECT
//         COUNT(i.id) AS total_items,

//         COUNT(
//           CASE 
//             WHEN i."createdAt" < NOW() - INTERVAL '90 days'
//             THEN 1
//           END
//         ) AS dead_stock,

//         COUNT(
//           CASE 
//             WHEN s.available_qty < 25
//             THEN 1
//           END
//         ) AS low_stock,

//         COALESCE(SUM(s.transit_qty), 0) AS transit_stock

//       FROM items i

//       LEFT JOIN stocks s 
//         ON i.id = s.item_id

//       LEFT JOIN stores st 
//         ON st.id = s.organization_id

//       WHERE st.store_code = :storeCode;
//       `,
//       {
//         replacements: {
//           storeCode: user.store_code, 
//         },
//         type: QueryTypes.SELECT,
//       }
//     );

   

//     const inventory = await sequelize.query(
//       `
//       SELECT 
//         i.id,
//         i.item_name AS item,
//         i.article_code AS code,

//         COALESCE(s.available_qty, 0) AS quantity,

//         i.purchase_rate AS purchase_price,
//         i.sale_rate AS selling_price,
//         i.making_charge,
//         i.purity,

//         ROUND(i.net_weight::numeric, 3) AS net_weight,
//         ROUND(i.stone_weight::numeric, 3) AS stone_weight,
//         ROUND(i.gross_weight::numeric, 3) AS gross_weight

//       FROM items i

//       LEFT JOIN stocks s 
//         ON i.id = s.item_id

//       LEFT JOIN stores st 
//         ON st.id = s.organization_id

//       WHERE 
//         st.store_code = :storeCode
//         AND (:search = '' OR i.item_name ILIKE '%' || :search || '%')
//         AND (:category = '' OR i.category = :category)

//       ORDER BY i."createdAt" DESC;
//       `,
//       {
//         replacements: {
//           storeCode: user.store_code,
//           search,
//           category,
//         },
//         type: QueryTypes.SELECT,
//       }
//     );

//     return res.json({
//       success: true,
//       data: {
//         summary: {
//           total_items: Number(summary[0]?.total_items || 0),
//           dead_stock: Number(summary[0]?.dead_stock || 0),
//           low_stock: Number(summary[0]?.low_stock || 0),
//           transit_stock: Number(summary[0]?.transit_stock || 0),
//         },
//         inventory,
//       },
//     });

//   } catch (error) {
//     console.error("Head Office Stock Error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Something went wrong",
//     });
//   }
// };
//Head Stock Management 
import sequelize from "../../config/db.js";
import { QueryTypes } from "sequelize";
export const getOverallInventoryDashboard = async (req, res) => {
  try {

    // ================= CARDS =================
    const cards = await sequelize.query(`
      SELECT 
        COUNT(*) as total_stock_items,

        SUM(CASE 
          WHEN i."createdAt" < NOW() - INTERVAL '30 days' 
          THEN 1 ELSE 0 
        END) as dead_stock_items,

        SUM(CASE 
          WHEN s.available_qty < 5 
          THEN 1 ELSE 0 
        END) as low_stock,

        COALESCE(SUM(s.transit_qty),0) as transit_goods

      FROM items i
      LEFT JOIN stocks s ON s.item_id = i.id
    `, { type: sequelize.QueryTypes.SELECT });


    // ================= TABLE DATA =================
    const tableData = await sequelize.query(`
      SELECT 
        i.item_name as item,
        i.sku_code as code,
        COALESCE(s.available_qty,0) as quantity,
        i.purchase_rate,
        i.sale_rate as selling_price,
        i.making_charge,
        i.purity,
        i.net_weight,
        i.stone_weight,
        i.gross_weight

      FROM items i
      LEFT JOIN stocks s ON s.item_id = i.id

      ORDER BY i."createdAt" DESC
    `, { type: sequelize.QueryTypes.SELECT });


    return res.json({
      success: true,
      data: {
        cards: {
          totalStocksItems: Number(cards[0].total_stock_items),
          deadStockItems: Number(cards[0].dead_stock_items),
          lowStock: Number(cards[0].low_stock),
          transitGoods: Number(cards[0].transit_goods),
        },
        table: tableData
      }
    });

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
export const getOverallCategoryItems = async (req, res) => {
  try {
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

        COALESCE(SUM(s.available_qty), 0) as quantity,

        AVG(i.purchase_rate) as purchase_price,
        AVG(i.sale_rate) as selling_price,
        AVG(i.making_charge) as making_charge,

        i.purity,

        SUM(i.net_weight) as net_weight,
        SUM(i.stone_weight) as stone_weight,
        SUM(i.gross_weight) as gross_weight

      FROM items i
      LEFT JOIN stocks s ON s.item_id = i.id

      WHERE i.category = :category

      GROUP BY i.item_name, i.sku_code, i.purity

      ORDER BY i.item_name ASC
    `, {
      replacements: { category },
      type: sequelize.QueryTypes.SELECT
    });

    return res.json({
      success: true,
      data
    });

  } catch (error) {
    console.error("Overall Category Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
};
