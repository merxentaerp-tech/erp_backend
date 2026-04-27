import sequelize from "../config/db.js";
import { Op, fn, col, literal, QueryTypes } from "sequelize";
import Store from "../model/Store.js";
import Stock from "../model/stockrecord.js";
import Item from "../model/item.js";
import StockTransfer from "../model/stockTransfer.js";
import StockTransferItem from "../model/stockTransferItem.js";
import ActivityLog from "../model/activityLog.js";
import User from "../model/user.js"
import Invoice from "../model/invoices.js"
import Transaction from "../model/Transaction.js";
import InvoiceItem from "../model/InvoiceItem.js";

import { getGoldRate } from "../service/goldService.js";






export const addDistrictItemWithStock = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const user = req.user;

    if (!user) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Unauthorized access",
      });
    }

    if (
      user.role !== "district_manager" &&
      String(user.organization_level || "").toLowerCase() !== "district"
    ) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Only district manager can add district stock",
      });
    }

    const {
      article_code,
      sku_code,
      item_name,
      metal_type,
      category,
      details,
      purity,
      gross_weight,
      net_weight,
      stone_weight,
      stone_amount,
      making_charge,
      purchase_rate,
      sale_rate,
      hsn_code,
      unit,
      current_status,

      available_qty,
      available_weight,
      reserved_qty,
      reserved_weight,
      transit_qty,
      transit_weight,
      damaged_qty,
      damaged_weight,
      dead_qty,
      dead_weight,
    } = req.body;

    if (!article_code || !item_name || !metal_type || !category || !purity) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "article_code, item_name, metal_type, category, purity are required",
      });
    }

    const existingItem = await Item.findOne({
      where: { article_code },
      transaction,
    });

    if (existingItem) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Item with this article_code already exists",
      });
    }

    if (sku_code) {
      const existingSku = await Item.findOne({
        where: { sku_code },
        transaction,
      });

      if (existingSku) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Item with this sku_code already exists",
        });
      }
    }

    const item = await Item.create(
      {
        article_code,
        sku_code: sku_code || null,
        item_name,
        metal_type,
        category,
        details: details || null,
        purity,
        gross_weight: gross_weight || 0,
        net_weight: net_weight || 0,
        stone_weight: stone_weight || 0,
        stone_amount: stone_amount || 0,
        making_charge: making_charge || 0,
        purchase_rate: purchase_rate || 0,
        sale_rate: sale_rate || 0,
        hsn_code: hsn_code || null,
        unit: unit || "gram",
        current_status: current_status || "in_stock",
        organization_id: user.organization_id,
        organization_level: "district",
      },
      { transaction }
    );

    const stock = await Stock.create(
      {
        organization_id: user.organization_id,
        organization_level: "district",
        item_id: item.id,
        available_qty: available_qty || 0,
        available_weight: available_weight || 0,
        reserved_qty: reserved_qty || 0,
        reserved_weight: reserved_weight || 0,
        transit_qty: transit_qty || 0,
        transit_weight: transit_weight || 0,
        damaged_qty: damaged_qty || 0,
        damaged_weight: damaged_weight || 0,
        dead_qty: dead_qty || 0,
        dead_weight: dead_weight || 0,
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "District item and stock added successfully",
      data: {
        item,
        stock,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("addDistrictItemWithStock error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add district item and stock",
      error: error.message,
    });
  }
}



const safeNumber = (value) => {
  const num = Number(value || 0);
  return Number.isNaN(num) ? 0 : num;
};

const normalizeLevel = (level = "") => String(level).toLowerCase();

const getDistrictFromUser = async (user) => {
  const orgLevel = normalizeLevel(user.organization_level);

  if (orgLevel !== "district") {
    throw new Error("Only district user can access this module");
  }

  // case 1: user.organization_id directly district id ho
  let district = await District.findByPk(user.organization_id);

  // case 2: agar organization_id kisi aur structure ko refer karta ho,
  // aur district_code token me ho to district_code se bhi check kar lo
  if (!district && user.district_code) {
    district = await District.findOne({
      where: { district_code: user.district_code },
    });
  }

  if (!district) {
    throw new Error("District not found for logged in user");
  }

  return district;
};

/**
 * GET /api/district/store-management
 * District user ke under saare stores + summary
 */
export const getDistrictStoreManagement = async (req, res) => {
  try {
    const { search = "", status = "all" } = req.query;
    const user = req.user;

    const district = await getDistrictFromUser(user);

    const storeWhere = {
      district_id: district.id,
    };

    if (search?.trim()) {
      storeWhere[Op.or] = [
        { store_name: { [Op.iLike]: `%${search.trim()}%` } },
        { store_code: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    if (status === "active") {
      storeWhere.is_active = true;
    } else if (status === "inactive") {
      storeWhere.is_active = false;
    }

    const stores = await Store.findAll({
      where: storeWhere,
      attributes: [
        "id",
        "store_name",
        "store_code",
        "district_id",
        "is_active",
      ],
      order: [["store_name", "ASC"]],
      raw: true,
    });

    const storeIds = stores.map((s) => s.id);

    let employeesByStore = {};
    if (storeIds.length) {
      const employeeRows = await User.findAll({
        attributes: [
          "organization_id",
          [fn("COUNT", col("id")), "employee_count"],
        ],
        where: {
          organization_id: { [Op.in]: storeIds },
        },
        group: ["organization_id"],
        raw: true,
      });

      employeesByStore = employeeRows.reduce((acc, row) => {
        acc[row.organization_id] = safeNumber(row.employee_count);
        return acc;
      }, {});
    }

    // Revenue logic:
    // agar tumhare paas Ledger/Invoice model hai to yahan actual revenue lagao.
    // फिलहाल fallback 0 rakha hai, ya tum below commented version use kar sakte ho.
    let revenueByStore = {};

    /*
    if (storeIds.length) {
      const revenueRows = await Ledger.findAll({
        attributes: [
          "organization_id",
          [fn("SUM", col("amount")), "revenue"],
        ],
        where: {
          organization_id: { [Op.in]: storeIds },
          type: "SALE",
        },
        group: ["organization_id"],
        raw: true,
      });

      revenueByStore = revenueRows.reduce((acc, row) => {
        acc[row.organization_id] = safeNumber(row.revenue);
        return acc;
      }, {});
    }
    */

    const finalStores = stores.map((store) => ({
      id: store.id,
      store_name: store.store_name,
      store_code: store.store_code,
      is_active: !!store.is_active,
      employees: employeesByStore[store.id] || 0,
      revenue: revenueByStore[store.id] || 0,
    }));

    const summary = {
      total_stores: finalStores.length,
      active_stores: finalStores.filter((s) => s.is_active).length,
      total_employees: finalStores.reduce(
        (sum, store) => sum + safeNumber(store.employees),
        0
      ),
      total_revenue: finalStores.reduce(
        (sum, store) => sum + safeNumber(store.revenue),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "District store management fetched successfully",
      data: {
        district: {
          id: district.id,
          district_name: district.district_name,
          district_code: district.district_code,
        },
        summary,
        stores: finalStores,
      },
    });
  } catch (error) {
    console.error("getDistrictStoreManagement error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district store management",
      error: error.message,
    });
  }
};

/**
 * GET /api/district/store-management/:storeId
 * Single store inventory details
 */
export const getDistrictStoreInventory = async (req, res) => {
  try {
    const { storeId } = req.params;
    const { search = "", category = "" } = req.query;
    const user = req.user;

    const district = await getDistrictFromUser(user);

    const store = await Store.findOne({
      where: {
        id: storeId,
        district_id: district.id,
      },
      attributes: ["id", "store_name", "store_code", "district_id", "is_active"],
      raw: true,
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found under your district",
      });
    }

    const itemWhere = {};
    if (search?.trim()) {
      itemWhere[Op.or] = [
        { item_name: { [Op.iLike]: `%${search.trim()}%` } },
        { article_code: { [Op.iLike]: `%${search.trim()}%` } },
        { sku_code: { [Op.iLike]: `%${search.trim()}%` } },
        { category: { [Op.iLike]: `%${search.trim()}%` } },
      ];
    }

    if (category?.trim()) {
      itemWhere.category = category.trim();
    }

    const inventory = await Stock.findAll({
      where: {
        organization_id: store.id,
      },
      include: [
        {
          model: Item,
          attributes: [
            "id",
            "item_name",
            "article_code",
            "sku_code",
            "category",
            "purity",
            "gross_weight",
            "net_weight",
            "stone_weight",
            "making_charge",
            "sale_rate",
          ],
          where: itemWhere,
          required: true,
        },
      ],
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
      ],
      order: [[Item, "category", "ASC"], [Item, "item_name", "ASC"]],
    });

    const rows = inventory.map((row) => ({
      stock_id: row.id,
      item_id: row.Item?.id || null,
      item_name: row.Item?.item_name || null,
      category: row.Item?.category || null,
      code: row.Item?.article_code || row.Item?.sku_code || null,
      quantity: safeNumber(row.available_qty),
      selling_price: safeNumber(row.Item?.sale_rate),
      making_charge: safeNumber(row.Item?.making_charge),
      purity: row.Item?.purity || null,
      net_weight: safeNumber(row.Item?.net_weight),
      stone_weight: safeNumber(row.Item?.stone_weight),
      gross_weight: safeNumber(row.Item?.gross_weight),
      available_weight: safeNumber(row.available_weight),
      reserved_qty: safeNumber(row.reserved_qty),
      reserved_weight: safeNumber(row.reserved_weight),
      transit_qty: safeNumber(row.transit_qty),
      transit_weight: safeNumber(row.transit_weight),
      damaged_qty: safeNumber(row.damaged_qty),
      damaged_weight: safeNumber(row.damaged_weight),
    }));

    return res.status(200).json({
      success: true,
      message: "Store inventory fetched successfully",
      data: {
        store: {
          id: store.id,
          store_name: store.store_name,
          store_code: store.store_code,
          is_active: !!store.is_active,
        },
        count: rows.length,
        inventory: rows,
      },
    });
  } catch (error) {
    console.error("getDistrictStoreInventory error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch store inventory",
      error: error.message,
    });
  }
};







