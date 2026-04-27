import { Op } from "sequelize";
import sequelize from "../config/db.js";
import Item from "../model/item.js";
import Stock from "../model/stockrecord.js";
import StockMovement from "../model/stockmovement.js";
import Store from "../model/Store.js";
import { createActivityLog } from "../service/activity.service.js";

/* =========================================================
   HELPERS
========================================================= */
const hasAttr = (model, attr) => !!model?.rawAttributes?.[attr];

const pickAttr = (model, attrs = []) => {
  for (const attr of attrs) {
    if (hasAttr(model, attr)) return attr;
  }
  return null;
};

const getCreatedKey = (model) =>
  pickAttr(model, ["created_at", "createdAt"]) || "id";

export const getRetailInventory = async (req, res) => {
  try {
    const user = req.user;
    const { search, category, metal_type, organization_id } = req.query;

    if (!user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const itemWhere = {};
    const stockWhere = {};

    const level = String(user.organization_level || "").toLowerCase();
    const role = String(user.role || "").toLowerCase();

    // =================================================
    // SUPER ADMIN
    // =================================================
    if (role === "super_admin") {
      if (organization_id) {
        itemWhere.organization_id = Number(organization_id);
        stockWhere.organization_id = Number(organization_id);
      }
    }

    // =================================================
    // DISTRICT USER
    // =================================================
    else if (level === "district") {
      itemWhere.organization_id = Number(user.organization_id);

      if (user.store_code) {
        itemWhere.storeCode = user.store_code;
      }

      stockWhere.organization_id = Number(user.organization_id);
    }

    // =================================================
    // RETAIL / STORE USER
    // =================================================
    else if (level === "retail" || level === "store") {
      if (!user.store_code) {
        return res.status(403).json({
          success: false,
          message: "Store code not found for this user",
        });
      }

      itemWhere.storeCode = user.store_code;
      stockWhere.organization_id = Number(user.organization_id);
    }

    // =================================================
    // OTHER USERS
    // =================================================
    else {
      return res.status(403).json({
        success: false,
        message: "Invalid user level",
      });
    }

    // =================================================
    // FILTERS
    // =================================================
    if (category) itemWhere.category = category;
    if (metal_type) itemWhere.metal_type = metal_type;

    if (search) {
      itemWhere[Op.or] = [
        { category: { [Op.iLike]: `%${search}%` } },
        { article_code: { [Op.iLike]: `%${search}%` } },
        { item_name: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // =================================================
    // FETCH ITEMS WITH STOCK
    // =================================================
    const items = await Item.findAll({
      attributes: [
        "id",
        "category",
        "article_code",
        "sku_code",
        "item_name",
        "sale_rate",
        "making_charge",
        "purity",
        "net_weight",
        "stone_weight",
        "gross_weight",
        "storeCode",
        "organization_id",
        "current_status",
      ],
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
        },
      ],
      order: [["id", "DESC"]],
    });

    // =================================================
    // SUMMARY CARDS
    // =================================================
    let totalStockItems = 0;
    let deadStockItems = 0;
    let lowStockItems = 0;
    let transitGoods = 0;

    // low stock threshold
    const LOW_STOCK_THRESHOLD = 5;

    // =================================================
    // GROUP CATEGORY TABLE
    // =================================================
    const grouped = {};

    for (const item of items) {
      const key = item.category || "Other";
      const stocks = Array.isArray(item.stocks) ? item.stocks : [];

      let itemAvailableQty = 0;
      let itemTransitQty = 0;
      let itemDeadQty = 0;

      for (const stock of stocks) {
        itemAvailableQty += Number(stock.available_qty || 0);
        itemTransitQty += Number(stock.transit_qty || 0);
        itemDeadQty += Number(stock.dead_qty || 0);
      }

      totalStockItems += itemAvailableQty;
      transitGoods += itemTransitQty;
      deadStockItems += itemDeadQty;

      if (itemAvailableQty > 0 && itemAvailableQty <= LOW_STOCK_THRESHOLD) {
        lowStockItems += 1;
      }

      if (!grouped[key]) {
        grouped[key] = {
          category: key,
          code: item.article_code || "-",
          quantity: 0,
          selling_price: Number(item.sale_rate || 0),
          making_charge: Number(item.making_charge || 0),
          purity: item.purity || "-",
          net_weight: 0,
          stone_weight: 0,
          gross_weight: 0,
          action: "View Details",
        };
      }

      grouped[key].quantity += itemAvailableQty;
      grouped[key].net_weight += Number(item.net_weight || 0);
      grouped[key].stone_weight += Number(item.stone_weight || 0);
      grouped[key].gross_weight += Number(item.gross_weight || 0);
    }

    const data = Object.values(grouped).map((row) => ({
      ...row,
      quantity: Number(row.quantity.toFixed(3)),
      net_weight: Number(row.net_weight.toFixed(3)),
      stone_weight: Number(row.stone_weight.toFixed(3)),
      gross_weight: Number(row.gross_weight.toFixed(3)),
    }));

    return res.status(200).json({
      success: true,
      message: "Retail inventory fetched successfully",
      summary: {
        total_stock_items: Number(totalStockItems.toFixed(3)),
        dead_stock_items: Number(deadStockItems.toFixed(3)),
        low_stock_items: lowStockItems,
        transit_goods: Number(transitGoods.toFixed(3)),
      },
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getRetailInventory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch retail inventory",
      error: error.message,
    });
  }
};

export const getDistrictInventory = async (req, res) => {
  try {
    const user = req.user;
    const { search, category, metal_type } = req.query;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (
      user.role !== "district_manager" &&
      String(user.organization_level || "").toLowerCase() !== "district"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this inventory",
      });
    }

    const districtOrgId = Number(user.organization_id);
    const districtCode = user.store_code || user.storeCode;

    if (!districtOrgId || !districtCode) {
      return res.status(400).json({
        success: false,
        message: "District organization id or code not found",
      });
    }

    const whereClause = {
      organization_id: districtOrgId,
      storeCode: districtCode,
    };

    if (category) {
      whereClause.category = category;
    }

    if (metal_type) {
      whereClause.metal_type = metal_type;
    }

    if (search) {
      whereClause[Op.or] = [
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { item_name: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const items = await Item.findAll({
      where: whereClause,
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "store_id",
        "storeCode",
        "storeName",
        "organization_id",
        "createdAt",
        "updatedAt",
      ],
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: {
            organization_id: districtOrgId,
          },
        },
      ],
      order: [["id", "DESC"]],
    });

    let totalStockItems = 0;
    let deadStockItems = 0;
    let lowStockItems = 0;
    let transitGoods = 0;

    const LOW_STOCK_THRESHOLD = 5;

    const grouped = {};

    for (const item of items) {
      const key = item.category || "Other";
      const stocks = Array.isArray(item.stocks) ? item.stocks : [];

      let itemAvailableQty = 0;
      let itemTransitQty = 0;
      let itemDeadQty = 0;

      for (const stock of stocks) {
        itemAvailableQty += Number(stock.available_qty || 0);
        itemTransitQty += Number(stock.transit_qty || 0);
        itemDeadQty += Number(stock.dead_qty || 0);
      }

      totalStockItems += itemAvailableQty;
      transitGoods += itemTransitQty;
      deadStockItems += itemDeadQty;

      if (itemAvailableQty > 0 && itemAvailableQty <= LOW_STOCK_THRESHOLD) {
        lowStockItems += 1;
      }

      if (!grouped[key]) {
        grouped[key] = {
          category: key,
          code: item.article_code || "-",
          quantity: 0,
          selling_price: Number(item.sale_rate || 0),
          making_charge: Number(item.making_charge || 0),
          purity: item.purity || "-",
          net_weight: 0,
          stone_weight: 0,
          gross_weight: 0,
          action: "View Details",
        };
      }

      grouped[key].quantity += itemAvailableQty;
      grouped[key].net_weight += Number(item.net_weight || 0);
      grouped[key].stone_weight += Number(item.stone_weight || 0);
      grouped[key].gross_weight += Number(item.gross_weight || 0);
    }

    const data = Object.values(grouped).map((row) => ({
      ...row,
      quantity: Number(row.quantity.toFixed(3)),
      net_weight: Number(row.net_weight.toFixed(3)),
      stone_weight: Number(row.stone_weight.toFixed(3)),
      gross_weight: Number(row.gross_weight.toFixed(3)),
    }));

    return res.status(200).json({
      success: true,
      message: "District inventory fetched successfully",
      organization_id: districtOrgId,
      store_code: districtCode,
      summary: {
        total_stock_items: Number(totalStockItems.toFixed(3)),
        dead_stock_items: Number(deadStockItems.toFixed(3)),
        low_stock_items: lowStockItems,
        transit_goods: Number(transitGoods.toFixed(3)),
      },
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getDistrictInventory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district inventory",
      error: error.message,
    });
  }
};
/* =========================================================
   STOCK OF ALL CATOGARY
========================================================= */



