import express from "express";
import "./model/index.js";
import cors from "cors";
import dotenv from "dotenv";
import { Sequelize } from "sequelize";
import { Server } from "socket.io";

import authRoutes from "./routes/authRoutes.js";
import item from "./routes/itemRoutes.js";
import dashboard from "./routes/dashboardRoutes.js";
import requestItem from "./routes/request.js";
import stock from "./routes/stockRoute.js";
import Profile from "./routes/userRoute.js";
import Audit from "./routes/Audit.js";
import District from "./routes/districtRoute.js";
import ladger from "./routes/ledgerRoutes.js";
import Bill from "./routes/billRoute.js";
import Activity from "./routes/activityRoutes.js";
import exchange from "./routes/Exchange.js";
import tracklocation from "./routes/transferlocation.js";
import { getGoldRate } from "./service/goldService.js";
// import { getGoldRate } from "./Services/goldService.js";

// ✅ path apne project ke hisab se adjust kar lena
import { getDashboardSummary } from "./controller/dashboardController.js";
import { getDistrictDashboard } from "./controller/districtController.js";

dotenv.config();

const app = express();

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://erp-dash-board.vercel.app",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: "postgres",
  protocol: "postgres",
  logging: false,
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false,
    },
  },
});

app.use("/auth", authRoutes);
app.use("/item", item);
app.use("/dash", dashboard);
app.use("/request", requestItem);
app.use("/stock", stock);
app.use("/profile", Profile);
app.use("/audit", Audit);
app.use("/District", District);
app.use("/ladger", ladger);
app.use("/bill", Bill);
app.use("/Activity", Activity);
app.use("/exchange", exchange);
app.use("/track", tracklocation);

app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running successfully",
  });
});

const PORT = process.env.PORT || 8000;

const makeSocketRes = (socket, eventName) => {
  return {
    status: () => makeSocketRes(socket, eventName),
    json: (data) => {
      socket.emit(eventName, data);
    },
  };
};

const emitDashboardData = async (socket, user) => {
  if (!user) return;

  const fakeReq = { user };

  // ✅ Normal dashboard cards live
  await getDashboardSummary(
    fakeReq,
    makeSocketRes(socket, "dashboard-summary-live")
  );

  // ✅ District dashboard cards live
  if (
    user.role === "district_manager" ||
    String(user.organization_level || "").toLowerCase() === "district"
  ) {
    await getDistrictDashboard(
      fakeReq,
      makeSocketRes(socket, "district-dashboard-live")
    );
  }
};

async function startServer() {
  try {
    await sequelize.authenticate();
    console.log("✅ PostgreSQL connected successfully");

    const server = app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });

    const io = new Server(server, {
      cors: corsOptions,
    });

    io.on("connection", async (socket) => {
      console.log("✅ Client connected:", socket.id);

      // ✅ frontend se user bhejna hoga
      socket.on("join-dashboard", async (userData) => {
        try {
          socket.data.user = userData;

          // ✅ connect hote hi full cards data bhej do
          await emitDashboardData(socket, userData);

          // ✅ gold rate bhi bhej do
          const goldRate = await getGoldRate();

          socket.emit("gold-rate-updated", {
            price_gram_24k: goldRate.price_gram_24k,
            price_gram_22k: goldRate.price_gram_22k,
            price_gram_18k: goldRate.price_gram_18k,
            currency: goldRate.currency,
            timestamp: goldRate.timestamp,
          });
        } catch (error) {
          console.error("join-dashboard socket error:", error.message);
        }
      });

      socket.on("disconnect", () => {
        console.log("❌ Client disconnected:", socket.id);
      });
    });

    // ✅ Har 30 sec me gold + cards dono live update
    setInterval(async () => {
      try {
        const goldRate = await getGoldRate();

        io.emit("gold-rate-updated", {
          price_gram_24k: goldRate.price_gram_24k,
          price_gram_22k: goldRate.price_gram_22k,
          price_gram_18k: goldRate.price_gram_18k,
          currency: goldRate.currency,
          timestamp: goldRate.timestamp,
        });

        const sockets = await io.fetchSockets();

        for (const socket of sockets) {
          const user = socket.data.user;
          if (!user) continue;

          await emitDashboardData(socket, user);
        }

        console.log("✅ Live dashboard data emitted");
      } catch (error) {
        console.error("Live dashboard socket error:", error.message);
      }
    }, 30000);
  } catch (error) {
    console.error("❌ Database connection failed:", error.message);
  }
}

startServer();
