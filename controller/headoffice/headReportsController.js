import sequelize from "../config/db.js";
import { QueryTypes } from "sequelize";
import redis from "../config/redis.js";


export const getDashboardAnalytics = async (req, res) => {
  try {
    const cacheKey = "dashboard:analytics";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache Hit: Dashboard Analytics");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache Miss: Dashboard Analytics");

    const revenueResult = await sequelize.query(`
      SELECT COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM invoices
      WHERE status IN ('PAID', 'PARTIAL')
    `, { type: QueryTypes.SELECT });

    const totalRevenue = parseFloat(revenueResult[0].total_revenue);

    const profitResult = await sequelize.query(`
      SELECT COALESCE(
        SUM(
          ii.total_amount - (
            (COALESCE(i.purchase_rate, 0) * COALESCE(ii.net_weight, 0)) + 
            COALESCE(i.making_charge, 0) + 
            COALESCE(i.stone_amount, 0)
          )
        ), 0
      ) AS total_profit
      FROM invoice_items ii
      JOIN items i 
        ON TRIM(LOWER(i.article_code)) = TRIM(LOWER(ii.product_code)) 
        OR TRIM(LOWER(i.sku_code)) = TRIM(LOWER(ii.product_code))
      JOIN invoices inv 
        ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID', 'PARTIAL')
    `, { type: QueryTypes.SELECT });

    const inventoryResult = await sequelize.query(`
      SELECT COUNT(*) AS total_inventory
      FROM items
    `, { type: QueryTypes.SELECT });

    const avgSalesResult = await sequelize.query(`
      SELECT COALESCE(AVG(monthly_sales), 0) AS avg_sales FROM (
        SELECT 
          DATE_TRUNC('month', invoice_date) AS month,
          SUM(total_amount) AS monthly_sales
        FROM invoices
        WHERE status IN ('PAID', 'PARTIAL')
        GROUP BY month
      ) AS monthly_data
    `, { type: QueryTypes.SELECT });

    const data = {
      totalRevenue,
      totalProfit: parseFloat(profitResult[0].total_profit),
      totalInventory: parseInt(inventoryResult[0].total_inventory),
      avgMonthlySales: parseFloat(avgSalesResult[0].avg_sales)
    };

    await redis.set(cacheKey, JSON.stringify({ success: true, data }), "EX", 300);

    res.json({ success: true, data });

  } catch (error) {
    console.error("Dashboard Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getMonthlySalesProfit = async (req, res) => {
  try {
    const cacheKey = "dashboard:monthly";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache Hit: Monthly");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache Miss: Monthly");

    const data = await sequelize.query(`
      SELECT 
        TO_CHAR(inv.invoice_date, 'Mon') AS month,
        DATE_TRUNC('month', inv.invoice_date) AS full_date,
        SUM(inv.total_amount) AS sales,
        SUM(
          ii.total_amount - (
            (COALESCE(i.purchase_rate, 0) * COALESCE(ii.net_weight, 0)) + 
            COALESCE(i.making_charge, 0) + 
            COALESCE(i.stone_amount, 0)
          )
        ) AS profit
      FROM invoices inv
      JOIN invoice_items ii ON inv.id = ii.invoice_id
      JOIN items i 
        ON TRIM(LOWER(i.article_code)) = TRIM(LOWER(ii.product_code)) 
        OR TRIM(LOWER(i.sku_code)) = TRIM(LOWER(ii.product_code))
      WHERE inv.status IN ('PAID', 'PARTIAL')
      GROUP BY month, full_date
      ORDER BY full_date ASC
    `, { type: QueryTypes.SELECT });

    const formatted = data.map(item => ({
      label: item.month,
      sales: parseFloat(item.sales),
      profit: parseFloat(item.profit)
    }));

    await redis.set(cacheKey, JSON.stringify({ success: true, data: formatted }), "EX", 300);

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error("Monthly Trend Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getCategoryWiseSales = async (req, res) => {
  try {
    const cacheKey = "dashboard:category_sales";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache Hit: Category Sales");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache Miss: Category Sales");

    const data = await sequelize.query(`
      SELECT 
        i.category,
        SUM(ii.total_amount) AS total_sales
      FROM invoice_items ii
      JOIN items i 
        ON TRIM(LOWER(i.article_code)) = TRIM(LOWER(ii.product_code)) 
        OR TRIM(LOWER(i.sku_code)) = TRIM(LOWER(ii.product_code))
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID', 'PARTIAL')
      GROUP BY i.category
      ORDER BY total_sales DESC
    `, { type: QueryTypes.SELECT });

    const total = data.reduce((sum, item) => sum + parseFloat(item.total_sales), 0);

    const formatted = data.map(item => ({
      category: item.category,
      value: parseFloat(item.total_sales),
      percentage: total ? ((item.total_sales / total) * 100).toFixed(0) : 0
    }));

    await redis.set(cacheKey, JSON.stringify({ success: true, data: formatted }), "EX", 300);

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error("Category Sales Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getMetalDistribution = async (req, res) => {
  try {
    const cacheKey = "dashboard:metal_distribution";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache Hit: Metal Distribution");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache Miss: Metal Distribution");

    const data = await sequelize.query(`
      SELECT 
        CONCAT(i.metal_type, ' ', i.purity) AS label,
        SUM(ii.total_amount) AS revenue
      FROM invoice_items ii
      JOIN items i 
        ON TRIM(LOWER(i.article_code)) = TRIM(LOWER(ii.product_code)) 
        OR TRIM(LOWER(i.sku_code)) = TRIM(LOWER(ii.product_code))
      JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.status IN ('PAID', 'PARTIAL')
      GROUP BY i.metal_type, i.purity
      ORDER BY revenue DESC
    `, { type: QueryTypes.SELECT });

    const formatted = data.map(item => ({
      label: item.label,
      value: parseFloat(item.revenue)
    }));

    await redis.set(cacheKey, JSON.stringify({ success: true, data: formatted }), "EX", 300);

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error("Metal Distribution Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getTopProducts = async (req, res) => {
  try {
    const cacheKey = "dashboard:top_products";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log("⚡ Cache Hit: Top Products");
      return res.json(JSON.parse(cached));
    }

    console.log("🐢 Cache Miss: Top Products");

    const data = await sequelize.query(`
      SELECT 
        i.item_name,
        i.category,
        COUNT(ii.id) as units_sold,
        COALESCE(SUM(ii.total_amount), 0) as total_revenue
      FROM invoice_items ii
      JOIN items i ON i.id = ii.item_id
      JOIN invoices inv ON ii.invoice_id = inv.id
      WHERE inv.status IN ('PAID', 'PARTIAL')
      GROUP BY i.id, i.item_name, i.category
      ORDER BY total_revenue DESC
      LIMIT 5
    `, { type: QueryTypes.SELECT });

    const maxRevenue = data.length > 0 ? Number(data[0].total_revenue) : 0;

    const finalData = data.map((item, index) => ({
      rank: index + 1,
      product_name: item.item_name,
      category: item.category,
      units_sold: Number(item.units_sold),
      total_revenue: Number(item.total_revenue),
      performance: maxRevenue
        ? Math.round((item.total_revenue / maxRevenue) * 100)
        : 0,
    }));

    await redis.set(cacheKey, JSON.stringify({ success: true, data: finalData }), "EX", 300);

    res.json({ success: true, data: finalData });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};


export const getDailySalesTrend = async (req, res) => {
  try {
    const cacheKey = "dashboard:daily_trend";

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(" Cache Hit: Daily Trend");
      return res.json(JSON.parse(cached));
    }

    console.log(" Cache Miss: Daily Trend");

    const data = await sequelize.query(`
      SELECT 
        DATE(invoice_date) AS date,
        SUM(total_amount) AS sales
      FROM invoices
      WHERE 
        status IN ('PAID', 'PARTIAL')
        AND invoice_date >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(invoice_date)
      ORDER BY DATE(invoice_date) ASC
    `, { type: QueryTypes.SELECT });

    const formatted = data.map(item => ({
      label: item.date,
      sales: parseFloat(item.sales)
    }));

    await redis.set(cacheKey, JSON.stringify({ success: true, data: formatted }), "EX", 300);

    res.json({ success: true, data: formatted });

  } catch (error) {
    console.error("Daily Trend Error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};