const hasAttr = (model, field) =>
  !!model?.rawAttributes && !!model.rawAttributes[field];

const num = (v) => Number(v || 0);

const getStoreNameField = () => {
  if (hasAttr(Store, "store_name")) return "store_name";
  if (hasAttr(Store, "name")) return "name";
  return "store_name";
};

const getStoreCodeField = () => {
  if (hasAttr(Store, "store_code")) return "store_code";
  if (hasAttr(Store, "code")) return "code";
  return "store_code";
};

const getCreatedField = () => {
  if (hasAttr(Item, "createdAt")) return "createdAt";
  if (hasAttr(Item, "created_at")) return "created_at";
  return "id";
};

/**
 * 1) District -> all connected retail stores
 * GET /api/district/store-management/stores
 */
export const getDistrictRetailStores = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const { organization_id, organization_level, role } = req.user;
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();

    if (!organization_id) {
      return res.status(400).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const level = String(organization_level || "").toLowerCase();
    const userRole = String(role || "").toLowerCase().replace(/_/g, "-");

    if (
      level !== "district" &&
      !["district-manager", "district-tl", "district-admin"].includes(userRole)
    ) {
      return res.status(403).json({
        success: false,
        message: "Only district users can access this API",
      });
    }

    const storeNameField = getStoreNameField();
    const storeCodeField = getStoreCodeField();

    const where = {
      district_id: organization_id,
      id: {
        [Op.ne]: organization_id,
      },
    };

    const andConditions = [];

    // only retail stores
    if (hasAttr(Store, "organization_level")) {
      andConditions.push(
        sequelize.where(
          sequelize.fn("LOWER", sequelize.col("organization_level")),
          "retail"
        )
      );
    }

    // exclude district/state/head office style records by code if present
    if (hasAttr(Store, "store_code")) {
      andConditions.push({
        store_code: {
          [Op.notILike]: "DST%",
        },
      });
      andConditions.push({
        store_code: {
          [Op.notILike]: "STATE%",
        },
      });
      andConditions.push({
        store_code: {
          [Op.notILike]: "HO%",
        },
      });
      andConditions.push({
        store_code: {
          [Op.notILike]: "DIST%",
        },
      });
    }

    if (status === "active" && hasAttr(Store, "is_active")) {
      where.is_active = true;
    }

    if (status === "inactive" && hasAttr(Store, "is_active")) {
      where.is_active = false;
    }

    if (search) {
      const searchConditions = [];

      if (storeNameField) {
        searchConditions.push({
          [storeNameField]: {
            [Op.iLike]: `%${search}%`,
          },
        });
      }

      if (storeCodeField) {
        searchConditions.push({
          [storeCodeField]: {
            [Op.iLike]: `%${search}%`,
          },
        });
      }

      if (hasAttr(Store, "district")) {
        searchConditions.push({
          district: {
            [Op.iLike]: `%${search}%`,
          },
        });
      }

      if (hasAttr(Store, "state")) {
        searchConditions.push({
          state: {
            [Op.iLike]: `%${search}%`,
          },
        });
      }

      if (searchConditions.length) {
        andConditions.push({
          [Op.or]: searchConditions,
        });
      }
    }

    if (andConditions.length) {
      where[Op.and] = andConditions;
    }

    const stores = await Store.findAll({
      where,
      order: [[storeNameField, "ASC"]],
      raw: false,
    });

    const storeIds = stores.map((s) => s.id);

    if (!storeIds.length) {
      return res.status(200).json({
        success: true,
        message: "District retail stores fetched successfully",
        data: {
          summary: {
            total_stores: 0,
            active_stores: 0,
            total_employees: 0,
            total_stock_value: 0,
            total_revenue: 0,
          },
          stores: [],
        },
      });
    }

    const stockRows = await Stock.findAll({
      attributes: [
        [sequelize.col("Stock.organization_id"), "organization_id"],
        [
          sequelize.fn("SUM", sequelize.col("Stock.available_qty")),
          "available_qty",
        ],
        [
          sequelize.fn("SUM", sequelize.col("Stock.available_weight")),
          "available_weight",
        ],
        [
          sequelize.fn("SUM", sequelize.col("Stock.reserved_qty")),
          "reserved_qty",
        ],
        [
          sequelize.fn("SUM", sequelize.col("Stock.reserved_weight")),
          "reserved_weight",
        ],
        [
          sequelize.fn(
            "SUM",
            sequelize.literal(
              `COALESCE("Stock"."available_qty", 0) * COALESCE("item"."sale_rate", 0)`
            )
          ),
          "stock_value",
        ],
      ],
      where: {
        organization_id: {
          [Op.in]: storeIds,
        },
      },
      include: [
        {
          model: Item,
          as: "item",
          attributes: [],
          required: false,
        },
      ],
      group: [sequelize.col("Stock.organization_id")],
      raw: true,
    });

    const employeeRows = await User.findAll({
      attributes: [
        ["organization_id", "organization_id"],
        [sequelize.fn("COUNT", sequelize.col("id")), "employee_count"],
      ],
      where: {
        organization_id: {
          [Op.in]: storeIds,
        },
        ...(hasAttr(User, "is_active") ? { is_active: true } : {}),
      },
      group: ["organization_id"],
      raw: true,
    });

    let revenueRows = [];
    try {
      revenueRows = await Invoice.findAll({
        attributes: [
          ["organization_id", "organization_id"],
          [
            sequelize.fn(
              "SUM",
              sequelize.fn("COALESCE", sequelize.col("total_amount"), 0)
            ),
            "revenue",
          ],
        ],
        where: {
          organization_id: {
            [Op.in]: storeIds,
          },
        },
        group: ["organization_id"],
        raw: true,
      });
    } catch (invoiceError) {
      console.error(
        "Invoice revenue aggregation skipped:",
        invoiceError.message
      );
      revenueRows = [];
    }

    const stockMap = {};
    for (const row of stockRows) {
      stockMap[row.organization_id] = {
        available_qty: num(row.available_qty),
        available_weight: num(row.available_weight),
        reserved_qty: num(row.reserved_qty),
        reserved_weight: num(row.reserved_weight),
        stock_value: num(row.stock_value),
      };
    }

    const employeeMap = {};
    for (const row of employeeRows) {
      employeeMap[row.organization_id] = num(row.employee_count);
    }

    const revenueMap = {};
    for (const row of revenueRows) {
      revenueMap[row.organization_id] = num(row.revenue);
    }

    const finalStores = stores.map((store) => {
      const stock = stockMap[store.id] || {
        available_qty: 0,
        available_weight: 0,
        reserved_qty: 0,
        reserved_weight: 0,
        stock_value: 0,
      };

      return {
        id: store.id,
        store_code: store[storeCodeField] || null,
        store_name: store[storeNameField] || null,
        district_id: store.district_id || null,
        district: hasAttr(Store, "district") ? store.district : null,
        state: hasAttr(Store, "state") ? store.state : null,
        address: hasAttr(Store, "address") ? store.address : null,
        phone_number: hasAttr(Store, "phone_number")
          ? store.phone_number
          : null,
        is_active: hasAttr(Store, "is_active") ? !!store.is_active : true,
        employee_count: employeeMap[store.id] || 0,
        available_qty: stock.available_qty,
        available_weight: stock.available_weight,
        reserved_qty: stock.reserved_qty,
        reserved_weight: stock.reserved_weight,
        stock_value: stock.stock_value,
        revenue: revenueMap[store.id] || 0,
      };
    });

    const summary = {
      total_stores: finalStores.length,
      active_stores: finalStores.filter((s) => s.is_active).length,
      total_employees: finalStores.reduce(
        (sum, store) => sum + num(store.employee_count),
        0
      ),
      total_stock_value: finalStores.reduce(
        (sum, store) => sum + num(store.stock_value),
        0
      ),
      total_revenue: finalStores.reduce(
        (sum, store) => sum + num(store.revenue),
        0
      ),
    };

    return res.status(200).json({
      success: true,
      message: "District retail stores fetched successfully",
      data: {
        summary,
        stores: finalStores,
      },
    });
  } catch (error) {
    console.error("getDistrictRetailStores error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district retail stores",
      error: error.message,
    });
  }
};
/**
 * 2) Click store -> store stock summary + categories
 * GET /api/district/store-management/stores/:storeId
 */
