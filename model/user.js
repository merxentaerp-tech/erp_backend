import { DataTypes } from "sequelize";
import sequelize from "../config/db.js";

const user = sequelize.define(
  "user",
  {
    id: {
      type: DataTypes.INTEGER,
       autoIncrement: true,  
      primaryKey: true,
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },

    username: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },

    phone_number: {
      type: DataTypes.STRING,
      unique: true,
    },

    role: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "user",
    },

    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    organization_id: {
      type: DataTypes.INTEGER,
    },

    store_code: {
      type: DataTypes.STRING,
    },

    store_name: {
      type: DataTypes.STRING,
    },

    district_code: {
      type: DataTypes.STRING,
    },

    state_code: {
      type: DataTypes.STRING,
    },

    organization_level: {
      type: DataTypes.STRING,
    },

    user_code: {
      type: DataTypes.STRING,
      unique: true,
    },

    is_police_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },

    police_doc_url: {
      type: DataTypes.STRING,
    },

    aadhaar_url: {
      type: DataTypes.STRING,
    },

    pan_url: {
      type: DataTypes.STRING,
    },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      
    },
  },
  {
    tableName: "users",
    timestamps: false,
  }
);

export default user;