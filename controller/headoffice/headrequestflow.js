import { Op } from "sequelize";
import sequelize from "../../config/db.js";
import User from "../../model/user.js"
import StockRequest from "../../model/StockRequest.js";
import StockRequestItem from "../../model/stockRequestItem.js";
import StockTransfer from "../../model/stockTransfer.js";
import StockTransferItem from "../../model/stockTransferItem.js";
import Item from "../../model/item.js";
import Task from "../../model/task.js";
import SystemActivity from "../../model/systemActivity.js";
import Store from "../../model/Store.js";
import Stock from "../../model/stockrecord.js"
import fs from "fs";

// number convert
const toNumber = (val) => {
  const num = Number(val);
  return isNaN(num) ? 0 : num;
};

// parse items
const parseItemsFromBody = (body) => {
  if (body.items) {
    try {
      return typeof body.items === "string"
        ? JSON.parse(body.items)
        : body.items;
    } catch {
      return [];
    }
  }

  const items = [];
  let i = 0;

  while (body[`items[${i}][item_id]`]) {
    items.push({
      item_id: body[`items[${i}][item_id]`],
      qty: body[`items[${i}][qty]`],
      weight: body[`items[${i}][weight]`],
      rate: body[`items[${i}][rate]`],
    });
    i++;
  }

  return items;
};

// transfer no
const generateTransferNo = () => {
  return "TRF-" + Date.now();
};

// dummy upload (abhi basic)
const uploadToCloudinary = async (filePath) => {
  return {
    secure_url: `http://localhost/uploads/${Date.now()}`,
  };
};

// file delete
const safeUnlink = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (e) {
    console.log("unlink error:", e.message);
  }
};

// activity dummy
const createActivity = async () => {
  return true;
};
const HEAD_ROLES = [
  "super_admin",
  "admin",
  "head_admin",
  "head_manager",
  "super_stock_manager",
];

const HEAD_LEVELS = ["head", "head_office"];

const isHeadUser = (user) => {
  const role = String(user?.role || "").toLowerCase();
  const level = String(user?.organization_level || "").toLowerCase();

  return HEAD_ROLES.includes(role) || HEAD_LEVELS.includes(level);
};

