import { Op, fn, col, literal, QueryTypes } from "sequelize";
import sequelize from "../config/db.js";
import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js";
import SystemActivity from "../model/systemActivity.js";
import Task from "../model/task.js";
import MetalRate from "../model/metalRate.js";
import Customer from "../model/Customer.js";
// import Invoice from "../model/Invoice.js";
const hasAttr = (model, attr) => !!model?.rawAttributes?.[attr];

const pickAttr = (model, attrs = []) => {
  for (const attr of attrs) {
    if (hasAttr(model, attr)) return attr;
  }
  return null;
};

const normalize = (v) => String(v || "").toLowerCase().trim();

const getCreatedKey = (model) =>
  pickAttr(model, ["created_at", "createdAt", "updated_at", "updatedAt"]) ||
  "createdAt";

const buildScopedWhere = (model, user = {}, extra = {}) => {
  const role = normalize(user.role);
  const level = normalize(user.organization_level);

  const where = { ...extra };

  // Full access
  if (
    role === "super_admin" ||
    role === "capital" ||
    level === "central" ||
    level === "head_office"
  ) {
    return where;
  }

  const orgKey = pickAttr(model, [
    "organization_id",
    "organizationId",
    "branch_id",
    "branchId",
  ]);
  const stateKey = pickAttr(model, ["state_code", "stateCode"]);
  const districtKey = pickAttr(model, ["district_code", "districtCode"]);
  const storeKey = pickAttr(model, ["store_code", "storeCode"]);

  // State
  if (level === "state" || role === "state_manager") {
    if (stateKey && user.state_code) {
      where[stateKey] = user.state_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // District
  if (level === "district" || role === "district_manager") {
    if (districtKey && user.district_code) {
      where[districtKey] = user.district_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // Store / Retail
  if (
    [
      "manager",
      "admin",
      "sales_girl",
      "tl",
      "store_manager",
      "inventory_manager",
      "retail-manager",
      "retail_manager",
      "cashier",
      "salesman",
      "salesperson",
    ].includes(role) ||
    level === "retail" ||
    level === "store"
  ) {
    if (storeKey && user.store_code) {
      where[storeKey] = user.store_code;
      return where;
    }
    if (orgKey && user.organization_id) {
      where[orgKey] = user.organization_id;
      return where;
    }
    return null;
  }

  // fallback
  if (orgKey && user.organization_id) {
    where[orgKey] = user.organization_id;
    return where;
  }

  return where;
};

const getSafeWhere = (model, user, extra = {}) => {
  const scoped = buildScopedWhere(model, user, extra);
  return scoped === null ? null : scoped;
};

// INDIA LOCAL DATE LABELS (IMPORTANT FIX)
const getLast7DaysLabelsIndia = () => {
  const labels = [];
  const dayMap = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(now.getDate() - i);

    // India local yyyy-mm-dd
    const indiaDate = new Date(
      d.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
    );

    const yyyy = indiaDate.getFullYear();
    const mm = String(indiaDate.getMonth() + 1).padStart(2, "0");
    const dd = String(indiaDate.getDate()).padStart(2, "0");

    labels.push({
      label: dayMap[indiaDate.getDay()],
      fullDate: `${yyyy}-${mm}-${dd}`,
    });
  }

  return labels;
};

export const getDashboardSummary = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const taskCreatedKey = getCreatedKey(Task);
    const activityCreatedKey = getCreatedKey(SystemActivity);
    const metalCreatedKey = getCreatedKey(MetalRate);

    const metalTypeKey =
      pickAttr(MetalRate, ["metal_type", "metalType"]) || "metal_type";
    const metalRateKey =
      pickAttr(MetalRate, ["rate", "metal_rate", "price"]) || "rate";

    const stockScope = getSafeWhere(Stock, req.user);
    const movementScope = getSafeWhere(StockMovement, req.user);
    const taskScope = getSafeWhere(Task, req.user);
    const activityScope = getSafeWhere(SystemActivity, req.user);

    if (
      stockScope === null &&
      movementScope === null &&
      taskScope === null &&
      activityScope === null
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized to view dashboard",
      });
    }

    // =========================================================
    // 1) TOP CARDS (CURRENT INVENTORY STATE)
    // =========================================================
    const stockSummary = await Stock.findOne({
      attributes: [
        [fn("COALESCE", fn("SUM", col("available_qty")), 0), "total_available_qty"],
        [fn("COALESCE", fn("SUM", col("dead_qty")), 0), "total_dead_qty"],
        [fn("COALESCE", fn("SUM", col("transit_qty")), 0), "total_transit_qty"],
      ],
      where: stockScope || {},
      raw: true,
    });

    const totalStock = Number(stockSummary?.total_available_qty || 0);

    const deadStockItems = await Stock.count({
      where: {
        ...(stockScope || {}),
        dead_qty: {
          [Op.gt]: 0,
        },
      },
    });

    const transitGoods = await Stock.count({
      where: {
        ...(stockScope || {}),
        transit_qty: {
          [Op.gt]: 0,
        },
      },
    });

    // =========================================================
    // 2) GOLD / SILVER PRICE
    // =========================================================
    const goldRate = await MetalRate.findOne({
      where: {
        [metalTypeKey]: {
          [Op.iLike]: "gold",
        },
      },
      order: [[metalCreatedKey, "DESC"]],
      raw: true,
    });

    const silverRate = await MetalRate.findOne({
      where: {
        [metalTypeKey]: {
          [Op.iLike]: "silver",
        },
      },
      order: [[metalCreatedKey, "DESC"]],
      raw: true,
    });

    // =========================================================
    // 3) SALES TREND + CATEGORY (FROM STOCK MOVEMENTS)
    // IMPORTANT FIX: INDIA DATE + TODAY INCLUDED
    // =========================================================
    const labels = getLast7DaysLabelsIndia();
    const startDate = labels[0].fullDate; // oldest
    const endDate = labels[labels.length - 1].fullDate; // today

    let salesTrendRaw = [];
    let salesByCategory = [];

    try {
      // ---------- SALES TREND ----------
      const salesTrendQuery = `
        SELECT 
          DATE(created_at AT TIME ZONE 'Asia/Kolkata') AS date,
          COUNT(id)::int AS count
        FROM stock_movements
        WHERE movement_type IN ('sale', 'sold', 'sales')
          ${movementScope?.organization_id ? `AND organization_id = :organization_id` : ""}
          AND DATE(created_at AT TIME ZONE 'Asia/Kolkata') BETWEEN :startDate AND :endDate
        GROUP BY DATE(created_at AT TIME ZONE 'Asia/Kolkata')
        ORDER BY DATE(created_at AT TIME ZONE 'Asia/Kolkata') ASC
      `;

      salesTrendRaw = await sequelize.query(salesTrendQuery, {
        replacements: {
          startDate,
          endDate,
          organization_id: movementScope?.organization_id || null,
        },
        type: QueryTypes.SELECT,
      });

      // ---------- SALES BY CATEGORY ----------
      // Since stock_movements has item_id, category item table se nikalegi
      const salesByCategoryQuery = `
        SELECT 
          COALESCE(i.category, 'Other') AS category,
          COUNT(sm.id)::int AS count
        FROM stock_movements sm
        LEFT JOIN items i ON i.id = sm.item_id
        WHERE sm.movement_type IN ('sale', 'sold', 'sales')
          ${movementScope?.organization_id ? `AND sm.organization_id = :organization_id` : ""}
        GROUP BY i.category
        ORDER BY count DESC
      `;

      const salesByCategoryRaw = await sequelize.query(salesByCategoryQuery, {
        replacements: {
          organization_id: movementScope?.organization_id || null,
        },
        type: QueryTypes.SELECT,
      });

      const totalCategoryCount = salesByCategoryRaw.reduce(
        (sum, row) => sum + Number(row.count || 0),
        0
      );

      salesByCategory = salesByCategoryRaw.map((row) => ({
        category: row.category || "Other",
        count: Number(row.count || 0),
        percentage:
          totalCategoryCount > 0
            ? Number(((Number(row.count || 0) / totalCategoryCount) * 100).toFixed(2))
            : 0,
      }));
    } catch (err) {
      console.warn("⚠️ Sales chart query skipped:", err.message);
      salesTrendRaw = [];
      salesByCategory = [];
    }

    const salesMap = new Map(
      salesTrendRaw.map((row) => [String(row.date), Number(row.count || 0)])
    );

    const salesTrends = labels.map((d) => ({
      day: d.label,
      date: d.fullDate,
      sales_count: salesMap.get(d.fullDate) || 0,
    }));

    // =========================================================
    // 4) PENDING TASKS
    // =========================================================
    let pendingTasks = [];
    try {
      pendingTasks = await Task.findAll({
        where: {
          ...(taskScope || {}),
          status: "pending",
        },
        order: [[taskCreatedKey, "DESC"]],
        limit: 5,
        raw: true,
      });
    } catch (err) {
      console.warn("⚠️ Pending task query skipped:", err.message);
      pendingTasks = [];
    }

    // =========================================================
    // 5) RECENT ACTIVITIES
    // =========================================================
    let recentActivities = [];
    try {
      recentActivities = await SystemActivity.findAll({
        where: activityScope || {},
        order: [[activityCreatedKey, "DESC"]],
        limit: 5,
        raw: true,
      });
    } catch (err) {
      console.warn("⚠️ Recent activities query skipped:", err.message);
      recentActivities = [];
    }

    return res.status(200).json({
      success: true,
      message: "Dashboard fetched successfully",
      data: {
        cards: {
          total_stock: Number(totalStock || 0),
          dead_stock_items: Number(deadStockItems || 0),
          transit_goods: Number(transitGoods || 0),
          gold_price: goldRate ? Number(goldRate[metalRateKey] || 0) : 0,
          silver_price: silverRate ? Number(silverRate[metalRateKey] || 0) : 0,
        },
        charts: {
          sales_trends: salesTrends,
          sales_by_category: salesByCategory,
        },
        pending_tasks: pendingTasks,
        recent_activities: recentActivities,
      },
    });
  } catch (error) {
    console.error("Dashboard Summary Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard",
      error: error.message,
    });
  }
};

