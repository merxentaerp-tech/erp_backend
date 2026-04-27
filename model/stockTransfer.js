import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const StockTransfer = sequelize.define(
  "StockTransfer",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    transfer_no: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
    },

    request_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    from_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    to_organization_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
    },

    transfer_date: {
      type: DataTypes.DATEONLY,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    dispatch_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    receive_date: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    status: {
      type: DataTypes.ENUM(
        "draft",
        "approved",
        "dispatched",
        "in_transit",
        "received",
        "cancelled"
      ),
      allowNull: false,
      defaultValue: "draft",
    },

    remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    approved_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    dispatched_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    received_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    created_by: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },

    // ✅ TRACKING FIELDS
    pickup_lat: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },

    pickup_lng: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },

    last_latitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },

    last_longitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },

    last_tracked_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    tracking_started_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    tracking_stopped_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    fake_tracking_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    tableName: "stock_transfers",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { unique: true, fields: ["transfer_no"] },
      { fields: ["status"] },
      { fields: ["from_organization_id"] },
      { fields: ["to_organization_id"] },
      { fields: ["transfer_date"] },
      { fields: ["last_tracked_at"] },
    ],
  }
);

export default StockTransfer;