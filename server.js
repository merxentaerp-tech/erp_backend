import express from "express";
import "./model/index.js";
import cors from "cors";
import dotenv from "dotenv";
import { Sequelize } from "sequelize";
import authRoutes from "./routes/authRoutes.js"; // ✅ ES Module import
import item from "./routes/itemRoutes.js";
import dashboard from "./routes/dashboardRoutes.js";
import requestItem from "./routes/request.js";
import stock from "./routes/stockRoute.js"
import Profile from "./routes/userRoute.js"
import Audit from "./routes/Audit.js"
import District from "./routes/districtRoute.js"
import ladger from "./routes/ledgerRoutes.js"
import Bill from "./routes/billRoute.js"
import Activity from "./routes/activityRoutes.js"
import exchange from "./routes/Exchange.js"
dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:3000", // React local
    "http://localhost:5173", // Vite local
    "https://inventorysystem-opal.vercel.app" // production frontend
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};
// Middlewares
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// PostgreSQL / Supabase Connection
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  protocol: "postgres",
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// Use routes
app.use('/auth', authRoutes); // ✅ ES Module compatible
app.use('/item',item)
app.use('/dash',dashboard)
app.use('/request',requestItem)
app.use('/stock',stock)
app.use('/profile',Profile)
app.use('/audit',Audit)
app.use('/District',District)
app.use('/ladger',ladger)
app.use('/bill',Bill)
app.use('/Activity',Activity)
app.use('/exchange',exchange)
// Test route
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully"
  });
});

// Start server after DB connect
const PORT = process.env.PORT || 8000;

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL connected successfully");

    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
  }
}

startServer();
