import StockTransfer from "../model/stockTransfer.js";
import TransferLocation from "../model/TransferLocation.js";

const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const generateFakeRoute = (startLat, startLng, km = 50, points = 50) => {
  const endLat = startLat + km / 111; // approx 50 km north
  const endLng = startLng + 0.05;

  const route = [];

  for (let i = 0; i < points; i++) {
    const ratio = i / (points - 1);

    route.push({
      latitude: startLat + (endLat - startLat) * ratio,
      longitude: startLng + (endLng - startLng) * ratio,
      source: "fake",
    });
  }

  return route;
};

export const startFakeTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const { start_lat, start_lng } = req.body;

    const transfer = await StockTransfer.findByPk(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    if (transfer.status !== "in_transit") {
      return res.status(400).json({
        success: false,
        message: "Tracking can start only for in_transit transfer",
      });
    }

    const lat = toNumber(start_lat);
    const lng = toNumber(start_lng);

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "start_lat and start_lng are required",
      });
    }

    await TransferLocation.destroy({
      where: { transfer_id: transfer.id },
    });

    const route = generateFakeRoute(lat, lng, 50, 50).map((p) => ({
      transfer_id: transfer.id,
      latitude: p.latitude,
      longitude: p.longitude,
      source: "fake",
    }));

    await TransferLocation.bulkCreate(route);

    return res.status(200).json({
      success: true,
      message: "Fake tracking route started successfully",
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        total_points: route.length,
      },
    });
  } catch (error) {
    console.error("startFakeTracking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start fake tracking",
      error: error.message,
    });
  }
};

export const getTransferRoute = async (req, res) => {
  try {
    const { id } = req.params;

    const transfer = await StockTransfer.findByPk(id);

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: "Transfer not found",
      });
    }

    const locations = await TransferLocation.findAll({
      where: { transfer_id: id },
      order: [["recorded_at", "ASC"]],
    });

    const covered_route = locations.map((loc) => ({
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      recorded_at: loc.recorded_at,
      source: loc.source,
    }));

    const current_location =
      covered_route.length > 0
        ? covered_route[covered_route.length - 1]
        : null;

    return res.status(200).json({
      success: true,
      data: {
        transfer_id: transfer.id,
        transfer_no: transfer.transfer_no,
        status: transfer.status,
        current_location,
        covered_route,
      },
    });
  } catch (error) {
    console.error("getTransferRoute error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch transfer route",
      error: error.message,
    });
  }
};