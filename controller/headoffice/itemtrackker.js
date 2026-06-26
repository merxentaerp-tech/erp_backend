import { QueryTypes } from "sequelize";
import sequelize from "../../config/db.js";

const toNumber = (value) => Number(value || 0);

const toPositiveInt = (value, fallback = 1) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

const cleanText = (value) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
};

// =====================================================
// GET TRACKER DASHBOARD
// GET /tracker/dashboard
// =====================================================
export const getTrackerDashboard = async (req, res) => {
  try {
    const cardsResult = await sequelize.query(
      `
      SELECT
        COUNT(DISTINCT s.item_id) AS total_items,

        COUNT(DISTINCT CASE
          WHEN COALESCE(s.dead_qty, 0) > 0 THEN s.item_id
        END) AS dead_stock_items,

        COUNT(DISTINCT CASE
          WHEN COALESCE(s.available_qty, 0) < 5 THEN s.item_id
        END) AS low_stock_items,

        COALESCE(SUM(COALESCE(s.transit_qty, 0)), 0) AS transit_goods

      FROM stocks s
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const inventory = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,

        i.id AS item_id,
        i.item_name,
        i.sku_code,
        i.article_code,
        i.category,
        i.purity,

        COALESCE(s.available_qty, 0) AS quantity,
        COALESCE(s.available_weight, 0) AS gross_weight,

        i.purchase_rate,
        i.sale_rate AS selling_price,
        i.making_charge,

        b.status,

        st.store_name,
        st.store_code,
        st.organization_level

      FROM inventory_batches b

      INNER JOIN items i
        ON i.id = b.item_id

      LEFT JOIN stocks s
        ON s.batch_id = b.id

      LEFT JOIN stores st
        ON st.id = s.organization_id

      ORDER BY b.created_at DESC NULLS LAST
      `,
      {
        type: QueryTypes.SELECT,
      }
    );

    const cards = cardsResult?.[0] || {};

    return res.status(200).json({
      success: true,
      message: "Tracker dashboard fetched successfully",
      data: {
        cards: {
          total_items: toNumber(cards.total_items),
          dead_stock_items: toNumber(cards.dead_stock_items),
          low_stock_items: toNumber(cards.low_stock_items),
          transit_goods: toNumber(cards.transit_goods),
        },
        inventory,
      },
    });
  } catch (error) {
    console.error("getTrackerDashboard error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tracker dashboard",
      error: error.message,
    });
  }
};

// =====================================================
// GET CATEGORY ITEMS
// GET /tracker/categories/:category
// =====================================================
export const getTrackerCategoryItems = async (req, res) => {
  try {
    const category = cleanText(req.params.category);

    if (!category) {
      return res.status(400).json({
        success: false,
        message: "category is required",
      });
    }

    const data = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,

        i.id AS item_id,
        i.item_name,
        i.sku_code,
        i.article_code,
        i.category,
        i.purity,

        COALESCE(s.available_qty, 0) AS quantity,
        COALESCE(s.available_weight, 0) AS gross_weight,

        i.purchase_rate,
        i.sale_rate AS selling_price,
        i.making_charge,

        b.status,

        st.store_name,
        st.store_code,
        st.organization_level

      FROM inventory_batches b

      INNER JOIN items i
        ON i.id = b.item_id

      LEFT JOIN stocks s
        ON s.batch_id = b.id

      LEFT JOIN stores st
        ON st.id = s.organization_id

      WHERE LOWER(i.category) = LOWER(:category)

      ORDER BY i.item_name ASC
      `,
      {
        replacements: { category },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Category tracker items fetched successfully",
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getTrackerCategoryItems error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch category tracker items",
      error: error.message,
    });
  }
};

// =====================================================
// GET ALL BATCHES
// GET /tracker/batches
// Query: ?search=&category=&status=&store_id=&page=1&limit=20
// =====================================================
export const getTrackerBatchList = async (req, res) => {
  try {
    const search = cleanText(req.query.search) || "";
    const category = cleanText(req.query.category);
    const status = cleanText(req.query.status);
    const storeId = cleanText(req.query.store_id);

    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, 20), 100);
    const offset = (page - 1) * limit;

    const rows = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,

        i.id AS item_id,
        i.item_name,
        i.sku_code,
        i.article_code,
        i.category,
        i.purity,

        COALESCE(s.available_qty, 0) AS quantity,
        COALESCE(s.available_weight, 0) AS weight,

        st.store_name,
        st.store_code,
        st.organization_level,

        b.status,
        b.created_at

      FROM inventory_batches b

      INNER JOIN items i
        ON i.id = b.item_id

      LEFT JOIN stocks s
        ON s.batch_id = b.id

      LEFT JOIN stores st
        ON st.id = s.organization_id

      WHERE (
        :search = ''
        OR i.item_name ILIKE :searchLike
        OR i.sku_code ILIKE :searchLike
        OR i.article_code ILIKE :searchLike
        OR b.batch_no ILIKE :searchLike
      )

      AND (
        :category IS NULL
        OR LOWER(i.category) = LOWER(:category)
      )

      AND (
        :status IS NULL
        OR b.status = :status
      )

      AND (
        :store_id IS NULL
        OR s.organization_id = CAST(:store_id AS BIGINT)
      )

      ORDER BY b.created_at DESC NULLS LAST

      LIMIT :limit
      OFFSET :offset
      `,
      {
        replacements: {
          search,
          searchLike: `%${search}%`,
          category,
          status,
          store_id: storeId,
          limit,
          offset,
        },
        type: QueryTypes.SELECT,
      }
    );

    const countResult = await sequelize.query(
      `
      SELECT COUNT(*)::INT AS total
      FROM inventory_batches b

      INNER JOIN items i
        ON i.id = b.item_id

      LEFT JOIN stocks s
        ON s.batch_id = b.id

      WHERE (
        :search = ''
        OR i.item_name ILIKE :searchLike
        OR i.sku_code ILIKE :searchLike
        OR i.article_code ILIKE :searchLike
        OR b.batch_no ILIKE :searchLike
      )

      AND (
        :category IS NULL
        OR LOWER(i.category) = LOWER(:category)
      )

      AND (
        :status IS NULL
        OR b.status = :status
      )

      AND (
        :store_id IS NULL
        OR s.organization_id = CAST(:store_id AS BIGINT)
      )
      `,
      {
        replacements: {
          search,
          searchLike: `%${search}%`,
          category,
          status,
          store_id: storeId,
        },
        type: QueryTypes.SELECT,
      }
    );

    const total = toNumber(countResult?.[0]?.total);
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      message: "Tracker batch list fetched successfully",
      page,
      limit,
      total,
      totalPages,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("getTrackerBatchList error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tracker batch list",
      error: error.message,
    });
  }
};