export const getHeadReceivedStockRequests = async (req, res) => {
  try {
    const user = req.user;

    if (!user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    if (!isHeadUser(user)) {
      return res.status(403).json({
        success: false,
        message: "Only head user can access district stock requests",
      });
    }

    const requests = await StockRequest.findAll({
      where: {
        to_organization_id: user.organization_id,
      },
      include: [
        {
          model: StockRequestItem,
          as: "request_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "sku_code",
                "category",
                "metal_type",
                "purity",
                "unit",
                "gross_weight",
                "net_weight",
              ],
              required: false,
            },
          ],
        },
        {
          model: StockTransfer,
          as: "transfer",
          required: false,
          attributes: [
            "id",
            "request_id",
            "transfer_no",
            "status",
            "dispatch_date",
            "receive_date",
            "created_at",
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const finalData = requests.map((row) => {
      const item = row.toJSON ? row.toJSON() : row;

      return {
        ...item,
        request_type: "received",
      };
    });

    let totalRequests = finalData.length;
    let approvedRequests = 0;
    let transitGoods = 0;
    let lowStockItems = 0;

    const LOW_STOCK_THRESHOLD = 5;

    for (const reqRow of finalData) {
      const requestStatus = String(reqRow.status || "").toLowerCase();
      const transferStatus = String(reqRow.transfer?.status || "").toLowerCase();

      if (
        ["approved", "partially_approved", "completed"].includes(requestStatus)
      ) {
        approvedRequests += 1;
      }

      const requestItems = Array.isArray(reqRow.request_items)
        ? reqRow.request_items
        : [];

      for (const itemRow of requestItems) {
        const qty = Number(
          itemRow.request_qty || itemRow.qty || itemRow.quantity || 0
        );

        if (
          reqRow.transfer &&
          ["approved", "dispatched", "in_transit"].includes(transferStatus)
        ) {
          transitGoods += qty;
        }

        if (qty > 0 && qty <= LOW_STOCK_THRESHOLD) {
          lowStockItems += 1;
        }
      }
    }

    const lowStockAlert = {
      show_alert: lowStockItems > 0,
      message:
        lowStockItems > 0
          ? `${lowStockItems} low-quantity requested item(s) found.`
          : "No low stock items.",
      request_button_text: "Review Requests",
    };

    return res.status(200).json({
      success: true,
      summary: {
        total_requests: totalRequests,
        approved_requests: approvedRequests,
        low_stock_items: lowStockItems,
        transit_goods: transitGoods,
      },
      low_stock_alert: lowStockAlert,
      count: finalData.length,
      data: finalData,
    });
  } catch (error) {
    console.error("getHeadReceivedStockRequests error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch head received stock requests",
      error: error.message,
    });
  }
};

export const approveAndDispatchHeadRequest = async (req, res) => {
  const transaction = await sequelize.transaction();
  const uploadedLocalPaths = [];

  try {
    const { requestId } = req.params;

    const {
      remarks,
      driver_name,
      driver_phone,
      vehicle_number,
      tracking_number,
      pickup_address,
      delivery_address,
      expected_delivery_date,
      expected_delivery_time,
      additional_notes,
    } = req.body;

    const user = req.user;
    const parsedItems = parseItemsFromBody(req.body);

    if (!user?.organization_id) {
      await transaction.rollback();
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const role = String(user.role || "").toLowerCase();
    const level = String(user.organization_level || "").toLowerCase();

    const isHeadUser =
      ["super_admin", "admin", "head_admin", "head_manager"].includes(role) ||
      ["head", "head_office"].includes(level);

    if (!isHeadUser) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Only head user can approve and dispatch this request",
      });
    }

    if (!Array.isArray(parsedItems) || parsedItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message:
          "Approved items are required. Send items as JSON string or items[0][item_id], items[0][qty] format.",
      });
    }

    if (!driver_name || !driver_phone || !vehicle_number) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Driver name, driver phone, and vehicle number are required",
      });
    }

    const approvedRows = parsedItems.filter(
      (row) => Number(row.qty || 0) > 0
    );

    if (approvedRows.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "At least one item must have qty greater than 0 for approval",
      });
    }

    if (!pickup_address || !delivery_address) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Pickup and delivery address are required",
      });
    }

    if (!expected_delivery_date || !expected_delivery_time) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Expected delivery date and time are required",
      });
    }

    const driverPhotoFile = req.files?.driver_photo?.[0] || null;
    const dispatchImageFiles = req.files?.dispatch_images || [];
    const dispatchVideoFile = req.files?.dispatch_video?.[0] || null;

    if (dispatchImageFiles.length > 3) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Maximum 3 dispatch images allowed",
      });
    }

    if (driverPhotoFile?.path) uploadedLocalPaths.push(driverPhotoFile.path);

    for (const file of dispatchImageFiles) {
      if (file?.path) uploadedLocalPaths.push(file.path);
    }

    if (dispatchVideoFile?.path) {
      uploadedLocalPaths.push(dispatchVideoFile.path);
    }

    const request = await StockRequest.findByPk(requestId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!request) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Stock request not found",
      });
    }

    if (Number(request.to_organization_id) !== Number(user.organization_id)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "You are not allowed to approve this request",
      });
    }

    if (request.status !== "pending") {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Only pending request can be approved",
      });
    }

    const existingTransfer = await StockTransfer.findOne({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingTransfer) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Transfer already created for this request",
      });
    }

    const requestItems = await StockRequestItem.findAll({
      where: { request_id: request.id },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    const requestItemMap = new Map(
      requestItems.map((x) => [Number(x.item_id), x])
    );

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);

      if (!item_id || qty < 0) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: "Each item must have valid item_id and qty",
        });
      }

      const requestItem = requestItemMap.get(item_id);

      if (!requestItem) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Requested item not found for item_id ${item_id}`,
        });
      }

      const requestedQty = toNumber(requestItem.request_qty);

      if (qty > requestedQty) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Approved qty cannot exceed requested qty for item ${item_id}`,
        });
      }
    }

    let driver_photo_url = null;
    let dispatch_image_urls = [];
    let dispatch_video_url = null;

    if (driverPhotoFile?.path) {
      const uploadedDriverPhoto = await uploadToCloudinary(
        driverPhotoFile.path,
        "stock-transfer/driver-photo",
        "image"
      );

      driver_photo_url = uploadedDriverPhoto.secure_url;
    }

    if (dispatchImageFiles.length > 0) {
      for (const file of dispatchImageFiles) {
        const uploadedImage = await uploadToCloudinary(
          file.path,
          "stock-transfer/dispatch-images",
          "image"
        );

        dispatch_image_urls.push(uploadedImage.secure_url);
      }
    }

    if (dispatchVideoFile?.path) {
      const uploadedVideo = await uploadToCloudinary(
        dispatchVideoFile.path,
        "stock-transfer/dispatch-video",
        "video"
      );

      dispatch_video_url = uploadedVideo.secure_url;
    }

    const transfer = await StockTransfer.create(
      {
        transfer_no: generateTransferNo(),
        request_id: request.id,

        from_organization_id: user.organization_id,
        to_organization_id: request.from_organization_id,

        transfer_date: new Date(),
        dispatch_date: new Date(),
        status: "in_transit",

        approved_by: user.id,
        dispatched_by: user.id,
        created_by: user.id,

        remarks: remarks || null,
        driver_name: driver_name || null,
        driver_phone: driver_phone || null,
        vehicle_number: vehicle_number || null,
        tracking_number: tracking_number || null,

        driver_photo_url: driver_photo_url || null,
        dispatch_image_url:
          dispatch_image_urls.length > 0
            ? JSON.stringify(dispatch_image_urls)
            : null,
        dispatch_video_url: dispatch_video_url || null,

        pickup_address: pickup_address || null,
        delivery_address: delivery_address || null,
        expected_delivery_date: expected_delivery_date || null,
        expected_delivery_time: expected_delivery_time || null,
        additional_notes: additional_notes || null,
      },
      { transaction }
    );

    let totalRequested = 0;
    let totalApproved = 0;
    let totalWeight = 0;
    let estimatedValue = 0;
    let approvedItemsCount = 0;

    for (const row of parsedItems) {
      const item_id = toNumber(row.item_id);
      const qty = toNumber(row.qty);
      const weight = toNumber(row.weight);
      const rate = toNumber(row.rate);

      const requestItem = requestItemMap.get(item_id);
      const requestedQty = toNumber(requestItem.request_qty);

      totalRequested += requestedQty;
      totalApproved += qty;

      if (qty === 0) {
        await requestItem.update(
          {
            approved_qty: 0,
            approved_weight: 0,
            status: "rejected",
          },
          { transaction }
        );

        continue;
      }

      approvedItemsCount += 1;
      totalWeight += weight;
      estimatedValue += weight * rate;

      await StockTransferItem.create(
        {
          transfer_id: transfer.id,
          item_id,
          qty,
          weight,
          rate,
          remarks: row.remarks || null,
        },
        { transaction }
      );

      await requestItem.update(
        {
          approved_qty: qty,
          approved_weight: weight,
          status: qty < requestedQty ? "partially_approved" : "approved",
        },
        { transaction }
      );
    }

    let finalStatus = "approved";

    if (approvedItemsCount === 0) {
      finalStatus = "rejected";
    } else if (totalApproved < totalRequested) {
      finalStatus = "partially_approved";
    }

    await request.update(
      {
        status: finalStatus,
        approved_by: user.id,
        approved_at: new Date(),
      },
      { transaction }
    );

    await Task.update(
      { status: finalStatus },
      {
        where: {
          task_type: "stock_request_approval",
          reference_id: request.id,
        },
        transaction,
      }
    );

    await SystemActivity.create(
      {
        title:
          finalStatus === "approved"
            ? "Head stock request approved and dispatched"
            : finalStatus === "partially_approved"
            ? "Head stock request partially approved and dispatched"
            : "Head stock request rejected",
        description:
          finalStatus === "rejected"
            ? `Request ${request.request_no} was rejected by head`
            : `Request ${request.request_no} processed via ${transfer.transfer_no}`,
        activity_type: "head_stock_request_dispatch",
        module_name: "stock_transfer",
        reference_id: transfer.id,
        reference_no: transfer.transfer_no,
        district_code: request.to_district_code || null,
        store_code: request.from_store_code || null,
        store_name: request.from_store_name || null,
        created_by: user.id,
        created_at: new Date(),
      },
      { transaction }
    );

    await createActivity({
      user_id: user.id,
      action: "head_stock_request_dispatch",
      title:
        finalStatus === "approved"
          ? "Head stock request approved and dispatched"
          : finalStatus === "partially_approved"
          ? "Head stock request partially approved and dispatched"
          : "Head stock request rejected",
      description:
        finalStatus === "rejected"
          ? `Request ${request.request_no} rejected`
          : `Request ${request.request_no} dispatched via ${transfer.transfer_no}`,
      meta: {
        request_id: request.id,
        request_no: request.request_no,
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        final_status: finalStatus,
        driver_photo_url,
        dispatch_image_urls,
        dispatch_video_url,
      },
      transaction,
    });

    await transaction.commit();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    return res.status(200).json({
      success: true,
      message:
        finalStatus === "rejected"
          ? "Request rejected successfully"
          : "Request approved and stock dispatched successfully",
      data: {
        transfer: {
          ...transfer.toJSON(),
          dispatch_image_url: dispatch_image_urls,
        },
        uploaded_files: {
          driver_photo_url,
          dispatch_image_urls,
          dispatch_video_url,
        },
        summary: {
          request_id: request.id,
          request_no: request.request_no,
          total_requested: totalRequested,
          total_approved: totalApproved,
          total_weight: totalWeight,
          estimated_value: estimatedValue,
          final_status: finalStatus,
        },
      },
    });
  } catch (error) {
    await transaction.rollback();

    for (const filePath of uploadedLocalPaths) {
      safeUnlink(filePath);
    }

    console.error("approveAndDispatchHeadRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to approve and dispatch request",
      error: error.message,
    });
  }
};