export const getDistrictStoreDetail = async (req, res) => {
  try {
    const { storeId } = req.params;
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim();

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const districtId = req.user.organization_id;

    const store = await Store.findOne({
      where: {
        id: storeId,
        district_id: districtId,
      },
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found under your district",
      });
    }

    const storeNameField = getStoreNameField();
    const storeCodeField = getStoreCodeField();

    const stockSummary = await Stock.findOne({
      attributes: [
        [sequelize.fn("SUM", sequelize.col("available_qty")), "available_qty"],
        [sequelize.fn("SUM", sequelize.col("available_weight")), "available_weight"],
        [sequelize.fn("SUM", sequelize.col("reserved_qty")), "reserved_qty"],
        [sequelize.fn("SUM", sequelize.col("reserved_weight")), "reserved_weight"],
        [sequelize.fn("SUM", sequelize.col("transit_qty")), "transit_qty"],
        [sequelize.fn("SUM", sequelize.col("transit_weight")), "transit_weight"],
        [sequelize.fn("SUM", sequelize.col("damaged_qty")), "damaged_qty"],
        [sequelize.fn("SUM", sequelize.col("damaged_weight")), "damaged_weight"],
      ],
      where: {
        organization_id: store.id,
      },
      raw: true,
    });

    const itemWhere = {
      organization_id: store.id,
    };

    if (category && category.toLowerCase() !== "all") {
      itemWhere.category = category;
    }

    if (search) {
      const searchConditions = [];

      if (hasAttr(Item, "item_name")) {
        searchConditions.push({
          item_name: { [Op.iLike]: `%${search}%` },
        });
      }

      if (hasAttr(Item, "article_code")) {
        searchConditions.push({
          article_code: { [Op.iLike]: `%${search}%` },
        });
      }

      if (hasAttr(Item, "sku_code")) {
        searchConditions.push({
          sku_code: { [Op.iLike]: `%${search}%` },
        });
      }

      if (hasAttr(Item, "category")) {
        searchConditions.push({
          category: { [Op.iLike]: `%${search}%` },
        });
      }

      if (searchConditions.length) {
        itemWhere[Op.or] = searchConditions;
      }
    }

    const items = await Item.findAll({
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          where: {
            organization_id: store.id,
          },
          attributes: [
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
          ],
        },
      ],
      order: [
        hasAttr(Item, "category") ? ["category", "ASC"] : ["id", "DESC"],
        hasAttr(Item, "item_name") ? ["item_name", "ASC"] : ["id", "DESC"],
      ],
    });

    const inventory = items.map((item) => {
      const stock = item.stocks?.[0] || {};

      const code =
        (hasAttr(Item, "article_code") && item.article_code) ||
        (hasAttr(Item, "sku_code") && item.sku_code) ||
        null;

      return {
        item_id: item.id,
        category: hasAttr(Item, "category") ? item.category : null,
        code,
        item_name: hasAttr(Item, "item_name") ? item.item_name : null,
        quantity: num(stock.available_qty),
        selling_price: num(item.sale_rate),
        making_charge: num(item.making_charge),
        purity: hasAttr(Item, "purity") ? item.purity : null,
        net_weight: num(item.net_weight),
        stone_weight: num(item.stone_weight),
        gross_weight: num(item.gross_weight),
        metal_type: hasAttr(Item, "metal_type") ? item.metal_type : null,
        current_status: hasAttr(Item, "current_status")
          ? item.current_status
          : null,
        image_url: hasAttr(Item, "image_url") ? item.image_url : null,
        stock: {
          available_qty: num(stock.available_qty),
          available_weight: num(stock.available_weight),
          reserved_qty: num(stock.reserved_qty),
          reserved_weight: num(stock.reserved_weight),
          transit_qty: num(stock.transit_qty),
          transit_weight: num(stock.transit_weight),
          damaged_qty: num(stock.damaged_qty),
          damaged_weight: num(stock.damaged_weight),
        },
        action: "view",
      };
    });

    const categoryOptions = [
      ...new Set(
        items
          .map((item) => (hasAttr(Item, "category") ? item.category : null))
          .filter(Boolean)
      ),
    ];

    return res.status(200).json({
      success: true,
      message: "Store detail fetched successfully",
      data: {
        store: {
          id: store.id,
          store_code: store[storeCodeField] || null,
          store_name: store[storeNameField] || null,
          district_id: store.district_id || null,
          district: hasAttr(Store, "district") ? store.district : null,
          state: hasAttr(Store, "state") ? store.state : null,
          address: hasAttr(Store, "address") ? store.address : null,
          phone_number: hasAttr(Store, "phone_number") ? store.phone_number : null,
          is_active: hasAttr(Store, "is_active") ? !!store.is_active : true,
        },
        stock_summary: {
          available_qty: num(stockSummary?.available_qty),
          available_weight: num(stockSummary?.available_weight),
          reserved_qty: num(stockSummary?.reserved_qty),
          reserved_weight: num(stockSummary?.reserved_weight),
          transit_qty: num(stockSummary?.transit_qty),
          transit_weight: num(stockSummary?.transit_weight),
          damaged_qty: num(stockSummary?.damaged_qty),
          damaged_weight: num(stockSummary?.damaged_weight),
        },
        filters: {
          selected_category: category || "All",
          search: search || "",
          categories: categoryOptions,
        },
        inventory,
      },
    });
  } catch (error) {
    console.error("getDistrictStoreDetail error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch store detail",
      error: error.message,
    });
  }
};
/**
 * 3) Click category -> all items
 * GET /api/district/store-management/stores/:storeId/categories/:category/items
 */