export const getStockItemsByCategory = async (req, res) => {
  try {
    const user = req.user;
    const { category } = req.params;
    const { organization_id, search, metal_type } = req.query;

    let orgId = null;

    // =========================
    // Resolve organization
    // =========================
    if (user?.role === "super_admin") {
      orgId = organization_id ? Number(organization_id) : null;
    } else {
      orgId = user?.organization_id ? Number(user.organization_id) : null;
    }

    if (!user?.role) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    if (user.role !== "super_admin" && !orgId) {
      return res.status(403).json({
        success: false,
        message: "Organization not found for this user",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    // =========================
    // Filters
    // =========================
    const itemWhere = { category };
    const stockWhere = {};

    if (orgId) {
      itemWhere.organization_id = orgId;
      stockWhere.organization_id = orgId;
    }

    if (metal_type) {
      itemWhere.metal_type = metal_type;
    }

    if (search) {
      itemWhere[Op.or] = [
        { item_name: { [Op.iLike]: `%${search}%` } },
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
      ];
    }

    // =========================
    // Fetch items
    // =========================
    const items = await Item.findAll({
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "organization_id",
        "createdAt",
        "updatedAt",
      ],
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          where: Object.keys(stockWhere).length ? stockWhere : undefined,
          attributes: [
            "id",
            "organization_id",
            "item_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
        },
        {
          model: Store,
          as: "organization",
          required: false,
          attributes: ["id", "store_code", "store_name", "organization_level"],
        },
      ],
      order: [["id", "DESC"]],
    });

    // =========================
    // Flatten response
    // =========================
    const data = items.map((item, index) => {
      const stock =
        Array.isArray(item.stocks) && item.stocks.length > 0
          ? item.stocks[0]
          : null;

      return {
        idx: index,
        id: Number(item.id || 0),
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        metal_type: item.metal_type || "",
        category: item.category || "",
        details: item.details || "",
        purity: item.purity || "",

        gross_weight: Number(item.gross_weight || 0),
        net_weight: Number(item.net_weight || 0),
        stone_weight: Number(item.stone_weight || 0),
        stone_amount: Number(item.stone_amount || 0),

        making_charge: Number(item.making_charge || 0),
        purchase_rate: Number(item.purchase_rate || 0),
        sale_rate: Number(item.sale_rate || 0),

        hsn_code: item.hsn_code || "",
        unit: item.unit || "",
        current_status: item.current_status || "",

        // stock fields
        stock_id: stock ? Number(stock.id || 0) : null,
        quantity: Number(stock?.available_qty || 0),
        available_qty: Number(stock?.available_qty || 0),
        available_weight: Number(stock?.available_weight || 0),
        reserved_qty: Number(stock?.reserved_qty || 0),
        reserved_weight: Number(stock?.reserved_weight || 0),
        transit_qty: Number(stock?.transit_qty || 0),
        transit_weight: Number(stock?.transit_weight || 0),
        damaged_qty: Number(stock?.damaged_qty || 0),
        damaged_weight: Number(stock?.damaged_weight || 0),
        dead_qty: Number(stock?.dead_qty || 0),
        dead_weight: Number(stock?.dead_weight || 0),

        // store / org fields
        store_id: item.organization ? Number(item.organization.id || 0) : null,
        storeCode: item.organization?.store_code || null,
        storeName: item.organization?.store_name || null,
        organization_level: item.organization?.organization_level || null,
        organization_id: Number(item.organization_id || 0),

        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null,

        action: "View",
      };
    });

    return res.status(200).json({
      success: true,
      message: `${category} items fetched successfully`,
      organization_id: orgId,
      category,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getStockItemsByCategory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch category items",
      error: error.message,
    });
  }
};
/* =========================================================
   GET SINGLE STOCK ITEM
========================================================= */


export const getDistrictStockItemsByCategory = async (req, res) => {
  try {
    const user = req.user;
    const { category } = req.params;
    const { search, metal_type } = req.query;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    const level = String(user.organization_level || "").toLowerCase();
    const role = String(user.role || "").toLowerCase();

    if (role !== "district_manager" && level !== "district") {
      return res.status(403).json({
        success: false,
        message: "Only district users can access category items",
      });
    }

    const districtOrgId = Number(user.organization_id);
    const districtCode = user.store_code || user.storeCode;

    if (!districtOrgId || !districtCode) {
      return res.status(400).json({
        success: false,
        message: "District organization id or code not found",
      });
    }

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }

    const itemWhere = {
      organization_id: districtOrgId,
      storeCode: districtCode,
      category,
    };

    if (metal_type) {
      itemWhere.metal_type = metal_type;
    }

    if (search) {
      itemWhere[Op.or] = [
        { item_name: { [Op.iLike]: `%${search}%` } },
        { article_code: { [Op.iLike]: `%${search}%` } },
        { sku_code: { [Op.iLike]: `%${search}%` } },
        { purity: { [Op.iLike]: `%${search}%` } },
        { category: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const items = await Item.findAll({
      attributes: [
        "id",
        "article_code",
        "sku_code",
        "item_name",
        "metal_type",
        "category",
        "details",
        "purity",
        "gross_weight",
        "net_weight",
        "stone_weight",
        "stone_amount",
        "making_charge",
        "purchase_rate",
        "sale_rate",
        "hsn_code",
        "unit",
        "current_status",
        "store_id",
        "storeCode",
        "storeName",
        "organization_id",
        "createdAt",
        "updatedAt",
      ],
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          attributes: [
            "id",
            "organization_id",
            "item_id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
            "dead_qty",
            "dead_weight",
          ],
          where: {
            organization_id: districtOrgId,
          },
        },
      ],
      order: [["id", "DESC"]],
    });

    const data = items.map((item, index) => {
      const stock =
        Array.isArray(item.stocks) && item.stocks.length > 0
          ? item.stocks[0]
          : null;

      return {
        idx: index + 1,
        id: Number(item.id || 0),
        article_code: item.article_code || "",
        sku_code: item.sku_code || "",
        item_name: item.item_name || "",
        metal_type: item.metal_type || "",
        category: item.category || "",
        details: item.details || "",
        purity: item.purity || "",

        gross_weight: Number(item.gross_weight || 0),
        net_weight: Number(item.net_weight || 0),
        stone_weight: Number(item.stone_weight || 0),
        stone_amount: Number(item.stone_amount || 0),

        making_charge: Number(item.making_charge || 0),
        purchase_rate: Number(item.purchase_rate || 0),
        sale_rate: Number(item.sale_rate || 0),

        hsn_code: item.hsn_code || "",
        unit: item.unit || "",
        current_status: item.current_status || "",

        stock_id: stock ? Number(stock.id || 0) : null,
        quantity: Number(stock?.available_qty || 0),
        available_qty: Number(stock?.available_qty || 0),
        available_weight: Number(stock?.available_weight || 0),
        reserved_qty: Number(stock?.reserved_qty || 0),
        reserved_weight: Number(stock?.reserved_weight || 0),
        transit_qty: Number(stock?.transit_qty || 0),
        transit_weight: Number(stock?.transit_weight || 0),
        damaged_qty: Number(stock?.damaged_qty || 0),
        damaged_weight: Number(stock?.damaged_weight || 0),
        dead_qty: Number(stock?.dead_qty || 0),
        dead_weight: Number(stock?.dead_weight || 0),

        store_id: Number(item.store_id || 0),
        storeCode: item.storeCode || districtCode,
        storeName: item.storeName || null,
        organization_id: Number(item.organization_id || 0),

        createdAt: item.createdAt || null,
        updatedAt: item.updatedAt || null,

        action: "View",
      };
    });

    return res.status(200).json({
      success: true,
      message: `District ${category} items fetched successfully`,
      organization_id: districtOrgId,
      store_code: districtCode,
      category,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getDistrictStockItemsByCategory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district category items",
      error: error.message,
    });
  }
};



export const getSingleStock = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const { organization_id } = req.query;

    const orgId = getOrganizationFilter(user, organization_id);

    const where = { id };
    if (orgId) where.organization_id = orgId;

    const item = await Item.findOne({
      where,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
        },
        {
          model: Store,
          as: "organization",
          attributes: ["id", "store_code", "store_name", "organizationlevel"],
          required: false,
        },
      ],
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        message: "Stock item not found",
      });
    }

    const movementCreatedKey = getCreatedKey(StockMovement);

    const movements = await StockMovement.findAll({
      where: {
        item_id: item.id,
        ...(orgId ? { organization_id: orgId } : {}),
      },
      order: [[movementCreatedKey, "DESC"]],
      limit: 10,
    });

    return res.status(200).json({
      success: true,
      message: "Stock item fetched successfully",
      data: {
        item,
        stock: item.stocks?.[0] || null,
        organization: item.organization || null,
        recent_movements: movements,
      },
    });
  } catch (error) {
    console.error("getSingleStock error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stock item",
      error: error.message,
    });
  }
};

