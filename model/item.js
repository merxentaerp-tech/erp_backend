import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const Item = sequelize.define(
  "Item",
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    article_code: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },

    sku_code: {
      type: DataTypes.STRING(100),
      allowNull: true,
      unique: true,
    },

    item_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },

    metal_type: {
      type: DataTypes.ENUM("Gold", "Silver"),
      allowNull: false,
    },

    category: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },

    details: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    purity: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },

    gross_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: false,
      defaultValue: 0,
    },

    net_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: true,
      defaultValue: 0,
    },

    stone_weight: {
      type: DataTypes.DECIMAL(14, 3),
      allowNull: true,
      defaultValue: 0,
    },

    stone_amount: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },

    making_charge: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false,
      defaultValue: 0,
    },

    purchase_rate: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },

    sale_rate: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: true,
      defaultValue: 0,
    },

    hsn_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },

    unit: {
      type: DataTypes.ENUM("gram", "piece"),
      allowNull: false,
      defaultValue: "gram",
    },
    isItemAudit: {
  type: DataTypes.BOOLEAN,
  allowNull: false,
  defaultValue: false,
},

itemAuditAt: {
  type: DataTypes.DATE,
  allowNull: true,
},

    current_status: {
      type: DataTypes.ENUM(
        "in_stock",
        "sold",
        "transit",
        "reserved",
        "exchange",
        "returned",
        "damaged"
      ),
      allowNull: false,
      defaultValue: "in_stock",
    },

    organization_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
    },
  },
  {
    tableName: "items",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
    indexes: [
      { unique: true, fields: ["article_code"] },
      { unique: true, fields: ["sku_code"] },
      { fields: ["metal_type"] },
      { fields: ["category"] },
      { fields: ["current_status"] },
      { fields: ["organization_id"] },
    ],
  }
);

export default Item;