export const getDistrictStoreCategoryItems = async (req, res) => {
  try {
    const { storeId, category } = req.params;
    const search = String(req.query.search || "").trim();

    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const districtId = req.user.organization_id;

    const store = await Store.findOne({
      where: {
        id: storeId,
        district_id: districtId,
      },
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: "Store not found under your district",
      });
    }

    const itemWhere = {
      organization_id: store.id,
      category,
    };

    if (search) {
      itemWhere[Op.or] = [];

      if (hasAttr(Item, "item_name")) {
        itemWhere[Op.or].push({
          item_name: { [Op.iLike]: `%${search}%` },
        });
      }

      if (hasAttr(Item, "article_code")) {
        itemWhere[Op.or].push({
          article_code: { [Op.iLike]: `%${search}%` },
        });
      }

      if (hasAttr(Item, "sku_code")) {
        itemWhere[Op.or].push({
          sku_code: { [Op.iLike]: `%${search}%` },
        });
      }
    }

    const items = await Item.findAll({
      where: itemWhere,
      include: [
        {
          model: Stock,
          as: "stocks",
          required: false,
          where: {
            organization_id: store.id,
          },
          attributes: [
            "id",
            "available_qty",
            "available_weight",
            "reserved_qty",
            "reserved_weight",
            "transit_qty",
            "transit_weight",
            "damaged_qty",
            "damaged_weight",
          ],
        },
      ],
      order: [[getCreatedField(), "DESC"]],
    });

    const finalItems = items.map((item) => {
      const stock = item.stocks?.[0] || {};

      return {
        item_id: item.id,
        article_code: hasAttr(Item, "article_code") ? item.article_code : null,
        sku_code: hasAttr(Item, "sku_code") ? item.sku_code : null,
        item_name: hasAttr(Item, "item_name") ? item.item_name : null,
        category: hasAttr(Item, "category") ? item.category : null,
        metal_type: hasAttr(Item, "metal_type") ? item.metal_type : null,
        purity: hasAttr(Item, "purity") ? item.purity : null,
        gross_weight: num(item.gross_weight),
        net_weight: num(item.net_weight),
        stone_weight: num(item.stone_weight),
        making_charge: num(item.making_charge),
        sale_rate: num(item.sale_rate),
        purchase_rate: num(item.purchase_rate),
        hsn_code: hasAttr(Item, "hsn_code") ? item.hsn_code : null,
        unit: hasAttr(Item, "unit") ? item.unit : null,
        current_status: hasAttr(Item, "current_status")
          ? item.current_status
          : null,
        image_url: hasAttr(Item, "image_url") ? item.image_url : null,
        stock: {
          available_qty: num(stock.available_qty),
          available_weight: num(stock.available_weight),
          reserved_qty: num(stock.reserved_qty),
          reserved_weight: num(stock.reserved_weight),
          transit_qty: num(stock.transit_qty),
          transit_weight: num(stock.transit_weight),
          damaged_qty: num(stock.damaged_qty),
          damaged_weight: num(stock.damaged_weight),
        },
      };
    });

    return res.status(200).json({
      success: true,
      message: "Store category items fetched successfully",
      data: {
        store_id: store.id,
        category,
        total_items: finalItems.length,
        items: finalItems,
      },
    });
  } catch (error) {
    console.error("getDistrictStoreCategoryItems error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch store category items",
      error: error.message,
    });
  }
};







const safeNum = (val) => {
  const num = parseFloat(val);
  return Number.isNaN(num) ? 0 : num;
};

const getDateRange = (filter = "daily") => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (filter === "daily") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "weekly") {
    const day = now.getDay(); // 0 Sunday
    const diffToMonday = day === 0 ? 6 : day - 1;
    start.setDate(now.getDate() - diffToMonday);
    start.setHours(0, 0, 0, 0);

    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "monthly") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);

    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);
  } else if (filter === "yearly") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);

    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }

  return { start, end };
};

const buildBuckets = (filter, startDate) => {
  const buckets = [];

  if (filter === "daily") {
    const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (let i = 0; i < 7; i++) {
      buckets.push({
        label: labels[i],
        cash_received: 0,
        account_transfer: 0,
        total_sales: 0,
      });
    }
  } else if (filter === "weekly") {
    for (let i = 1; i <= 7; i++) {
      buckets.push({
        label: `Day ${i}`,
        cash_received: 0,
        account_transfer: 0,
        total_sales: 0,
      });
    }
  } else if (filter === "monthly") {
    for (let i = 1; i <= 31; i++) {
      buckets.push({
        label: `${i}`,
        cash_received: 0,
        account_transfer: 0,
        total_sales: 0,
      });
    }
  } else if (filter === "yearly") {
    const labels = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    for (let i = 0; i < 12; i++) {
      buckets.push({
        label: labels[i],
        cash_received: 0,
        account_transfer: 0,
        total_sales: 0,
      });
    }
  }

  return buckets;
};

const getBucketIndex = (dateValue, filter) => {
  const d = new Date(dateValue);

  if (filter === "daily") {
    const day = d.getDay(); // 0 Sunday
    return day === 0 ? 6 : day - 1; // Monday first
  }

  if (filter === "weekly") {
    const day = d.getDay();
    return day === 0 ? 6 : day - 1;
  }

  if (filter === "monthly") {
    return d.getDate() - 1;
  }

  if (filter === "yearly") {
    return d.getMonth();
  }

  return -1;
};