/* =========================================================
   UPDATE STOCK STATUS
========================================================= */

export const updateStockStatus = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { id } = req.params;
    const { current_status, remarks } = req.body;
    const user = req.user;

    const where = { id };

    if (user?.role !== "super_admin") {
      where.organization_id = user?.organization_id;
    }

    const item = await Item.findOne({
      where,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
        },
      ],
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    const previousStatus = item.current_status;

    await item.update({ current_status }, { transaction: t });

    const movement = await StockMovement.create(
      {
        item_id: item.id,
        organization_id: item.organization_id,
        movement_type: "adjustment",
        qty: item.unit === "piece" ? 1 : 0,
        weight: item.gross_weight || 0,
        previous_status: previousStatus,
        new_status: current_status,
        reference_type: "item_status_update",
        remarks:
          remarks || `Status changed from ${previousStatus} to ${current_status}`,
        created_by: user?.id || null,
      },
      { transaction: t }
    );

    await createActivityLog({
      organization_id: item.organization_id,
      user_id: user?.id || null,
      module: "stock",
      action: "update_status",
      entity_type: "item",
      entity_id: item.id,
      title: "Stock item status updated",
      description: `${item.item_name} status changed from ${previousStatus} to ${current_status}`,
      metadata: {
        item_id: item.id,
        article_code: item.article_code,
        previous_status: previousStatus,
        new_status: current_status,
        movement_id: movement.id,
      },
    });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Stock status updated successfully",
      data: item,
    });
  } catch (error) {
    await t.rollback();
    console.error("updateStockStatus error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update stock status",
      error: error.message,
    });
  }
};