export const getAllReports = async (req, res) => {
  try {
    const totalCustomers = await Customer.count();

    const dashboardSummary = {
      totalCustomers: Number(totalCustomers || 0),
      totalRevenue: 0,
      totalSales: 0,
      totalCashReceived: 0,
      accountTransfer: 0,
    };

    const labels = getLast7DaysLabelsIndia();

    const cashVsAccount = labels.map((d) => ({
      date: d.fullDate,
      day: d.label,
      cash: 0,
      online: 0,
      total: 0,
    }));

    const categoryRaw = await sequelize.query(
      `
      SELECT
        COALESCE(category::text, 'Others') AS category,
        COUNT(*)::int AS total_items
      FROM items
      GROUP BY category
      ORDER BY total_items DESC
      `,
      { type: QueryTypes.SELECT }
    );

    const totalCategoryItems = categoryRaw.reduce(
      (sum, item) => sum + Number(item.total_items || 0),
      0
    );

    const categorySales = categoryRaw.map((item) => ({
      category: item.category,
      revenue: Number(item.total_items || 0),
      percentage: totalCategoryItems
        ? Number(
            (
              (Number(item.total_items || 0) / totalCategoryItems) *
              100
            ).toFixed(0)
          )
        : 0,
    }));

    const typeDistributionRaw = await sequelize.query(
      `
      SELECT
        CASE
          WHEN TRIM(
            CONCAT(
              COALESCE(metal_type::text, ''),
              CASE
                WHEN purity IS NOT NULL AND purity::text <> '' THEN ' ' || purity::text
                ELSE ''
              END
            )
          ) = ''
          THEN 'Unknown'
          ELSE TRIM(
            CONCAT(
              COALESCE(metal_type::text, ''),
              CASE
                WHEN purity IS NOT NULL AND purity::text <> '' THEN ' ' || purity::text
                ELSE ''
              END
            )
          )
        END AS label,
        COUNT(*)::int AS value
      FROM items
      GROUP BY metal_type, purity
      ORDER BY value DESC
      `,
      { type: QueryTypes.SELECT }
    );

    const typeDistribution = typeDistributionRaw.map((item) => ({
      label: item.label || "Unknown",
      value: Number(item.value || 0),
    }));

    // ✅ actual stock table name from model
    const stockTableNameRaw = Stock.getTableName();
    const stockTableName =
      typeof stockTableNameRaw === "string"
        ? stockTableNameRaw
        : stockTableNameRaw.tableName;

    const topProductsRaw = await sequelize.query(
      `
      SELECT
        i.id,
        i.item_name,
        COALESCE(i.category::text, 'Others') AS category,
        COALESCE(SUM(s.available_qty), 0) AS units_sold,
        COALESCE(SUM(s.available_weight), 0) AS total_revenue
      FROM items i
      LEFT JOIN "${stockTableName}" s ON s.item_id = i.id
      GROUP BY i.id, i.item_name, i.category
      ORDER BY total_revenue DESC, units_sold DESC
      LIMIT 5
      `,
      { type: QueryTypes.SELECT }
    );

    const maxRevenue =
      topProductsRaw.length > 0
        ? Number(topProductsRaw[0].total_revenue || 0)
        : 0;

    const topProducts = topProductsRaw.map((item, index) => ({
      rank: index + 1,
      product_name: item.item_name,
      category: item.category,
      units_sold: Number(item.units_sold || 0),
      total_revenue: Number(item.total_revenue || 0),
      performance: maxRevenue
        ? Math.round((Number(item.total_revenue || 0) / maxRevenue) * 100)
        : 0,
    }));

    return res.status(200).json({
      success: true,
      message: "Reports fetched successfully",
      data: {
        dashboardSummary,
        cashVsAccount,
        categorySales,
        typeDistribution,
        topProducts,
      },
    });
  } catch (error) {
    console.error("getAllReports error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch reports",
      error: error.message,
    });
  }
};