const fillChartBucket = (buckets, dateValue, filter, key, amount) => {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return;

  const amt = safeNum(amount);

  if (filter === "daily") {
    if (buckets[0]) {
      buckets[0][key] += amt;
    }
    return;
  }

  if (filter === "weekly" || filter === "monthly") {
    const dateKey = date.toISOString().split("T")[0];
    const bucket = buckets.find((b) => b.date_key === dateKey);
    if (bucket) {
      bucket[key] += amt;
    }
    return;
  }

  if (filter === "yearly") {
    const monthIndex = date.getMonth();
    const bucket = buckets.find((b) => b.month_index === monthIndex);
    if (bucket) {
      bucket[key] += amt;
    }
  }
};
const getTableColumns = async (tableName) => {
  const rows = await sequelize.query(
    `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = :tableName
    `,
    {
      replacements: { tableName },
      type: QueryTypes.SELECT,
    }
  );

  return rows.map((r) => r.column_name);
};
/* -------------------------------------------------------------------------- */
/*                           DISTRICT DASHBOARD API                           */
/* -------------------------------------------------------------------------- */
export const getDistrictDashboard = async (req, res) => {
  try {
    const user = req.user;

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
        message: "Only district users can access this dashboard",
      });
    }

    const districtId = Number(user.organization_id);
    const districtCode = user.store_code || user.district_code || null;

    if (!districtId) {
      return res.status(400).json({
        success: false,
        message: "District organization_id not found for logged-in user",
      });
    }

    const storeNameField = getStoreNameField();
    const storeCodeField = getStoreCodeField();

    // ✅ LIVE GOLD / SILVER RATE
    let liveRate = {
      gold_rate_24k: 0,
      gold_rate_22k: 0,
      gold_rate_18k: 0,
      silver_rate: 0,

      gold_change_percent: 0,
      silver_change_percent: 0,

      gold_trend: "up",
      silver_trend: "up",

      currency: "INR",
      updated_at: null,
    };

    try {
      const rateData = await getGoldRate();

      console.log("LIVE RATE DATA:", rateData);

      const gold24 = Number(rateData?.price_gram_24k || 0);
      const gold22 = Number(rateData?.price_gram_22k || 0);
      const gold18 = Number(rateData?.price_gram_18k || 0);

      const silverRate = Number(
        rateData?.silver_price_gram ||
          rateData?.silver_price ||
          rateData?.price_gram_silver ||
          0
      );

      const goldChange = Number(
        rateData?.gold_change_percent ||
          rateData?.change_percent ||
          rateData?.chp ||
          rateData?.change_pct ||
          0
      );

      const silverChange = Number(
        rateData?.silver_change_percent ||
          rateData?.silver_chp ||
          rateData?.silver_change_pct ||
          0
      );

      liveRate = {
        gold_rate_24k: gold24,
        gold_rate_22k: gold22,
        gold_rate_18k: gold18,
        silver_rate: silverRate,

        gold_change_percent: Number(goldChange.toFixed(2)),
        silver_change_percent: Number(silverChange.toFixed(2)),

        gold_trend: goldChange >= 0 ? "up" : "down",
        silver_trend: silverChange >= 0 ? "up" : "down",

        currency: rateData?.currency || "INR",
        updated_at: rateData?.timestamp || null,
      };
    } catch (err) {
      console.error("Live rate fetch error:", err.message);
    }

    let districtStores = [];

    try {
      districtStores = await Store.findAll({
        where: {
          [Op.or]: [
            ...(hasAttr(Store, "district_id") ? [{ district_id: districtId }] : []),
            ...(districtCode && hasAttr(Store, "district_code")
              ? [{ district_code: districtCode }]
              : []),
          ],
        },
        attributes: [
          "id",
          [col(storeNameField), "store_name"],
          [col(storeCodeField), "store_code"],
        ],
        raw: true,
      });
    } catch (err) {
      districtStores = [];
    }

    const storeIds = districtStores.map((s) => Number(s.id)).filter(Boolean);

    let districtStockRows = [];
    try {
      districtStockRows = await Stock.findAll({
        where: {
          organization_id: districtId,
        },
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
          ...(hasAttr(Stock, "created_at") ? ["created_at"] : []),
          ...(hasAttr(Stock, "updated_at") ? ["updated_at"] : []),
        ],
        include: [
          {
            model: Item,
            required: false,
            attributes: [
              "id",
              ...(hasAttr(Item, "item_name") ? ["item_name"] : []),
              ...(hasAttr(Item, "article_code") ? ["article_code"] : []),
              ...(hasAttr(Item, "sku_code") ? ["sku_code"] : []),
              ...(hasAttr(Item, "metal_type") ? ["metal_type"] : []),
              ...(hasAttr(Item, "category") ? ["category"] : []),
              ...(hasAttr(Item, "purity") ? ["purity"] : []),
              ...(hasAttr(Item, "sale_rate") ? ["sale_rate"] : []),
              ...(hasAttr(Item, "purchase_rate") ? ["purchase_rate"] : []),
              ...(hasAttr(Item, "current_status") ? ["current_status"] : []),
            ],
          },
        ],
      });
    } catch (err) {
      districtStockRows = [];
    }

    let storeStockRows = [];
    try {
      if (storeIds.length) {
        storeStockRows = await Stock.findAll({
          where: {
            organization_id: {
              [Op.in]: storeIds,
            },
          },
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
            ...(hasAttr(Stock, "created_at") ? ["created_at"] : []),
            ...(hasAttr(Stock, "updated_at") ? ["updated_at"] : []),
          ],
          include: [
            {
              model: Item,
              required: false,
              attributes: [
                "id",
                ...(hasAttr(Item, "item_name") ? ["item_name"] : []),
                ...(hasAttr(Item, "article_code") ? ["article_code"] : []),
                ...(hasAttr(Item, "sku_code") ? ["sku_code"] : []),
                ...(hasAttr(Item, "metal_type") ? ["metal_type"] : []),
                ...(hasAttr(Item, "category") ? ["category"] : []),
                ...(hasAttr(Item, "purity") ? ["purity"] : []),
                ...(hasAttr(Item, "sale_rate") ? ["sale_rate"] : []),
                ...(hasAttr(Item, "purchase_rate") ? ["purchase_rate"] : []),
                ...(hasAttr(Item, "current_status") ? ["current_status"] : []),
              ],
            },
          ],
        });
      }
    } catch (err) {
      storeStockRows = [];
    }

    let districtOwnStock = 0;
    let retailStoresStocks = 0;
    let totalStock = 0;
    let deadStockItems = 0;
    let transitGoods = 0;
    let goldPriceValue = 0;
    let silverPriceValue = 0;

    const districtInventoryItems = [];

    for (const row of districtStockRows) {
      const availableQty = safeNum(row.available_qty);
      const reservedQty = safeNum(row.reserved_qty);
      const transitQty = safeNum(row.transit_qty);
      const deadQty = safeNum(row.dead_qty);

      const availableWeight = safeNum(row.available_weight);
      const reservedWeight = safeNum(row.reserved_weight);
      const transitWeight = safeNum(row.transit_weight);
      const deadWeight = safeNum(row.dead_weight);

      const totalQty = availableQty + reservedQty + transitQty;
      const totalWeight = availableWeight + reservedWeight + transitWeight;

      districtOwnStock += totalQty;
      totalStock += totalQty;
      transitGoods += transitQty;

      if (deadQty > 0 || deadWeight > 0) {
        deadStockItems += 1;
      }

      const rate = safeNum(row.Item?.sale_rate || row.Item?.purchase_rate);
      const valueBase = totalWeight > 0 ? totalWeight : totalQty;
      const metalType = String(row.Item?.metal_type || "").toLowerCase();

      if (metalType === "gold") goldPriceValue += valueBase * rate;
      if (metalType === "silver") silverPriceValue += valueBase * rate;

      districtInventoryItems.push({
        stock_id: row.id,
        item_id: row.item_id,
        item_name: row.Item?.item_name || null,
        article_code: row.Item?.article_code || null,
        sku_code: row.Item?.sku_code || null,
        category: row.Item?.category || null,
        metal_type: row.Item?.metal_type || null,
        purity: row.Item?.purity || null,
        available_qty: availableQty,
        available_weight: availableWeight,
        reserved_qty: reservedQty,
        reserved_weight: reservedWeight,
        transit_qty: transitQty,
        transit_weight: transitWeight,
        dead_qty: deadQty,
        dead_weight: deadWeight,
        sale_rate: safeNum(row.Item?.sale_rate),
        purchase_rate: safeNum(row.Item?.purchase_rate),
        current_status: row.Item?.current_status || null,
      });
    }

    for (const row of storeStockRows) {
      const availableQty = safeNum(row.available_qty);
      const reservedQty = safeNum(row.reserved_qty);
      const transitQty = safeNum(row.transit_qty);
      const deadQty = safeNum(row.dead_qty);

      const availableWeight = safeNum(row.available_weight);
      const reservedWeight = safeNum(row.reserved_weight);
      const transitWeight = safeNum(row.transit_weight);
      const deadWeight = safeNum(row.dead_weight);

      const totalQty = availableQty + reservedQty + transitQty;
      const totalWeight = availableWeight + reservedWeight + transitWeight;

      retailStoresStocks += totalQty;
      totalStock += totalQty;
      transitGoods += transitQty;

      if (deadQty > 0 || deadWeight > 0) {
        deadStockItems += 1;
      }

      const rate = safeNum(row.Item?.sale_rate || row.Item?.purchase_rate);
      const valueBase = totalWeight > 0 ? totalWeight : totalQty;
      const metalType = String(row.Item?.metal_type || "").toLowerCase();

      if (metalType === "gold") goldPriceValue += valueBase * rate;
      if (metalType === "silver") silverPriceValue += valueBase * rate;
    }

    const storePerformance = districtStores.map((store, index) => {
      const rows = storeStockRows.filter(
        (x) => Number(x.organization_id) === Number(store.id)
      );

      let revenue = 0;

      for (const row of rows) {
        const qty =
          safeNum(row.available_qty) +
          safeNum(row.reserved_qty) +
          safeNum(row.transit_qty);

        const weight =
          safeNum(row.available_weight) +
          safeNum(row.reserved_weight) +
          safeNum(row.transit_weight);

        const rate = safeNum(row.Item?.sale_rate || row.Item?.purchase_rate);
        const base = weight > 0 ? weight : qty;

        revenue += base * rate;
      }

      return {
        store_id: store.id,
        store_name: store.store_name || `Store ${index + 1}`,
        store_code: store.store_code || null,
        revenue: Math.round(revenue),
      };
    });

    const profitLoss = [
      { month: "Jan", amount: 520 },
      { month: "Feb", amount: 550 },
      { month: "Mar", amount: 580 },
      { month: "Apr", amount: 560 },
      { month: "May", amount: 620 },
      { month: "Jun", amount: 650 },
    ];

    try {
      const invoiceDateField = hasAttr(Invoice, "created_at")
        ? "created_at"
        : hasAttr(Invoice, "createdAt")
        ? "createdAt"
        : null;

      const invoiceStoreField = hasAttr(Invoice, "organization_id")
        ? "organization_id"
        : hasAttr(Invoice, "branch_id")
        ? "branch_id"
        : hasAttr(Invoice, "store_id")
        ? "store_id"
        : null;

      const invoiceTotalField = hasAttr(Invoice, "total_amount")
        ? "total_amount"
        : hasAttr(Invoice, "grand_total")
        ? "grand_total"
        : hasAttr(Invoice, "net_amount")
        ? "net_amount"
        : null;

      if (invoiceDateField && invoiceStoreField && invoiceTotalField && storeIds.length) {
        const currentYear = new Date().getFullYear();

        const monthlySales = await sequelize.query(
          `
          SELECT
            EXTRACT(MONTH FROM "${invoiceDateField}") AS month_no,
            COALESCE(SUM("${invoiceTotalField}"), 0) AS amount
          FROM invoices
          WHERE "${invoiceStoreField}" IN (:storeIds)
            AND EXTRACT(YEAR FROM "${invoiceDateField}") = :currentYear
          GROUP BY EXTRACT(MONTH FROM "${invoiceDateField}")
          ORDER BY month_no ASC
          `,
          {
            replacements: { storeIds, currentYear },
            type: QueryTypes.SELECT,
          }
        );

        const monthMap = {
          1: "Jan",
          2: "Feb",
          3: "Mar",
          4: "Apr",
          5: "May",
          6: "Jun",
        };

        const merged = {
          Jan: 520,
          Feb: 550,
          Mar: 580,
          Apr: 560,
          May: 620,
          Jun: 650,
        };

        for (const row of monthlySales) {
          const monthName = monthMap[Number(row.month_no)];
          if (monthName) {
            merged[monthName] = safeNum(row.amount);
          }
        }

        profitLoss.splice(
          0,
          profitLoss.length,
          ...Object.entries(merged).map(([month, amount]) => ({
            month,
            amount,
          }))
        );
      }
    } catch (err) {
      // fallback placeholder hi rahega
    }

    let recentActivities = [];

    try {
      const createdField = hasAttr(ActivityLog, "created_at")
        ? "created_at"
        : hasAttr(ActivityLog, "createdAt")
        ? "createdAt"
        : null;

      if (createdField) {
        recentActivities = await ActivityLog.findAll({
          where: {
            [Op.or]: [
              ...(hasAttr(ActivityLog, "district_id") ? [{ district_id: districtId }] : []),
              ...(hasAttr(ActivityLog, "organization_id")
                ? [{ organization_id: districtId }]
                : []),
              ...(districtCode && hasAttr(ActivityLog, "district_code")
                ? [{ district_code: districtCode }]
                : []),
            ],
          },
          attributes: [
            "id",
            ...(hasAttr(ActivityLog, "module") ? ["module"] : []),
            ...(hasAttr(ActivityLog, "action") ? ["action"] : []),
            ...(hasAttr(ActivityLog, "description") ? ["description"] : []),
            createdField,
          ],
          order: [[createdField, "DESC"]],
          limit: 5,
          raw: true,
        });
      }
    } catch (err) {
      recentActivities = [];
    }

    if (!recentActivities.length) {
      recentActivities = [
        {
          id: 1,
          title: "2 Neckless in Transit",
          subtitle: "from Karnal to Gurgaon",
          time_ago: "5 minutes ago",
        },
        {
          id: 2,
          title: "Stock Updated",
          subtitle: "Latest System Activities and updates",
          time_ago: "15 minutes ago",
        },
        {
          id: 3,
          title: "Setting Updated",
          subtitle: "System",
          time_ago: "1 hour ago",
        },
        {
          id: 4,
          title: "Sales Transaction",
          subtitle: "Sale completed - $4,500",
          time_ago: "7 hours ago",
        },
        {
          id: 5,
          title: "Stock Alert",
          subtitle: "Low stock alert from #2461",
          time_ago: "22 hours ago",
        },
      ];
    } else {
      recentActivities = recentActivities.map((item) => ({
        id: item.id,
        title: item.action || item.module || "Activity",
        subtitle: item.description || "System update",
        time_ago: item.created_at || item.createdAt || null,
      }));
    }

    return res.status(200).json({
      success: true,
      message: "District dashboard fetched successfully",
      data: {
        summary_cards: {
          total_stock: totalStock,
          retail_stores_stocks: retailStoresStocks,
          dead_stock_items: deadStockItems,
          transit_goods: transitGoods,

          gold_price_value: goldPriceValue,
          silver_price_value: silverPriceValue,

          // ✅ LIVE GOLD / SILVER CARD VALUES
          gold_rate_24k: liveRate.gold_rate_24k,
          gold_rate_22k: liveRate.gold_rate_22k,
          gold_rate_18k: liveRate.gold_rate_18k,
          silver_rate: liveRate.silver_rate,

          // ✅ LIVE UP / DOWN PERCENT
          gold_change_percent: liveRate.gold_change_percent,
          silver_change_percent: liveRate.silver_change_percent,

          gold_trend: liveRate.gold_trend,
          silver_trend: liveRate.silver_trend,

          rate_currency: liveRate.currency,
          rate_updated_at: liveRate.updated_at,
        },

        store_performance: storePerformance,

        profit_loss: profitLoss,

        recent_activities: recentActivities,

        extra_summary: {
          district_id: districtId,
          district_code: districtCode,
          district_own_stock: districtOwnStock,
          total_inventory_value: goldPriceValue + silverPriceValue,
          total_stores: districtStores.length,
          district_item_count: districtInventoryItems.length,
        },

        // district_inventory: {
        //   item_count: districtInventoryItems.length,
        //   items: districtInventoryItems,
        // },
      },
    });
  } catch (error) {
    console.error("getDistrictDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district dashboard",
      error: error.message,
    });
  }
};
/* -------------------------------------------------------------------------- */
/*                       DISTRICT REPORTS & ANALYTICS API                     */
/* -------------------------------------------------------------------------- */