export const createHeadStockRequest = async (req, res) => {
  const transaction = await sequelize.transaction();

  try {
    const user = req.user;

    const {
      target_type,       // "district" OR "retail"
      to_store_id,       // receiver store id
      to_store_code,     // receiver store code
      items,
      priority,
      category,
      notes,
    } = req.body;

    const userLevel = String(user.organization_level || "").toLowerCase();

    if (!["head", "head_office"].includes(userLevel)) {
      await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: "Only head office can create this stock request",
      });
    }

    const receiverType = String(target_type || "").toLowerCase();

    if (!["district", "retail"].includes(receiverType)) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "target_type must be district or retail",
      });
    }

    if (!to_store_id || !to_store_code) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "to_store_id and to_store_code are required",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "items are required",
      });
    }

    const headStore = await Store.findOne({
      where: {
        id: user.organization_id,
      },
      transaction,
    });

    if (!headStore) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Head office store not found",
      });
    }

    const receiverStore = await Store.findOne({
      where: {
        id: Number(to_store_id),
        store_code: String(to_store_code).trim(),
       organization_level: receiverType === "district" ? "District" : "Retail",
        is_active: true,
      },
      transaction,
    });

    if (!receiverStore) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Invalid store_id or store_code mismatch",
      });
    }

    const validItems = items
      .filter((i) => i.item_id && Number(i.request_qty) > 0)
      .map((i) => ({
        item_id: Number(i.item_id),
        request_qty: Number(i.request_qty),
        approved_qty: 0,
        status: "pending",
      }));

    if (validItems.length === 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "No valid items found",
      });
    }

    const itemIds = validItems.map((i) => i.item_id);

    const receiverStocks = await Stock.findAll({
      where: {
        organization_id: receiverStore.id,
        item_id: { [Op.in]: itemIds },
      },
      attributes: ["item_id", "available_qty"],
      transaction,
    });

    const stockMap = new Map();

    receiverStocks.forEach((stock) => {
      stockMap.set(Number(stock.item_id), Number(stock.available_qty || 0));
    });

    const unavailableItems = validItems
      .map((item) => {
        const availableQty = stockMap.get(item.item_id) || 0;

        if (availableQty < item.request_qty) {
          return {
            item_id: item.item_id,
            requested_qty: item.request_qty,
            available_qty: availableQty,
          };
        }

        return null;
      })
      .filter(Boolean);

    if (unavailableItems.length > 0) {
      await transaction.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected store does not have enough stock for requested items",
        unavailable_items: unavailableItems,
      });
    }

    const request_no = `REQ-HEAD-${user.organization_id}-${Date.now()}`;

    const stockRequest = await StockRequest.create(
      {
        request_no,

        from_organization_id: user.organization_id,
        from_store_code: headStore.store_code,
        from_store_name: headStore.store_name,

        to_organization_id: receiverStore.id,
        to_store_code: receiverStore.store_code,
        to_store_name: receiverStore.store_name,

        to_district_code:
          receiverType === "district" ? receiverStore.store_code : null,
        to_district_name:
          receiverType === "district" ? receiverStore.store_name : null,

        priority: priority || "medium",
        category: category || null,
        notes: notes || null,
        status: "pending",
        created_by: user.id,
      },
      { transaction }
    );

    const requestItemsPayload = validItems.map((item) => ({
      request_id: stockRequest.id,
      item_id: item.item_id,
      request_qty: item.request_qty,
      approved_qty: item.approved_qty,
      status: item.status,
    }));

    await StockRequestItem.bulkCreate(requestItemsPayload, { transaction });

    await Task.create(
      {
        title: "Stock request approval required",
        description: `${headStore.store_name} submitted stock request ${stockRequest.request_no} to ${receiverStore.store_name}`,
        priority: priority || "medium",
        status: "pending",
        task_type:
          receiverType === "district"
            ? "head_to_district_stock_request"
            : "head_to_retail_stock_request",
        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,

        district_code:
          receiverType === "district" ? receiverStore.store_code : null,
        store_code: receiverStore.store_code,
        store_name: receiverStore.store_name,

        assigned_to: null,
        created_by: user.id,
      },
      { transaction }
    );

    await ActivityLog.create(
      {
        organization_id: user.organization_id,
        user_id: user.id,
        action: "stock_request_created",
        module_name: "stock_request",

        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,

        title: "Stock request created",
        description: `You created stock request ${stockRequest.request_no} for ${receiverStore.store_name}`,

        meta: {
          total_items: requestItemsPayload.length,
          from_store_name: headStore.store_name,
          from_store_code: headStore.store_code,
          to_store_name: receiverStore.store_name,
          to_store_code: receiverStore.store_code,
          target_type: receiverType,
        },

        icon: "request",
        color: "blue",
      },
      { transaction }
    );

    await SystemActivity.create(
      {
        title: "New head office stock request submitted",
        description: `${headStore.store_name} submitted request ${stockRequest.request_no} to ${receiverStore.store_name}`,
        activity_type: "stock_request_created",
        module_name: "stock_request",
        reference_id: stockRequest.id,
        reference_no: stockRequest.request_no,
        district_code:
          receiverType === "district" ? receiverStore.store_code : null,
        store_code: receiverStore.store_code || null,
        store_name: receiverStore.store_name || null,
        created_by: user.id,
        created_at: new Date(),
      },
      { transaction }
    );

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Stock request created successfully",
      data: {
        request_id: stockRequest.id,
        request_no: stockRequest.request_no,
        total_items: requestItemsPayload.length,
      },
    });
  } catch (error) {
    await transaction.rollback();
    console.error("createHeadStockRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};







// ==========================================
// HEAD / SUPER ADMIN - ALL TRANSFERS
// ==========================================
export const getHeadAllTransfers = async (req, res) => {
  try {
    const user = req.user;

    if (!user?.organization_id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const role = String(user.role || "").toLowerCase();
    const level = String(user.organization_level || "").toLowerCase();

    const isHeadUser =
      role === "super_admin" ||
      role === "admin" ||
      level === "head" ||
      level === "head_office";

    if (!isHeadUser) {
      return res.status(403).json({
        success: false,
        message: "Only head office users can access all transfers",
      });
    }

    const transfers = await StockTransfer.findAll({
      include: [
        {
          model: StockTransferItem,
          as: "transfer_items",
          required: false,
        },
      ],
      order: [["created_at", "DESC"]],
    });

    const data = transfers.map((tr) => {
      const t = tr.toJSON();

      return {
        ...t,
        direction: "all",
        direction_label: "All Transfer",
        transfer_items: t.transfer_items || [],
      };
    });

    const summary = {
      total: transfers.length,
      draft: transfers.filter((t) => t.status === "draft").length,
      approved: transfers.filter((t) => t.status === "approved").length,
      dispatched: transfers.filter((t) => t.status === "dispatched").length,
      in_transit: transfers.filter((t) => t.status === "in_transit").length,
      received: transfers.filter((t) => t.status === "received").length,
      cancelled: transfers.filter((t) => t.status === "cancelled").length,
    };

    return res.status(200).json({
      success: true,
      summary,
      count: transfers.length,
      data,
    });
  } catch (error) {
    console.error("getHeadAllTransfers error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch head all transfers",
      error: error.message,
    });
  }
};

export const getAvailableStoresForHeadRequest = async (req, res) => {
  try {
    const user = req.user;

    const {
      target_type = "district", // district OR retail
      items,
    } = req.body;

    const userLevel = String(user.organization_level || "").toLowerCase();

    if (!["head", "head_office"].includes(userLevel)) {
      return res.status(403).json({
        success: false,
        message: "Only head office can access this API",
      });
    }

    const receiverType = String(target_type || "").toLowerCase();

    if (!["district", "retail"].includes(receiverType)) {
      return res.status(400).json({
        success: false,
        message: "target_type must be district or retail",
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: "items are required",
      });
    }

    const validItems = items
      .filter((i) => i.item_id && Number(i.request_qty) > 0)
      .map((i) => ({
        item_id: Number(i.item_id),
        request_qty: Number(i.request_qty),
      }));

    if (validItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid items found",
      });
    }

    const itemIds = validItems.map((i) => i.item_id);

    const stores = await Store.findAll({
      where: {
        organization_level:
          receiverType === "district"
            ? { [Op.in]: ["District", "district", "DISTRICT"] }
            : { [Op.in]: ["Retail", "retail", "RETAIL"] },
        is_active: true,
      },
      attributes: [
        "id",
        "store_name",
        "store_code",
        "organization_level",
        "state",
        "district",
        "district_id",
        "address",
        "phone_number",
      ],
      order: [["store_name", "ASC"]],
    });

    if (!stores.length) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
      });
    }

    const storeIds = stores.map((s) => s.id);

    const stocks = await Stock.findAll({
      where: {
        organization_id: { [Op.in]: storeIds },
        item_id: { [Op.in]: itemIds },
      },
      attributes: ["organization_id", "item_id", "available_qty"],
    });

    const stockMap = new Map();

    for (const stock of stocks) {
      const key = `${stock.organization_id}_${stock.item_id}`;
      stockMap.set(key, Number(stock.available_qty || 0));
    }

    const data = stores.map((store) => {
      let matchedItems = 0;
      let missingItems = 0;

      const stock_details = validItems.map((item) => {
        const key = `${store.id}_${item.item_id}`;
        const availableQty = stockMap.get(key) || 0;
        const isAvailable = availableQty >= item.request_qty;

        if (isAvailable) matchedItems++;
        else missingItems++;

        return {
          item_id: item.item_id,
          requested_qty: item.request_qty,
          available_qty: availableQty,
          is_available: isAvailable,
        };
      });

      return {
        store_id: store.id,
        store_name: store.store_name,
        store_code: store.store_code,
        organization_level: store.organization_level,
        state: store.state,
        district: store.district,
        district_id: store.district_id,
        address: store.address,
        phone_number: store.phone_number,

        total_requested_items: validItems.length,
        matched_items: matchedItems,
        missing_items: missingItems,
        can_fulfill_full_request: missingItems === 0,

        stock_details,
      };
    });

    const sortedData = data.sort((a, b) => {
      if (b.can_fulfill_full_request !== a.can_fulfill_full_request) {
        return b.can_fulfill_full_request - a.can_fulfill_full_request;
      }

      return b.matched_items - a.matched_items;
    });

    return res.status(200).json({
      success: true,
      count: sortedData.length,
      data: sortedData,
    });
  } catch (error) {
    console.error("getAvailableStoresForHeadRequest error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};



const HEAD_ACCESS_ROLES = [
  "super_admin",
  "admin",
  "head",
  "head_office",
  "head_admin",
  "stock_manager",
  "super_stock_manager",
  "inventory_manager",
  "super_inventory_manager",
];

const normalizeRole = (role = "") =>
  String(role).trim().toLowerCase().replaceAll("-", "_");

const canViewAnyTransfer = (user) => {
  const role = normalizeRole(user?.role);
  const level = normalizeRole(user?.organization_level);

  return (
    HEAD_ACCESS_ROLES.includes(role) ||
    level === "head" ||
    level === "head_office" ||
    user?.branches?.includes?.("ALL")
  );
};

const pickStoreName = (store) => {
  if (!store) return null;
  return (
    store.store_name ||
    store.name ||
    store.organization_name ||
    store.branch_name ||
    null
  );
};

const pickUserName = (user) => {
  if (!user) return null;
  return user.username || user.name || user.email || null;
};

export const getAnyTransferDetailsForHead = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!user?.id) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized user",
      });
    }

    const transfer = await StockTransfer.findByPk(id, {
      include: [
        {
          model: StockTransferItem,
          as: "transfer_items",
          include: [
            {
              model: Item,
              as: "item",
              attributes: [
                "id",
                "item_name",
                "article_code",
                "sku_code",
                "category",
                "metal_type",
                "purity",
                "sale_rate",
                "gross_weight",
                "net_weight",
              ],
            },
          ],
        },
      ],
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const plainTransfer = transfer.get({ plain: true });

    const isHeadUser = canViewAnyTransfer(user);

    const isOwnTransfer =
      Number(user.organization_id) ===
        Number(plainTransfer.from_organization_id) ||
      Number(user.organization_id) ===
        Number(plainTransfer.to_organization_id);

    // ✅ Head can view any transfer
    // ✅ Normal district/retail can view only own incoming/outgoing transfer
    if (!isHeadUser && !isOwnTransfer) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view this transfer",
      });
    }

    const organizationIds = [
      Number(plainTransfer.from_organization_id),
      Number(plainTransfer.to_organization_id),
    ].filter(Boolean);

    const stores = organizationIds.length
      ? await Store.findAll({
          where: {
            id: {
              [Op.in]: organizationIds,
            },
          },
        })
      : [];

    const storeMap = new Map(stores.map((s) => [Number(s.id), s]));

    const userIds = [
      Number(plainTransfer.created_by || 0),
      Number(plainTransfer.approved_by || 0),
      Number(plainTransfer.dispatched_by || 0),
      Number(plainTransfer.received_by || 0),
    ].filter(Boolean);

    const users = userIds.length
      ? await User.findAll({
          where: {
            id: {
              [Op.in]: userIds,
            },
          },
          attributes: ["id", "username", "email"],
        })
      : [];

    const userMap = new Map(users.map((u) => [Number(u.id), u]));

    const fromStore = storeMap.get(Number(plainTransfer.from_organization_id));
    const toStore = storeMap.get(Number(plainTransfer.to_organization_id));

    const data = {
      id: plainTransfer.id,
      transfer_no: plainTransfer.transfer_no,
      request_id: plainTransfer.request_id || null,
      tracking_number:
        plainTransfer.tracking_number || plainTransfer.transfer_no,

      status: plainTransfer.status,
      remarks: plainTransfer.remarks,

      from_organization_id: plainTransfer.from_organization_id,
      from_organization_name: pickStoreName(fromStore),
      from_store_code: fromStore?.store_code || null,

      to_organization_id: plainTransfer.to_organization_id,
      to_organization_name: pickStoreName(toStore),
      to_store_code: toStore?.store_code || null,

      transfer_date: plainTransfer.transfer_date,
      dispatch_date: plainTransfer.dispatch_date,
      receive_date: plainTransfer.receive_date,

      expected_delivery_date: plainTransfer.expected_delivery_date || null,
      expected_delivery_time: plainTransfer.expected_delivery_time || null,

      pickup_address: plainTransfer.pickup_address || null,
      delivery_address: plainTransfer.delivery_address || null,

      e_way_bill_url: plainTransfer.e_way_bill_url || null,

      driver_details: {
        driver_name: plainTransfer.driver_name || null,
        driver_phone: plainTransfer.driver_phone || null,
        vehicle_number: plainTransfer.vehicle_number || null,
        tracking_number: plainTransfer.tracking_number || null,
        driver_photo_url: plainTransfer.driver_photo_url || null,
      },

      live_tracking: {
        is_tracking_active: plainTransfer.is_tracking_active || false,
        last_latitude: plainTransfer.last_latitude || null,
        last_longitude: plainTransfer.last_longitude || null,
        last_tracked_at: plainTransfer.last_tracked_at || null,
      },

      media: {
        dispatch_image_url: plainTransfer.dispatch_image_url || null,
        dispatch_video_url: plainTransfer.dispatch_video_url || null,
        receive_image_url: plainTransfer.receive_image_url || null,
        e_way_bill_url: plainTransfer.e_way_bill_url || null,
      },

      created_by: {
        id: plainTransfer.created_by || null,
        name: pickUserName(userMap.get(Number(plainTransfer.created_by))),
      },

      approved_by: {
        id: plainTransfer.approved_by || null,
        name: pickUserName(userMap.get(Number(plainTransfer.approved_by))),
      },

      dispatched_by: {
        id: plainTransfer.dispatched_by || null,
        name: pickUserName(userMap.get(Number(plainTransfer.dispatched_by))),
      },

      received_by: {
        id: plainTransfer.received_by || null,
        name: pickUserName(userMap.get(Number(plainTransfer.received_by))),
      },

      products: (plainTransfer.transfer_items || []).map((row) => ({
        id: row.id,
        item_id: row.item_id,
        qty: Number(row.qty || 0),
        weight: Number(row.weight || 0),
        remarks: row.remarks || null,

        item_name: row.item?.item_name || null,
        article_code: row.item?.article_code || null,
        sku_code: row.item?.sku_code || null,
        category: row.item?.category || null,
        metal_type: row.item?.metal_type || null,
        purity: row.item?.purity || null,
        rate: Number(row.item?.sale_rate || 0),
        gross_weight: Number(row.item?.gross_weight || 0),
        net_weight: Number(row.item?.net_weight || 0),
      })),
    };

    return res.status(200).json({
      success: true,
      message: "Transfer details fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getAnyTransferDetailsForHead error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer details",
      error: error.message,
    });
  }
};