// =====================================================
// GET BATCH DETAILS
// GET /tracker/batches/:batch_id
// =====================================================
export const getTrackerBatchDetails = async (req, res) => {
  try {
    const batchId = cleanText(req.params.batch_id);

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "batch_id is required",
      });
    }

    const batch = await sequelize.query(
      `
      SELECT
        b.id AS batch_id,
        b.batch_no,
        b.status,
        b.total_qty,
        b.available_qty,
        b.total_weight,
        b.available_weight,
        b.created_at,
        b.updated_at,

        i.id AS item_id,
        i.item_name,
        i.sku_code,
        i.article_code,
        i.category,
        i.purity,
        i.purchase_rate,
        i.sale_rate AS selling_price,
        i.making_charge,

        st.store_name,
        st.store_code,
        st.organization_level

      FROM inventory_batches b

      INNER JOIN items i
        ON i.id = b.item_id

      LEFT JOIN stocks s
        ON s.batch_id = b.id

      LEFT JOIN stores st
        ON st.id = s.organization_id

      WHERE b.id = :batch_id

      ORDER BY s.available_qty DESC NULLS LAST

      LIMIT 1
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    if (!batch.length) {
      return res.status(404).json({
        success: false,
        message: "Batch not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Batch details fetched successfully",
      data: batch[0],
    });
  } catch (error) {
    console.error("getTrackerBatchDetails error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch details",
      error: error.message,
    });
  }
};

// =====================================================
// GET BATCH TIMELINE
// GET /tracker/batches/:batch_id/timeline
// =====================================================
export const getTrackerBatchTimeline = async (req, res) => {
  try {
    const batchId = cleanText(req.params.batch_id);

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "batch_id is required",
      });
    }

    const timeline = await sequelize.query(
      `
      SELECT
        bt.id,
        bt.batch_id,
        bt.event_type,
        bt.quantity,
        bt.weight,
        bt.reference_type,
        bt.reference_id,
        bt.remarks,
        bt.event_time,

        fs.store_name AS from_store,
        fs.store_code AS from_store_code,

        ts.store_name AS to_store,
        ts.store_code AS to_store_code,

        u.name AS handled_by

      FROM batch_timelines bt

      LEFT JOIN stores fs
        ON fs.id = bt.from_organization_id

      LEFT JOIN stores ts
        ON ts.id = bt.to_organization_id

      LEFT JOIN users u
        ON u.id = bt.handled_by

      WHERE bt.batch_id = :batch_id

      ORDER BY bt.event_time DESC NULLS LAST, bt.id DESC
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Batch timeline fetched successfully",
      count: timeline.length,
      data: timeline,
    });
  } catch (error) {
    console.error("getTrackerBatchTimeline error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch timeline",
      error: error.message,
    });
  }
};

// =====================================================
// GET FINAL DESTINATIONS
// GET /tracker/batches/:batch_id/destinations
// =====================================================
export const getTrackerDestinations = async (req, res) => {
  try {
    const batchId = cleanText(req.params.batch_id);

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: "batch_id is required",
      });
    }

    const data = await sequelize.query(
      `
      SELECT
        s.organization_id,

        st.store_name,
        st.store_code,
        st.organization_level,

        COALESCE(s.available_qty, 0) AS quantity,
        COALESCE(s.available_weight, 0) AS weight,

        latest.event_type,
        latest.event_time

      FROM stocks s

      INNER JOIN stores st
        ON st.id = s.organization_id

      LEFT JOIN LATERAL (
        SELECT
          bt.event_type,
          bt.event_time
        FROM batch_timelines bt
        WHERE bt.batch_id = s.batch_id
        ORDER BY bt.event_time DESC NULLS LAST
        LIMIT 1
      ) latest ON TRUE

      WHERE s.batch_id = :batch_id

      ORDER BY latest.event_time DESC NULLS LAST, st.store_name ASC
      `,
      {
        replacements: { batch_id: batchId },
        type: QueryTypes.SELECT,
      }
    );

    return res.status(200).json({
      success: true,
      message: "Batch destinations fetched successfully",
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getTrackerDestinations error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch batch destinations",
      error: error.message,
    });
  }
};