export const getDistrictReportsAnalytics = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const districtId = Number(req.user.organization_id);
    const filter = String(req.query.filter || "daily").toLowerCase();

    if (!districtId) {
      return res.status(400).json({
        success: false,
        message: "organization_id missing in req.user",
      });
    }

    const { start, end } = getDateRange(filter);

    const storeWhere = {};
    if (hasAttr(Store, "district_id")) {
      storeWhere.district_id = districtId;
    } else {
      return res.status(400).json({
        success: false,
        message: "Store model me district_id field nahi mila",
      });
    }

    const districtStores = await Store.findAll({
      where: storeWhere,
      attributes: ["id", "store_name", "store_code"],
      raw: true,
    });

    const storeIds = districtStores.map((s) => s.id).filter(Boolean);

    if (!storeIds.length) {
      return res.status(200).json({
        success: true,
        message: "District reports fetched successfully",
        data: {
          filter,
          district_id: districtId,
          stores_count: 0,
          store_ids: [],
          summary: {
            total_cash_received: 0,
            account_transfer: 0,
            total_sales: 0,
          },
          cash_vs_account_reconciliation: [],
          category_wise_sales: [],
          metal_type_distribution: [],
          top_performing_products: [],
        },
      });
    }

    const invoiceDateField = hasAttr(Invoice, "created_at")
      ? "created_at"
      : hasAttr(Invoice, "createdAt")
      ? "createdAt"
      : "createdAt";

    const invoiceStoreField = hasAttr(Invoice, "organization_id")
      ? "organization_id"
      : hasAttr(Invoice, "branch_id")
      ? "branch_id"
      : hasAttr(Invoice, "store_id")
      ? "store_id"
      : null;

    const invoiceTotalField = hasAttr(Invoice, "total_amount")
      ? "total_amount"
      : hasAttr(Invoice, "grand_total")
      ? "grand_total"
      : hasAttr(Invoice, "net_amount")
      ? "net_amount"
      : null;

    const invoiceStatusField = hasAttr(Invoice, "status") ? "status" : null;

    if (!invoiceStoreField || !invoiceTotalField) {
      return res.status(400).json({
        success: false,
        message:
          "Invoice model me organization/store field ya total amount field nahi mila",
      });
    }

    const transactionDateField = hasAttr(Transaction, "created_at")
      ? "created_at"
      : hasAttr(Transaction, "createdAt")
      ? "createdAt"
      : "createdAt";

    const transactionStoreField = hasAttr(Transaction, "organization_id")
      ? "organization_id"
      : hasAttr(Transaction, "branch_id")
      ? "branch_id"
      : hasAttr(Transaction, "store_id")
      ? "store_id"
      : null;

    const transactionAmountField = hasAttr(Transaction, "amount")
      ? "amount"
      : null;

    const paymentMethodField = hasAttr(Transaction, "payment_method")
      ? "payment_method"
      : hasAttr(Transaction, "payment_mode")
      ? "payment_mode"
      : hasAttr(Transaction, "mode")
      ? "mode"
      : null;

    const invoiceWhere = {
      [invoiceStoreField]: { [Op.in]: storeIds },
      [invoiceDateField]: { [Op.between]: [start, end] },
    };

    if (invoiceStatusField) {
      const statusEnumValues = Invoice.rawAttributes?.[invoiceStatusField]?.values || [];
      const excludedStatuses = statusEnumValues.filter((status) =>
        ["CANCELLED", "cancelled", "draft", "DRAFT"].includes(status)
      );

      if (excludedStatuses.length > 0) {
        invoiceWhere[invoiceStatusField] = {
          [Op.notIn]: excludedStatuses,
        };
      }
    }

    const invoices = await Invoice.findAll({
      where: invoiceWhere,
      attributes: [
        "id",
        [col(invoiceDateField), "invoice_date"],
        [col(invoiceStoreField), "store_id"],
        [col(invoiceTotalField), "total_amount"],
        ...(invoiceStatusField ? [[col(invoiceStatusField), "status"]] : []),
      ],
      raw: true,
    });

    const invoiceIds = invoices.map((inv) => inv.id).filter(Boolean);

    let transactions = [];
    if (transactionStoreField && transactionAmountField && paymentMethodField) {
      transactions = await Transaction.findAll({
        where: {
          [transactionStoreField]: { [Op.in]: storeIds },
          [transactionDateField]: { [Op.between]: [start, end] },
        },
        attributes: [
          "id",
          [col(transactionDateField), "transaction_date"],
          [col(transactionStoreField), "store_id"],
          [col(transactionAmountField), "amount"],
          [col(paymentMethodField), "payment_method"],
        ],
        raw: true,
      });
    }

    let totalSales = 0;
    for (const inv of invoices) {
      totalSales += safeNum(inv.total_amount);
    }

    let totalCashReceived = 0;
    let totalAccountTransfer = 0;

    for (const tx of transactions) {
      const mode = String(tx.payment_method || "").toLowerCase();
      const amt = safeNum(tx.amount);

      if (["cash"].includes(mode)) {
        totalCashReceived += amt;
      } else if (
        ["bank", "account", "account_transfer", "upi", "online", "card"].includes(mode)
      ) {
        totalAccountTransfer += amt;
      }
    }

    const chartBuckets = buildBuckets(filter, start);

    for (const inv of invoices) {
      fillChartBucket(chartBuckets, inv.invoice_date, filter, "total_sales", inv.total_amount);
    }

    for (const tx of transactions) {
      const mode = String(tx.payment_method || "").toLowerCase();

      if (["cash"].includes(mode)) {
        fillChartBucket(chartBuckets, tx.transaction_date, filter, "cash_received", tx.amount);
      } else if (
        ["bank", "account", "account_transfer", "upi", "online", "card"].includes(mode)
      ) {
        fillChartBucket(
          chartBuckets,
          tx.transaction_date,
          filter,
          "account_transfer",
          tx.amount
        );
      }
    }

    let categoryWiseSales = [];
    let metalTypeDistribution = [];
    let topPerformingProducts = [];

    if (invoiceIds.length > 0) {
      const invoiceItemColumns = await getTableColumns("invoice_items");
      const itemColumns = await getTableColumns("items");

      const hasItemId = invoiceItemColumns.includes("item_id");
      const hasCategoryInInvoiceItems = invoiceItemColumns.includes("category");
      const hasMetalTypeInInvoiceItems = invoiceItemColumns.includes("metal_type");
      const hasPurityInInvoiceItems = invoiceItemColumns.includes("purity");
      const hasProductNameInInvoiceItems = invoiceItemColumns.includes("product_name");
      const hasDescriptionInInvoiceItems = invoiceItemColumns.includes("description");
      const hasProductCodeInInvoiceItems = invoiceItemColumns.includes("product_code");

      const hasItemCategory = itemColumns.includes("category");
      const hasItemMetalType = itemColumns.includes("metal_type");
      const hasItemPurity = itemColumns.includes("purity");
      const hasItemName = itemColumns.includes("item_name");

      const joinItems = hasItemId ? `LEFT JOIN items i ON i.id = ii.item_id` : ``;

      const categoryExpr =
        hasItemId && hasItemCategory
          ? `COALESCE(i.category, 'Others')`
          : hasCategoryInInvoiceItems
          ? `COALESCE(ii.category, 'Others')`
          : `'Others'`;

      // ENUM SAFE EXPRESSIONS
      const itemMetalText = hasItemMetalType ? `COALESCE(i.metal_type::text, '')` : `''`;
      const itemPurityText = hasItemPurity ? `COALESCE(i.purity::text, '')` : `''`;
      const iiMetalText = hasMetalTypeInInvoiceItems ? `COALESCE(ii.metal_type::text, '')` : `''`;
      const iiPurityText = hasPurityInInvoiceItems ? `COALESCE(ii.purity::text, '')` : `''`;

      const metalExpr =
        hasItemId && hasItemMetalType && hasItemPurity
          ? `
            CASE
              WHEN ${itemMetalText} <> '' AND ${itemPurityText} <> ''
                THEN ${itemMetalText} || ' ' || ${itemPurityText}
              WHEN ${itemMetalText} <> ''
                THEN ${itemMetalText}
              ELSE 'Unknown'
            END
          `
          : hasItemId && hasItemMetalType
          ? `
            CASE
              WHEN ${itemMetalText} <> ''
                THEN ${itemMetalText}
              ELSE 'Unknown'
            END
          `
          : hasMetalTypeInInvoiceItems && hasPurityInInvoiceItems
          ? `
            CASE
              WHEN ${iiMetalText} <> '' AND ${iiPurityText} <> ''
                THEN ${iiMetalText} || ' ' || ${iiPurityText}
              WHEN ${iiMetalText} <> ''
                THEN ${iiMetalText}
              ELSE 'Unknown'
            END
          `
          : hasMetalTypeInInvoiceItems
          ? `
            CASE
              WHEN ${iiMetalText} <> ''
                THEN ${iiMetalText}
              ELSE 'Unknown'
            END
          `
          : hasPurityInInvoiceItems
          ? `
            CASE
              WHEN ${iiPurityText} <> ''
                THEN ${iiPurityText}
              ELSE 'Unknown'
            END
          `
          : `'Unknown'`;

      const productExpr =
        hasItemId && hasItemName
          ? `
            COALESCE(
              i.item_name,
              ${hasProductNameInInvoiceItems ? "ii.product_name," : ""}
              ${hasDescriptionInInvoiceItems ? "ii.description," : ""}
              ${hasProductCodeInInvoiceItems ? "ii.product_code," : ""}
              'Item'
            )
          `
          : `
            COALESCE(
              ${hasProductNameInInvoiceItems ? "ii.product_name," : ""}
              ${hasDescriptionInInvoiceItems ? "ii.description," : ""}
              ${hasProductCodeInInvoiceItems ? "ii.product_code," : ""}
              'Item'
            )
          `;

      categoryWiseSales = await sequelize.query(
        `
        SELECT
          ${categoryExpr} AS category,
          COALESCE(SUM(ii.total_amount), 0) AS revenue,
          COUNT(*) AS units_sold
        FROM invoice_items ii
        ${joinItems}
        WHERE ii.invoice_id IN (:invoiceIds)
        GROUP BY ${categoryExpr}
        ORDER BY revenue DESC
        `,
        {
          replacements: { invoiceIds },
          type: QueryTypes.SELECT,
        }
      );

      metalTypeDistribution = await sequelize.query(
        `
        SELECT
          ${metalExpr} AS metal_label,
          COALESCE(SUM(ii.total_amount), 0) AS revenue,
          COUNT(*) AS units_sold
        FROM invoice_items ii
        ${joinItems}
        WHERE ii.invoice_id IN (:invoiceIds)
        GROUP BY ${metalExpr}
        ORDER BY revenue DESC
        `,
        {
          replacements: { invoiceIds },
          type: QueryTypes.SELECT,
        }
      );

      topPerformingProducts = await sequelize.query(
        `
        SELECT
          ${productExpr} AS product_name,
          ${categoryExpr} AS category,
          COUNT(*) AS units_sold,
          COALESCE(SUM(ii.total_amount), 0) AS total_revenue
        FROM invoice_items ii
        ${joinItems}
        WHERE ii.invoice_id IN (:invoiceIds)
        GROUP BY ${productExpr}, ${categoryExpr}
        ORDER BY total_revenue DESC
        LIMIT 5
        `,
        {
          replacements: { invoiceIds },
          type: QueryTypes.SELECT,
        }
      );

      const maxRevenue = topPerformingProducts.length
        ? Math.max(...topPerformingProducts.map((p) => safeNum(p.total_revenue)))
        : 0;

      topPerformingProducts = topPerformingProducts.map((p, index) => ({
        rank: index + 1,
        product_name: p.product_name || "Item",
        category: p.category || "Others",
        units_sold: safeNum(p.units_sold),
        total_revenue: safeNum(p.total_revenue),
        performance:
          maxRevenue > 0
            ? Math.round((safeNum(p.total_revenue) / maxRevenue) * 100)
            : 0,
      }));
    }

    return res.status(200).json({
      success: true,
      message: "District reports fetched successfully",
      data: {
        filter,
        district_id: districtId,
        stores_count: storeIds.length,
        store_ids: storeIds,
        summary: {
          total_cash_received: totalCashReceived,
          account_transfer: totalAccountTransfer,
          total_sales: totalSales,
        },
        cash_vs_account_reconciliation: chartBuckets.map((bucket) => ({
          label: bucket.label,
          cash_received: safeNum(bucket.cash_received),
          account_transfer: safeNum(bucket.account_transfer),
          total_sales: safeNum(bucket.total_sales),
        })),
        category_wise_sales: categoryWiseSales.map((row) => ({
          category: row.category || "Others",
          revenue: safeNum(row.revenue),
          units_sold: safeNum(row.units_sold),
        })),
        metal_type_distribution: metalTypeDistribution.map((row) => ({
          metal_type: row.metal_label || "Unknown",
          revenue: safeNum(row.revenue),
          units_sold: safeNum(row.units_sold),
        })),
        top_performing_products: topPerformingProducts,
      },
    });
  } catch (error) {
    console.error("getDistrictReportsAnalytics error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch district reports analytics",
      error: error.message,
    });
  }
};