/* =========================================================
   STOCK SUMMARY
========================================================= */

export const stockSummary = async (req, res) => {
  try {
    const user = req.user;
    const { organization_id } = req.query;

    const orgId = getOrganizationFilter(user, organization_id);

    const itemWhere = {};
    const stockWhere = {};

    if (orgId) {
      itemWhere.organization_id = orgId;
      stockWhere.organization_id = orgId;
    }

    const totalStock = await Stock.count({
      where: {
        ...stockWhere,
        available_qty: { [Op.gt]: 0 },
      },
    });

    const deadStock = await Stock.count({
      where: {
        ...stockWhere,
        dead_qty: { [Op.gt]: 0 },
      },
    });

    const transitGoods = await Stock.count({
      where: {
        ...stockWhere,
        transit_qty: { [Op.gt]: 0 },
      },
    });

    const reservedItems = await Stock.count({
      where: {
        ...stockWhere,
        reserved_qty: { [Op.gt]: 0 },
      },
    });

    const soldItems = await Item.count({
      where: {
        ...itemWhere,
        current_status: "sold",
      },
    });

    const lowStockItems = await Stock.count({
      where: {
        ...stockWhere,
        available_qty: {
          [Op.gt]: 0,
          [Op.lte]: 2,
        },
      },
    });

    return res.status(200).json({
      success: true,
      message: "Stock summary fetched successfully",
      data: {
        total_stock: totalStock,
        dead_stock: deadStock,
        low_stock: lowStockItems,
        transit_goods: transitGoods,
        sold_items: soldItems,
        reserved_items: reservedItems,
      },
    });
  } catch (error) {
    console.error("stockSummary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch stock summary",
      error: error.message,
    });
  }
};

/* =========================================================
   ADD STOCK IN
========================================================= */

export const addStockIn = async (req, res) => {
  const t = await sequelize.transaction();

  try {
    const { item_id, qty = 1, weight = 0, remarks } = req.body;
    const user = req.user;

    const itemWhere = { id: item_id };

    if (user?.role !== "super_admin") {
      itemWhere.organization_id = user?.organization_id;
    }

    const item = await Item.findOne({
      where: itemWhere,
      transaction: t,
    });

    if (!item) {
      await t.rollback();
      return res.status(404).json({
        success: false,
        message: "Item not found",
      });
    }

    let stock = await Stock.findOne({
      where: {
        item_id: item.id,
        organization_id: item.organization_id,
      },
      transaction: t,
    });

    if (!stock) {
      stock = await Stock.create(
        {
          organization_id: item.organization_id,
          item_id: item.id,
          available_qty: 0,
          available_weight: 0,
          reserved_qty: 0,
          reserved_weight: 0,
          transit_qty: 0,
          transit_weight: 0,
          damaged_qty: 0,
          damaged_weight: 0,
          dead_qty: 0,
          dead_weight: 0,
        },
        { transaction: t }
      );
    }

    const incomingQty = Number(qty || 0);
    const incomingWeight = Number(weight || item.gross_weight || 0);

    await stock.update(
      {
        available_qty: Number(stock.available_qty) + incomingQty,
        available_weight: Number(stock.available_weight) + incomingWeight,
      },
      { transaction: t }
    );

    const previousStatus = item.current_status;

    await item.update({ current_status: "in_stock" }, { transaction: t });

    const movement = await StockMovement.create(
      {
        item_id: item.id,
        organization_id: item.organization_id,
        movement_type: "stock_in",
        qty: incomingQty,
        weight: incomingWeight,
        previous_status: previousStatus,
        new_status: "in_stock",
        reference_type: "manual_stock_in",
        remarks: remarks || "Stock inward completed",
        created_by: user?.id || null,
      },
      { transaction: t }
    );

    await createActivityLog({
      organization_id: item.organization_id,
      user_id: user?.id || null,
      module: "stock",
      action: "stock_in",
      entity_type: "item",
      entity_id: item.id,
      title: "Stock added",
      description: `${item.item_name} added into stock`,
      metadata: {
        item_id: item.id,
        article_code: item.article_code,
        movement_id: movement.id,
        qty: incomingQty,
        weight: incomingWeight,
      },
    });

    await t.commit();

    return res.status(200).json({
      success: true,
      message: "Stock inward successful",
      data: {
        item,
        stock,
      },
    });
  } catch (error) {
    await t.rollback();
    console.error("addStockIn error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add stock inward",
      error: error.message,
    });
  }
};